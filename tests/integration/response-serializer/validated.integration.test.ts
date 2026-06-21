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

describe('VALIDATED serialize', () => {
    it('serialize 가 responseConfig 검증보다 먼저 적용되어 secret 이 제거된다', async () => {
        // responseConfig 스키마에는 secret 이 있어도(=responseConfig 만으로는 유지),
        // serialize 가 먼저 제거하므로 응답 data 에는 secret 이 없어야 한다.
        const app = appWith((r) =>
            r.GET_VALIDATED(
                {},
                {
                    200: {
                        id: { type: 'number' },
                        name: { type: 'string' },
                        secret: { type: 'string' },
                    },
                },
                async () => ({ id: 1, name: 'a', secret: 'x' }),
                { serialize: { omit: ['secret'] } },
            ),
        );
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({ id: 1, name: 'a' });
        expect(res.body.data.secret).toBeUndefined();
    });

    it('serialize 미지정 VALIDATED 는 기존대로 동작한다 (회귀)', async () => {
        const app = appWith((r) =>
            r.GET_VALIDATED({}, { 200: { id: { type: 'number' } } }, async () => ({ id: 1 })),
        );
        const res = await request(app).get('/');
        expect(res.body.data).toEqual({ id: 1 });
    });
});
