import { injectedMiddleware } from '@lib/http/routing/middlewareHelpers';

/**
 * P2-13 회귀 테스트: WITH() 의 arity 휴리스틱(fn.length >= 6)은 기본값/rest 파라미터에
 * 취약하다. injectedMiddleware() 마커로 감싸면 arity 와 무관하게 injected 미들웨어로
 * 올바르게 분류된다.
 */
describe('injectedMiddleware 브랜딩 (P2-13)', () => {
    it('마커(__kustoInjected)를 부여하고 동일 함수를 반환한다', () => {
        const fn = ((req: any, res: any, next: any, _injected: any, _repo: any, _db: any) => {
            void next;
        }) as any;
        const branded = injectedMiddleware(fn);
        expect(branded).toBe(fn);
        expect((branded as any).__kustoInjected).toBe(true);
    });

    it('기본값 파라미터로 arity 휴리스틱이 실패(length<6)해도 마커는 유효하다', () => {
        // db 에 기본값이 있어 Function.length 가 5 로 줄어든다 → 휴리스틱이라면 오분류
        const fn = ((
            req: any,
            res: any,
            next: any,
            injected: any,
            repo: any,
            _db: any = undefined,
        ) => {
            void next;
        }) as any;
        expect(fn.length).toBeLessThan(6);
        const branded = injectedMiddleware(fn);
        expect((branded as any).__kustoInjected).toBe(true);
    });
});
