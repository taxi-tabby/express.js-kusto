import { ExpressRouter } from '@lib/http/routing/expressRouter';

// 본 프로젝트의 ExpressRouter 는 GET/POST/PUT/PATCH/DELETE 가 (handler, options?) 시그니처이며
// 내부적으로 '/' 경로에 라우트를 등록한다. NOTFOUND 는 router.all('*', ...) 으로 등록된다.

describe('ExpressRouter fluent API', () => {
    it('새 인스턴스 생성 직후 build() 를 호출할 때 Express Router 객체가 반환된다', () => {
        const router = new ExpressRouter();
        const built = router.build();
        expect(built).toBeDefined();
        // Express Router 는 함수이면서 stack 속성을 가진다
        expect(typeof built).toBe('function');
        expect(Array.isArray((built as any).stack)).toBe(true);
    });

    it('GET 호출 후 build() 를 호출할 때 stack 에 GET 라우트가 등록된다', () => {
        const router = new ExpressRouter();
        router.GET((req, res) => res.json({}));
        const built = router.build();
        const stack = (built as any).stack;
        expect(stack.length).toBeGreaterThan(0);
        const hasGet = stack.some((layer: any) => layer.route?.methods?.get);
        expect(hasGet).toBe(true);
    });

    it('POST 와 PUT 을 체이닝으로 호출할 때 둘 다 stack 에 등록된다', () => {
        const router = new ExpressRouter();
        router.POST((req, res) => res.json({})).PUT((req, res) => res.json({}));
        const stack = (router.build() as any).stack;
        const methods = stack.flatMap((l: any) => (l.route ? Object.keys(l.route.methods) : []));
        expect(methods).toContain('post');
        expect(methods).toContain('put');
    });

    it('DELETE 호출 후 build() 의 stack 에 DELETE 라우트가 포함된다', () => {
        const router = new ExpressRouter();
        router.DELETE((req, res) => res.json({}));
        const stack = (router.build() as any).stack;
        const hasDelete = stack.some((layer: any) => layer.route?.methods?.delete);
        expect(hasDelete).toBe(true);
    });

    it('NOTFOUND 핸들러를 등록할 때 stack 의 마지막 또는 catch-all 로 추가된다', () => {
        const router = new ExpressRouter();
        router.GET((req, res) => res.json({}));
        router.NOTFOUND((req, res) => res.status(404).json({}));
        const stack = (router.build() as any).stack;
        // GET 라우트 + NOTFOUND(catch-all) 두 개 이상의 layer 가 등록되어야 한다
        expect(stack.length).toBeGreaterThan(1);
    });

    it('체이닝이 같은 인스턴스를 반환할 때 메서드 호출이 연속될 수 있다', () => {
        const router = new ExpressRouter();
        const chained = router.GET((req, res) => res.json({}));
        expect(chained).toBe(router);
    });

    it('USE 메서드로 일반 미들웨어를 등록할 때 stack 의 길이가 증가한다', () => {
        const router1 = new ExpressRouter();
        const before = (router1.build() as any).stack.length;

        const router2 = new ExpressRouter();
        router2.USE((req, res, next) => next());
        const after = (router2.build() as any).stack.length;

        expect(after).toBeGreaterThan(before);
    });

    it('빈 인스턴스에서 build() 는 stack 이 비어있는 Router 를 반환한다', () => {
        const router = new ExpressRouter();
        const built = router.build();
        expect((built as any).stack.length).toBe(0);
    });
});
