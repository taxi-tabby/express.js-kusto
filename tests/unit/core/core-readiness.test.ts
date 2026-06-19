/**
 * P0-1 회귀 테스트:
 *  - Repo/DI 초기화의 top-level 실패는 부팅을 fail-fast 한다 (요청 시점 500 위장 금지).
 *  - DB 연결 실패는 부팅을 막지 않되(서버리스 lazy-reconnect), degraded + /healthz 503 으로 노출한다.
 */
describe('Core readiness / fail-fast boot (P0-1)', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV, NODE_ENV: 'test', AUTO_DOCS: 'false', ENABLE_SCHEMA_API: 'false' };
    });

    afterEach(() => {
        process.env = OLD_ENV;
        jest.resetModules();
    });

    function mockManagersAndGetCore(opts: {
        repoThrows?: boolean;
        diThrows?: boolean;
        prismaThrows?: boolean;
        prismaStatus?: { connectedDatabases: number; totalDatabases: number };
    }) {
        jest.doMock('@lib/loadRoutes_V6_Clean', () => ({ __esModule: true, default: jest.fn() }));
        jest.doMock('@lib/prismaManager', () => ({
            __esModule: true,
            prismaManager: {
                initialize: jest.fn(async () => { if (opts.prismaThrows) throw new Error('db down'); }),
                getStatus: jest.fn(() => ({
                    initialized: true,
                    connectedDatabases: opts.prismaStatus?.connectedDatabases ?? 1,
                    totalDatabases: opts.prismaStatus?.totalDatabases ?? 1,
                    databases: [],
                })),
                isConnected: jest.fn(() => true),
            },
        }));
        jest.doMock('@lib/repositoryManager', () => ({
            __esModule: true,
            repositoryManager: {
                initialize: jest.fn(async () => { if (opts.repoThrows) throw new Error('repo registry broken'); }),
                getStatus: jest.fn(() => ({ initialized: true, repositoryCount: 0, repositories: [] })),
            },
        }));
        jest.doMock('@lib/dependencyInjector', () => ({
            __esModule: true,
            DependencyInjector: {
                getInstance: () => ({
                    initialize: jest.fn(async () => { if (opts.diThrows) throw new Error('di broken'); }),
                }),
            },
        }));

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Core } = require('@core/Core');
        return Core.getInstance();
    }

    it('repo 초기화 실패 시 부팅을 fail-fast 한다 (initialize rejects)', async () => {
        const core = mockManagersAndGetCore({ repoThrows: true });
        await expect(core.initialize({ routesPath: './src/app/routes' })).rejects.toThrow(/repo/i);
    });

    it('DI 초기화 실패 시 부팅을 fail-fast 한다 (initialize rejects)', async () => {
        const core = mockManagersAndGetCore({ diThrows: true });
        await expect(core.initialize({ routesPath: './src/app/routes' })).rejects.toThrow(/di/i);
    });

    it('DB 연결 실패는 부팅을 막지 않지만 degraded + /healthz 503 으로 노출한다', async () => {
        const core = mockManagersAndGetCore({ prismaThrows: true });
        await expect(core.initialize({ routesPath: './src/app/routes' })).resolves.toBeDefined();

        const readiness = core.getReadiness();
        expect(readiness.ready).toBe(false);
        expect(readiness.status).toBe('degraded');

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const request = require('supertest');
        const res = await request(core.app).get('/healthz');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('degraded');
    });

    it('일부 DB 만 연결돼도 degraded (connected < total)', async () => {
        const core = mockManagersAndGetCore({ prismaStatus: { connectedDatabases: 1, totalDatabases: 2 } });
        await core.initialize({ routesPath: './src/app/routes' });
        expect(core.getReadiness().ready).toBe(false);
    });

    it('정상 부팅 시 /healthz 200 (ok)', async () => {
        const core = mockManagersAndGetCore({ prismaStatus: { connectedDatabases: 1, totalDatabases: 1 } });
        await core.initialize({ routesPath: './src/app/routes' });

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const request = require('supertest');
        const res = await request(core.app).get('/healthz');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });
});
