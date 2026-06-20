import { defaultGlobalMiddleware, resolveCorsWhitelist } from '@lib/http/routing/globalMiddleware';

describe('defaultGlobalMiddleware — 정책 스택', () => {
    it('기본은 helmet/cors/cookie/body.json/body.urlencoded/log = 6개', () => {
        const stack = defaultGlobalMiddleware();
        expect(stack).toHaveLength(6);
        expect(stack.every((m) => typeof m === 'function')).toBe(true);
        // 모두 일반 미들웨어(에러 핸들러 아님) — arity !== 4
        expect(stack.every((m) => (m as Function).length !== 4)).toBe(true);
    });

    it('disableRequestLog 면 로깅 미들웨어를 빼 5개', () => {
        expect(defaultGlobalMiddleware({ disableRequestLog: true })).toHaveLength(5);
    });
});

describe('resolveCorsWhitelist — env 파싱', () => {
    const ORIG = process.env.CORS_WHITELIST;
    afterEach(() => { process.env.CORS_WHITELIST = ORIG; });

    it('명시 인자 우선', () => {
        expect(resolveCorsWhitelist(['https://a.com'])).toEqual(['https://a.com']);
    });
    it('JSON 배열 형식', () => {
        process.env.CORS_WHITELIST = '["https://a.com","https://b.com"]';
        expect(resolveCorsWhitelist()).toEqual(['https://a.com', 'https://b.com']);
    });
    it('콤마 구분 형식', () => {
        process.env.CORS_WHITELIST = 'https://a.com, https://b.com';
        expect(resolveCorsWhitelist()).toEqual(['https://a.com', 'https://b.com']);
    });
    it('미설정이면 빈 배열', () => {
        delete process.env.CORS_WHITELIST;
        expect(resolveCorsWhitelist()).toEqual([]);
    });
});
