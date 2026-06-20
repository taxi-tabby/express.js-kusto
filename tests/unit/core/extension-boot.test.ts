/**
 * Core 확장 부팅 순서 통합 테스트.
 * Core.initialize() 는 확장의 onInit 훅을 라우트 로드보다 *먼저* 실행해야 한다
 * (확장이 등록한 정적/미들웨어가 라우트에 선행하도록). 실제 Core 를 부팅하되
 * loadExtensions/loadRoutes 를 mock 으로 교체해 실행 순서를 기록·검증한다.
 */
describe('Core 확장 부팅 순서', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV, NODE_ENV: 'test', AUTO_DOCS: 'false', ENABLE_SCHEMA_API: 'false' };
    });

    afterEach(() => {
        process.env = OLD_ENV;
        jest.resetModules();
    });

    it('확장 onInit 이 라우트 로드보다 먼저 실행된다', async () => {
        const order: string[] = [];

        // loadExtensions mock: 실제 레지스트리에 onInit 확장을 등록한다.
        jest.doMock('@lib/extensions/loadExtensions', () => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { extensionRegistry } = require('@lib/extensions/extensionRegistry');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { ExpressRouter } = require('@lib/http/routing/expressRouter');
            const fn = jest.fn(() => {
                const ext = { name: 'order-probe', routerMethods: { GET_PROBE: () => {} }, onInit: () => { order.push('init'); } };
                ExpressRouter.registerMethod('GET_PROBE', ext.routerMethods.GET_PROBE);
                extensionRegistry.register(ext);
                return [ext];
            });
            return { __esModule: true, default: fn };
        });
        jest.doMock('@lib/http/routing/loadRoutes_V6_Clean', () => ({
            __esModule: true,
            default: jest.fn(async () => {
                await Promise.resolve();
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { ExpressRouter } = require('@lib/http/routing/expressRouter');
                // 라우트 로드 시점엔 확장 routerMethods 가 이미 prototype 에 등록되어 있어야 한다.
                order.push(typeof (ExpressRouter.prototype as any).GET_PROBE === 'function' ? 'method-present' : 'method-missing');
                order.push('routes');
            }),
        }));
        jest.doMock('@lib/data/database/prismaManager', () => ({ __esModule: true, prismaManager: {
            initialize: jest.fn(async () => {}),
            getStatus: jest.fn(() => ({
                initialized: true, connectedDatabases: 1, totalDatabases: 1,
                databases: [{ name: 'default', connected: true, generated: true }],
            })),
            isConnected: jest.fn(() => true),
        } }));
        jest.doMock('@lib/data/database/repositoryManager', () => ({ __esModule: true, repositoryManager: {
            initialize: jest.fn(async () => {}),
            getStatus: jest.fn(() => ({ initialized: true, repositoryCount: 0, repositories: [] })),
        } }));
        jest.doMock('@lib/data/di/dependencyInjector', () => ({ __esModule: true, DependencyInjector: {
            getInstance: () => ({ initialize: jest.fn(async () => {}) }),
        } }));

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { extensionRegistry } = require('@lib/extensions/extensionRegistry');
        extensionRegistry.clear();
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Core } = require('@core/bootstrap/Core');
        const core = Core.getInstance();
        await core.initialize({ routesPath: './src/app/routes' });

        // onInit 이 라우트보다 먼저 실행되고, routerMethods 도 라우트 로드 시점엔 이미 등록되어 있어야 한다.
        expect(order).toEqual(['init', 'method-present', 'routes']);
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('@lib/http/routing/expressRouter').ExpressRouter.clearExtensionMethods();
        extensionRegistry.clear();
    });
});
