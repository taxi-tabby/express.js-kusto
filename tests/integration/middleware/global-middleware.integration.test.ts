import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { kustoInitMiddleware, globalErrorMiddleware } from '@lib/http/routing/frameworkMiddleware';
import { clientIpMiddleware } from '@lib/http/routing/clientIpMiddleware';

/**
 * 실제 런타임의 전역 미들웨어 합성을 end-to-end 로 검증한다.
 * Core 소유 필수(kustoInit · clientIp · 전역 에러 핸들러) + app 정책 스택
 * (src/app/routes/middleware.ts = defaultGlobalMiddleware: helmet/CORS/cookie/body/log)을
 * Core 와 동일한 순서로 조립한다.
 *
 * 운영 미들웨어 체인 자체를 통과시키는 유일한 테스트(test-app.ts 는 라우팅·CRUD 만 검증).
 */

const ORIGINAL_ENV = { ...process.env };

/** app 의 정책 스택(middleware.ts = defaultGlobalMiddleware). import 시점에 env 반영. */
function loadPolicyStack(): express.RequestHandler[] {
     
    const mod = require('@app/routes/middleware');
    return (mod.default ?? mod) as express.RequestHandler[];
}

/**
 * Core 와 동일한 순서로 합성: [kustoInit, clientIp] + 정책 스택 + 라우트 + [전역 에러 핸들러].
 */
function buildAppWithRealMiddleware(): express.Express {
    const pre = [kustoInitMiddleware, clientIpMiddleware, ...loadPolicyStack()];
    const errs = [globalErrorMiddleware];

    const app = express();
    app.set('trust proxy', true); // clientIpMiddleware 의 XFF 처리를 신뢰
    pre.forEach((m) => app.use(m));

    app.get('/echo', (req: Request, res: Response) => {
        res.json({
            hasKusto: !!req.kusto,
            ip: req.ip,
            cookies: req.cookies ?? null,
        });
    });

    app.post('/echo-body', (req: Request, res: Response) => {
        res.json({ body: req.body });
    });

    app.get('/boom', (_req: Request, _res: Response, _next: NextFunction) => {
        // 민감 정보(연결 문자열)를 담은 에러를 던져 redaction 파이프라인을 검증한다.
        throw new Error('connect failed: postgres://admin:s3cr3t@db.internal:5432/prod');
    });

    errs.forEach((e) => app.use(e));
    return app;
}

describe('전역 미들웨어 스택 (실제 middleware.ts) 통합', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    it('helmet 보안 헤더를 응답에 부착한다', async () => {
        const app = buildAppWithRealMiddleware();
        const res = await request(app).get('/echo');
        expect(res.status).toBe(200);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['content-security-policy']).toBeDefined();
    });

    it('kusto 초기화 미들웨어가 req.kusto 를 채운다', async () => {
        const app = buildAppWithRealMiddleware();
        const res = await request(app).get('/echo');
        expect(res.body.hasKusto).toBe(true);
    });

    it('clientIp 미들웨어가 req.ip 를 채운다 (XFF 존중)', async () => {
        const app = buildAppWithRealMiddleware();
        const res = await request(app).get('/echo').set('X-Forwarded-For', '203.0.113.7');
        expect(typeof res.body.ip).toBe('string');
        expect(res.body.ip).toContain('203.0.113.7');
    });

    it('cookie-parser 가 Cookie 헤더를 파싱한다', async () => {
        const app = buildAppWithRealMiddleware();
        const res = await request(app).get('/echo').set('Cookie', 'session=abc123');
        expect(res.body.cookies?.session).toBe('abc123');
    });

    it('body-parser 가 application/vnd.api+json 본문을 파싱한다', async () => {
        const app = buildAppWithRealMiddleware();
        const payload = { data: { type: 'widgets', attributes: { name: 'x' } } };
        const res = await request(app)
            .post('/echo-body')
            .set('Content-Type', 'application/vnd.api+json')
            .send(JSON.stringify(payload));
        expect(res.status).toBe(200);
        expect(res.body.body).toEqual(payload);
    });

    it('CORS 화이트리스트에 없는 Origin 은 ACAO 헤더를 받지 못한다', async () => {
        const app = buildAppWithRealMiddleware();
        const res = await request(app).get('/echo').set('Origin', 'http://evil.example.com');
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('전역 에러 핸들러가 JSON:API 형태로 응답하고 연결 문자열을 redaction 한다', async () => {
        const app = buildAppWithRealMiddleware();
        const res = await request(app).get('/boom');
        expect(res.status).toBe(500);
        // JSON:API 에러 봉투
        expect(Array.isArray(res.body.errors)).toBe(true);
        // 원본 연결 문자열이 응답으로 새어나가지 않아야 한다.
        const serialized = JSON.stringify(res.body);
        expect(serialized).not.toContain('postgres://admin:s3cr3t@db.internal:5432/prod');
        expect(serialized).not.toContain('s3cr3t');
    });
});
