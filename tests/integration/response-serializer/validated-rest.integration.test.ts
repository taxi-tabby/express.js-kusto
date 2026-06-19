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
    app.use(express.json());
    app.use(router.build());
    return app;
}

describe('나머지 VALIDATED serialize', () => {
    it('POST_VALIDATED {omit}', async () => {
        const app = appWith(r => r.POST_VALIDATED(
            {}, { 200: { id: { type: 'number' }, secret: { type: 'string' } } },
            async () => ({ id: 1, secret: 'x' }), { serialize: { omit: ['secret'] } }));
        const res = await request(app).post('/');
        expect(res.body.data).toEqual({ id: 1 });
    });
    it('PUT_VALIDATED {pick}', async () => {
        const app = appWith(r => r.PUT_VALIDATED(
            {}, { 200: { id: { type: 'number' }, a: { type: 'number' } } },
            async () => ({ id: 1, a: 2 }), { serialize: { pick: ['id'] } }));
        const res = await request(app).put('/');
        expect(res.body.data).toEqual({ id: 1 });
    });
    it('PATCH_VALIDATED 함수형', async () => {
        const app = appWith(r => r.PATCH_VALIDATED(
            {}, { 200: { id: { type: 'number' } } },
            async () => ({ id: 1, t: 'x' }), { serialize: (u) => ({ id: u.id }) }));
        const res = await request(app).patch('/');
        expect(res.body.data).toEqual({ id: 1 });
    });
    it('DELETE_VALIDATED {omit}', async () => {
        const app = appWith(r => r.DELETE_VALIDATED(
            {}, { 200: { id: { type: 'number' }, internal: { type: 'boolean' } } },
            async () => ({ id: 1, internal: true }), { serialize: { omit: ['internal'] } }));
        const res = await request(app).delete('/');
        expect(res.body.data).toEqual({ id: 1 });
    });
    it('POST_SLUG_VALIDATED {omit}', async () => {
        const app = appWith(r => r.POST_SLUG_VALIDATED(
            ['id'], {}, { 200: { id: { type: 'number' }, secret: { type: 'string' } } },
            async () => ({ id: 1, secret: 'x' }), { serialize: { omit: ['secret'] } }));
        const res = await request(app).post('/1');
        expect(res.body.data).toEqual({ id: 1 });
    });
    it('PATCH_SLUG_VALIDATED {omit}', async () => {
        const app = appWith(r => r.PATCH_SLUG_VALIDATED(
            ['id'], {}, { 200: { id: { type: 'number' }, secret: { type: 'string' } } },
            async () => ({ id: 1, secret: 'x' }), { serialize: { omit: ['secret'] } }));
        const res = await request(app).patch('/1');
        expect(res.body.data).toEqual({ id: 1 });
    });
    it('PUT_SLUG_VALIDATED {omit}', async () => {
        const app = appWith(r => r.PUT_SLUG_VALIDATED(
            ['id'], {}, { 200: { id: { type: 'number' }, secret: { type: 'string' } } },
            async () => ({ id: 1, secret: 'x' }), { serialize: { omit: ['secret'] } }));
        const res = await request(app).put('/1');
        expect(res.body.data).toEqual({ id: 1 });
    });
    it('DELETE_SLUG_VALIDATED {omit}', async () => {
        const app = appWith(r => r.DELETE_SLUG_VALIDATED(
            ['id'], {}, { 200: { id: { type: 'number' }, secret: { type: 'string' } } },
            async () => ({ id: 1, secret: 'x' }), { serialize: { omit: ['secret'] } }));
        const res = await request(app).delete('/1');
        expect(res.body.data).toEqual({ id: 1 });
    });
});
