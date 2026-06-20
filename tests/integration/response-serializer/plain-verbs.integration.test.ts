import express from 'express';
import request from 'supertest';
import { ExpressRouter } from '@lib/http/routing/expressRouter';
import { DependencyInjector } from '@lib/data/di/dependencyInjector';

beforeAll(() => {
    const di = DependencyInjector.getInstance() as any;
    di.initialized = true;
    di.modules = {};
});

function appWith(build: (r: ExpressRouter) => void) {
    const router = new ExpressRouter();
    build(router);
    const app = express();
    app.use(express.json());
    app.use(router.build());
    return app;
}

describe('나머지 plain verb serialize', () => {
    it('POST {omit}', async () => {
        const app = appWith(r => r.POST(async () => ({ id: 1, password: 'x' }), { serialize: { omit: ['password'] } }));
        const res = await request(app).post('/');
        expect(res.body).toEqual({ id: 1 });
    });
    it('PUT {pick}', async () => {
        const app = appWith(r => r.PUT(async () => ({ id: 1, a: 1, b: 2 }), { serialize: { pick: ['id', 'a'] } }));
        const res = await request(app).put('/');
        expect(res.body).toEqual({ id: 1, a: 1 });
    });
    it('PATCH 함수형', async () => {
        const app = appWith(r => r.PATCH(async () => ({ id: 1, t: 'x' }), { serialize: (u) => ({ id: u.id }) }));
        const res = await request(app).patch('/');
        expect(res.body).toEqual({ id: 1 });
    });
    it('DELETE {omit}', async () => {
        const app = appWith(r => r.DELETE(async () => ({ id: 1, internal: true }), { serialize: { omit: ['internal'] } }));
        const res = await request(app).delete('/');
        expect(res.body).toEqual({ id: 1 });
    });
    it('GET_SLUG / POST_SLUG / PUT_SLUG / DELETE_SLUG / PATCH_SLUG {omit}', async () => {
        const app = appWith(r => {
            r.POST_SLUG(['id'], async () => ({ id: 1, password: 'x' }), { serialize: { omit: ['password'] } });
        });
        const res = await request(app).post('/1');
        expect(res.body).toEqual({ id: 1 });
    });
});
