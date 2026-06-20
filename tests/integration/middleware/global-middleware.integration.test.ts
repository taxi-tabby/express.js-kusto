import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

/**
 * 전역 미들웨어 스택(src/app/routes/middleware.ts)을 "있는 그대로" 마운트해
 * helmet / CORS / cookie-parser / body-parser(JSON:API) / clientIp / kusto 초기화 /
 * 전역 에러 핸들러(redaction)가 실제로 동작하는지 end-to-end 로 검증한다.
 *
 * 기존 통합 테스트(test-app.ts)는 라우팅·CRUD 검증에 집중하느라 express.json() 만 단
 * 최소 앱을 썼다 — 운영 미들웨어 체인 자체는 어디서도 통과하지 않았다. 이 테스트가 그 빈틈을 메운다.
 *
 * DB 의존이 없다(미들웨어는 req.kusto 에 싱글톤을 대입할 뿐 DB 에 접속하지 않음).
 */

// 미들웨어 배열은 import 시점에 평가된다(예: CORS whitelist). 결정적 테스트를 위해
// import 전에 환경을 고정한다.
const ORIGINAL_ENV = { ...process.env };

function loadMiddlewareStack(): Array<express.RequestHandler | express.ErrorRequestHandler> {
    // late require 로, 위에서 고정한 env 가 반영된 상태에서 모듈을 로드한다.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@app/routes/middleware');
    return (mod.default ?? mod) as Array<express.RequestHandler | express.ErrorRequestHandler>;
}

/**
 * 실제 라우트 로더와 동일하게 4-arg(에러) 핸들러를 라우트 뒤에 mount 한다.
 * pre = fn.length !== 4, errorHandlers = fn.length === 4.
 */
function buildAppWithRealMiddleware(): express.Express {
    const stack = loadMiddlewareStack();
    const pre = stack.filter((fn) => (fn as Function).length !== 4) as express.RequestHandler[];
    const errs = stack.filter((fn) => (fn as Function).length === 4) as express.ErrorRequestHandler[];

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
