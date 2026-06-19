import express from 'express';
import request from 'supertest';
import { ExpressRouter } from '@lib/expressRouter';
import { DependencyInjector } from '@lib/dependencyInjector';

beforeAll(() => {
    const di = DependencyInjector.getInstance() as any;
    di.initialized = true;
    di.modules = {};
});

function appWith(build: (r: ExpressRouter) => void) {
    const router = new ExpressRouter();
    build(router);
    const app = express();
    app.use(router.build());
    return app;
}

describe('plain GET serialize (옵션 파라미터)', () => {
    it('{omit} 으로 민감 필드를 제거해 응답한다', async () => {
        const app = appWith(r =>
            r.GET(async () => ({ id: 1, password: 'secret', name: 'kim' }),
                  { serialize: { omit: ['password'] } }));
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ id: 1, name: 'kim' });
    });

    it('{pick} 으로 노출 필드만 응답한다', async () => {
        const app = appWith(r =>
            r.GET(async () => ({ id: 1, password: 'secret', name: 'kim' }),
                  { serialize: { pick: ['id', 'name'] } }));
        const res = await request(app).get('/');
        expect(res.body).toEqual({ id: 1, name: 'kim' });
    });

    it('함수형 serializer 로 재구성해 응답한다', async () => {
        const app = appWith(r =>
            r.GET(async () => ({ id: 1, first: 'a', last: 'b' }),
                  { serialize: (u) => ({ id: u.id, full: `${u.first} ${u.last}` }) }));
        const res = await request(app).get('/');
        expect(res.body).toEqual({ id: 1, full: 'a b' });
    });

    it('배열 응답에 {omit} 을 원소별 적용한다', async () => {
        const app = appWith(r =>
            r.GET(async () => [{ id: 1, password: 'x' }, { id: 2, password: 'y' }],
                  { serialize: { omit: ['password'] } }));
        const res = await request(app).get('/');
        expect(res.body).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('serialize 미지정 시 기존 동작(핸들러가 직접 res.json) 유지 (회귀)', async () => {
        const app = appWith(r =>
            r.GET((req, res) => { res.json({ id: 1, password: 'kept' }); }));
        const res = await request(app).get('/');
        expect(res.body).toEqual({ id: 1, password: 'kept' });
    });
});
