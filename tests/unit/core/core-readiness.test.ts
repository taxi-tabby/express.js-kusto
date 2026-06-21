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
        databases?: { name: string; connected: boolean; generated: boolean }[];
    }) {
        const databases = opts.databases ?? [{ name: 'default', connected: true, generated: true }];
        jest.doMock('@lib/http/routing/loadRoutes_V6_Clean', () => ({ __esModule: true, default: jest.fn() }));
        jest.doMock('@lib/data/database/prismaManager', () => ({
            __esModule: true,
            prismaManager: {
                initialize: jest.fn(async () => { if (opts.prismaThrows) throw new Error('db down'); }),
                getStatus: jest.fn(() => ({
                    initialized: true,
                    connectedDatabases: databases.filter(d => d.connected).length,
                    totalDatabases: databases.length,
                    databases,
                })),
                isConnected: jest.fn(() => true),
            },
        }));
        jest.doMock('@lib/data/database/repositoryManager', () => ({
            __esModule: true,
            repositoryManager: {
                initialize: jest.fn(async () => { if (opts.repoThrows) throw new Error('repo registry broken'); }),
                getStatus: jest.fn(() => ({ initialized: true, repositoryCount: 0, repositories: [] })),
            },
        }));
        jest.doMock('@lib/data/di/dependencyInjector', () => ({
            __esModule: true,
            DependencyInjector: {
                getInstance: () => ({
                    initialize: jest.fn(async () => { if (opts.diThrows) throw new Error('di broken'); }),
                }),
            },
        }));

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Core } = require('@core/bootstrap/Core');
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

    it('생성된 DB 중 일부가 미연결이면 degraded + unconnected 목록 노출', async () => {
        const core = mockManagersAndGetCore({
            databases: [
                { name: 'default', connected: true, generated: true },
                { name: 'analytics', connected: false, generated: true },
            ],
        });
        await core.initialize({ routesPath: './src/app/routes' });
        const readiness = core.getReadiness();
        expect(readiness.ready).toBe(false);
        expect(readiness.prisma.unconnected).toContain('analytics');
    });

    it('미생성(generated=false) DB 폴더는 readiness 를 degraded 로 만들지 않는다', async () => {
        const core = mockManagersAndGetCore({
            databases: [
                { name: 'default', connected: true, generated: true },
                { name: 'wip', connected: false, generated: false }, // 아직 generate 안 한 폴더
            ],
        });
        await core.initialize({ routesPath: './src/app/routes' });
        const readiness = core.getReadiness();
        expect(readiness.ready).toBe(true);
        expect(readiness.prisma.total).toBe(1); // generated 만 분모에 포함
    });

    it('DB 가 0개면(DB 안 쓰는 서비스) healthy + /healthz 200', async () => {
        const core = mockManagersAndGetCore({ databases: [] });
        await core.initialize({ routesPath: './src/app/routes' });

        const readiness = core.getReadiness();
        expect(readiness.ready).toBe(true);
        expect(readiness.status).toBe('healthy');
        expect(readiness.prisma.total).toBe(0);

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const request = require('supertest');
        const res = await request(core.app).get('/healthz');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });

    it('정상 부팅 시 /healthz 200 (ok)', async () => {
        const core = mockManagersAndGetCore({
            databases: [{ name: 'default', connected: true, generated: true }],
        });
        await core.initialize({ routesPath: './src/app/routes' });

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const request = require('supertest');
        const res = await request(core.app).get('/healthz');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });
});
