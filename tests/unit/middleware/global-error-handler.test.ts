import middlewares from '@app/routes/middleware';

/**
 * P1-7 회귀 테스트: 전역 에러 핸들러는
 *  (1) arity 4 로 존재하고 배열의 마지막 요소여야 한다 (loadRoutes 가 라우트 뒤에 mount 하기 위함),
 *  (2) production 에서 raw err.message(연결 문자열/시크릿)를 노출하지 않고 ErrorHandler redaction 을 경유하며,
 *  (3) headersSent 이면 next 로 위임한다.
 */
function getErrorHandler(arr: any[]) {
    return arr.find((m) => typeof m === 'function' && m.length === 4);
}

describe('전역 에러 핸들러 (P1-7)', () => {
    const OLD_ENV = process.env;
    afterEach(() => { process.env = OLD_ENV; });

    it('에러 핸들러가 arity 4 로 존재하고 배열의 마지막 요소다', () => {
        const handler = getErrorHandler(middlewares);
        expect(handler).toBeDefined();
        expect(middlewares[middlewares.length - 1]).toBe(handler);
    });

    it('production 에서 raw err.message(연결 문자열/시크릿)를 노출하지 않는다', () => {
        process.env = { ...OLD_ENV, NODE_ENV: 'production' };
        const handler = getErrorHandler(middlewares)!;
        const err = new Error('connect postgres://user:secret@host:5432/db failed');

        let statusCode = 0;
        let body: any;
        const res: any = {
            headersSent: false,
            status(c: number) { statusCode = c; return this; },
            json(b: any) { body = b; return this; },
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
        const handler = getErrorHandler(middlewares)!;
        let nexted = false;
        const res: any = { headersSent: true, status() { return this; }, json() { return this; } };
        handler(new Error('boom'), {} as any, res, (() => { nexted = true; }) as any);
        expect(nexted).toBe(true);
    });
});
