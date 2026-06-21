import { globalErrorMiddleware } from '@lib/http/routing/frameworkMiddleware';

/**
 * P1-7 회귀 테스트: 전역 에러 핸들러(이제 Core 소유 = globalErrorMiddleware)는
 *  (1) arity 4(err,req,res,next) 다 — Core 가 라우트 뒤 맨 마지막에 mount 한다,
 *  (2) production 에서 raw err.message(연결 문자열/시크릿)를 노출하지 않고 ErrorHandler redaction 을 경유하며,
 *  (3) headersSent 이면 next 로 위임한다.
 */
describe('전역 에러 핸들러 (P1-7)', () => {
    const OLD_ENV = process.env;
    afterEach(() => {
        process.env = OLD_ENV;
    });

    it('arity 4(err,req,res,next) 핸들러다', () => {
        expect(typeof globalErrorMiddleware).toBe('function');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        expect((globalErrorMiddleware as Function).length).toBe(4);
    });

    it('production 에서 raw err.message(연결 문자열/시크릿)를 노출하지 않는다', () => {
        process.env = { ...OLD_ENV, NODE_ENV: 'production' };
        const handler = globalErrorMiddleware;
        const err = new Error('connect postgres://user:secret@host:5432/db failed');

        let statusCode = 0;
        let body: any;
        const res: any = {
            headersSent: false,
            status(c: number) {
                statusCode = c;
                return this;
            },
            json(b: any) {
                body = b;
                return this;
            },
        };

        handler(err, { originalUrl: '/x', method: 'GET' } as any, res, (() => {}) as any);

        expect(statusCode).toBe(500);
        const serialized = JSON.stringify(body);
        expect(serialized).not.toContain('postgres://');
        expect(serialized).not.toContain('secret');
        // ErrorHandler 의 JSON:API 형태 (errors 배열)
        expect(body).toHaveProperty('errors');
    });

    it('headersSent 이면 next 로 위임한다 (이중 응답 방지)', () => {
        const handler = globalErrorMiddleware;
        let nexted = false;
        const res: any = {
            headersSent: true,
            status() {
                return this;
            },
            json() {
                return this;
            },
        };
        handler(new Error('boom'), {} as any, res, (() => {
            nexted = true;
        }) as any);
        expect(nexted).toBe(true);
    });
});
