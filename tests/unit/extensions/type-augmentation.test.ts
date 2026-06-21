import { ExpressRouter } from '@lib/http/routing/expressRouter';

/**
 * IDE 타입 합류(declaration merging) 메커니즘 검증.
 * 확장 패키지가 ships 하는 `.d.ts` 와 동일하게 ExpressRouter 인터페이스를 augment 하면,
 * 새 메서드가 클래스 인스턴스 타입에 합류해야 한다(컴파일 타임 — ts-jest 가 타입 체크).
 */
declare module '@lib/http/routing/expressRouter' {
    interface ExpressRouter {
        GET_AUGMENTED(component: string): this;
    }
}

describe('ExpressRouter 타입 augmentation (declaration merging)', () => {
    afterEach(() => ExpressRouter.clearExtensionMethods());

    it('augment 된 메서드가 타입에 합류하고 체이닝 타입이 보존된다', () => {
        let received: string | undefined;
        ExpressRouter.registerMethod('GET_AUGMENTED', (_ctx, component: string) => {
            received = component;
        });

        const r = new ExpressRouter();
        // GET_AUGMENTED 가 타입에 존재해야 컴파일된다(체이닝은 this 반환).
        const ret: ExpressRouter = r.GET_AUGMENTED('Home');
        expect(ret).toBe(r);
        expect(received).toBe('Home');

        // 정의되지 않은 메서드는 타입 에러여야 한다(실행되지 않는 죽은 분기에서 검증).
        if (false as boolean) {
            // @ts-expect-error 정의되지 않은 라우터 메서드
            r.GET_DOES_NOT_EXIST('x');
        }
    });
});
