import express from 'express';
import request from 'supertest';
import { ExpressRouter } from '@lib/http/routing/expressRouter';

/**
 * ExpressRouter.registerMethod — 확장 시스템의 런타임 메서드 등록 기반.
 * prototype 부착 + 체이닝(this 반환) + 실제 라우트 mount + 충돌/멱등 가드를 검증한다.
 */
describe('ExpressRouter.registerMethod (확장 메서드 런타임 등록)', () => {
    afterEach(() => ExpressRouter.clearExtensionMethods());

    it('등록한 메서드가 인스턴스에 부착되고 this 를 반환한다(체이닝)', () => {
        const calls: Array<string | undefined> = [];
        ExpressRouter.registerMethod('GET_PING', (_ctx, label?: string) => { calls.push(label); });
        const r = new ExpressRouter();
        const ret = (r as any).GET_PING('x');
        expect(ret).toBe(r);
        expect(calls).toEqual(['x']);
    });

    it('등록 메서드가 ctx.router 로 실제 라우트를 mount 한다', async () => {
        ExpressRouter.registerMethod('GET_PING', (ctx) => {
            ctx.router.get('/ping', (_req: express.Request, res: express.Response) => { res.json({ pong: true }); });
        });
        const r = new ExpressRouter();
        (r as any).GET_PING();
        const app = express();
        app.use(r.build());
        const res = await request(app).get('/ping');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ pong: true });
    });

    it('빌트인 멤버 이름과 충돌하면 throw 한다', () => {
        expect(() => ExpressRouter.registerMethod('GET', () => {})).toThrow(/built-in/);
        expect(() => ExpressRouter.registerMethod('build', () => {})).toThrow(/built-in/);
        expect(() => ExpressRouter.registerMethod('CRUD', () => {})).toThrow(/built-in/);
    });

    it('같은 이름 다른 impl 은 throw, 같은 impl 재등록은 멱등', () => {
        const a = () => {};
        const b = () => {};
        ExpressRouter.registerMethod('GET_X', a);
        expect(() => ExpressRouter.registerMethod('GET_X', a)).not.toThrow();
        expect(() => ExpressRouter.registerMethod('GET_X', b)).toThrow(/already registered/);
    });

    it('빈 이름은 throw 한다', () => {
        expect(() => ExpressRouter.registerMethod('', () => {})).toThrow();
    });

    it('impl 이 함수가 아니면 throw 한다', () => {
        expect(() => ExpressRouter.registerMethod('GET_BAD', 'nope' as any)).toThrow(/must be a function/);
        expect(() => ExpressRouter.registerMethod('GET_BAD', undefined as any)).toThrow(/must be a function/);
    });

    it('생성자 인스턴스 필드 이름(router/basePath 등)과 충돌하면 throw 한다', () => {
        for (const reserved of ['router', 'basePath', 'schemaRegistry', 'schemaAnalyzer']) {
            expect(() => ExpressRouter.registerMethod(reserved, () => {})).toThrow(/built-in/);
        }
    });

    it('clearExtensionMethods 가 등록 메서드를 제거하고 재등록을 허용한다', () => {
        ExpressRouter.registerMethod('GET_TEMP', () => {});
        expect(typeof (ExpressRouter.prototype as any).GET_TEMP).toBe('function');
        ExpressRouter.clearExtensionMethods();
        expect((ExpressRouter.prototype as any).GET_TEMP).toBeUndefined();
        expect(() => ExpressRouter.registerMethod('GET_TEMP', () => {})).not.toThrow();
    });
});
