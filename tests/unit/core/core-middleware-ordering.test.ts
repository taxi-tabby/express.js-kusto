/**
 * 회귀 테스트(전역 에러 핸들러 등록 순서):
 *  Core.initialize() 는 비동기 loadRoutes() 를 *await* 한 뒤 전역 에러 핸들러(globalErrorMiddleware)를
 *  마운트해야 한다. await 하지 않으면 라우트 등록이 microtask 로 미뤄져 에러 핸들러가 라우트보다 *먼저*
 *  깔리고, 결과적으로 라우트에서 던진 에러를 못 잡아 Express 기본 HTML 핸들러로 새어나간다
 *  (비프로덕션에서 스택 트레이스 노출).
 *
 *  이 테스트는 실제 Core 를 부팅하되 loadRoutes 를 "await 후 throw 라우트를 등록하는" async mock 으로
 *  교체한다. 따라서 await 누락(회귀) 시 라우트가 에러 핸들러 뒤에 등록되어 JSON:API 500 이 아닌
 *  Express 기본 응답이 나가고, 이 테스트가 실패한다.
 */
describe('Core 전역 에러 핸들러 등록 순서 회귀', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = {
            ...OLD_ENV,
            NODE_ENV: 'test',
            AUTO_DOCS: 'false',
            ENABLE_SCHEMA_API: 'false',
        };
    });

    afterEach(() => {
        process.env = OLD_ENV;
        jest.resetModules();
    });

    function bootCoreWithThrowingRoute() {
        // 실제 loadRoutes 처럼 비동기로(동적 라우트맵 await) 라우트를 등록한다.
        // await 뒤에 등록 → Core 가 await 하지 않으면 microtask 로 밀려 에러 핸들러보다 뒤늦게 깔린다.
        jest.doMock('@lib/http/routing/loadRoutes_V6_Clean', () => ({
            __esModule: true,
            default: jest.fn(async (app: any) => {
                await Promise.resolve();
                app.get('/__boom', () => {
                    throw new Error('route blew up');
                });
            }),
        }));
        jest.doMock('@lib/data/database/prismaManager', () => ({
            __esModule: true,
            prismaManager: {
                initialize: jest.fn(async () => {}),
                getStatus: jest.fn(() => ({
                    initialized: true,
                    connectedDatabases: 1,
                    totalDatabases: 1,
                    databases: [{ name: 'default', connected: true, generated: true }],
                })),
                isConnected: jest.fn(() => true),
            },
        }));
        jest.doMock('@lib/data/database/repositoryManager', () => ({
            __esModule: true,
            repositoryManager: {
                initialize: jest.fn(async () => {}),
                getStatus: jest.fn(() => ({
                    initialized: true,
                    repositoryCount: 0,
                    repositories: [],
                })),
            },
        }));
        jest.doMock('@lib/data/di/dependencyInjector', () => ({
            __esModule: true,
            DependencyInjector: {
                getInstance: () => ({ initialize: jest.fn(async () => {}) }),
            },
        }));

        const { Core } = require('@core/bootstrap/Core');
        return Core.getInstance();
    }

    it('라우트에서 던진 에러를 전역 에러 핸들러가 잡아 JSON:API 500 으로 응답한다', async () => {
        const core = bootCoreWithThrowingRoute();
        await core.initialize({ routesPath: './src/app/routes' });

        const request = require('supertest');
        const res = await request(core.app).get('/__boom');

        expect(res.status).toBe(500);
        // globalErrorMiddleware 의 JSON:API 형태(errors 배열) — Express 기본 HTML 핸들러가 아님.
        expect(res.type).toMatch(/json/);
        expect(res.body).toHaveProperty('errors');
    });
});
