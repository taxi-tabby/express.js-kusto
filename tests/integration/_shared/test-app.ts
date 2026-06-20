import express from 'express';
import { DbFixture } from '@tests/_setup/db-fixture';

/**
 * 통합 테스트용 Express app 빌드.
 *
 * 주의: ExpressRouter.CRUD 의 첫 인자 (databaseName) 는 PrismaManager.getWrap(name)
 * 으로 client 를 얻는다. 본 테스트는 PrismaManager 를 mock 하여 fixture.prisma 를
 * 직접 주입한다.
 *
 * 사용 패턴 (caller 가 jest.resetModules() 후 호출):
 *   jest.resetModules();
 *   jest.doMock('@lib/data/database/prismaManager', ...);
 *   const { buildTestApp } = require('../_shared/test-app');
 *   const app = buildTestApp(fixture, options, 'Post', '/posts');
 */
export function buildTestApp(
    fixture: DbFixture,
    options: any = {},
    modelName: string = 'Post',
    mountPath: string = '/posts'
) {
    // Late require so the doMock applied before this call takes effect.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ExpressRouter } = require('@lib/http/routing/expressRouter');

    const app = express();
    app.use(express.json());
    app.use(express.json({ type: 'application/vnd.api+json' }));

    const router = new ExpressRouter();
    router.CRUD('default' as any, modelName as any, options);
    app.use(mountPath, router.build());

    // 통합 테스트용 fallback error handler — handler 내부에서 next(err) 로 빠져나온
    // 예외를 JSON 형태로 surface 하여 디버깅을 돕는다 (정상 경로는 CRUD 라우트가 직접 응답).
    app.use((err: any, _req: any, res: any, _next: any) => {
        if (!res.headersSent) {
            res.status(500).json({ errors: [{ status: '500', detail: err?.message || String(err) }] });
        }
    });
    return app;
}

/**
 * 헬퍼: ExpressRouter import 전에 prismaManager / DependencyInjector / repositoryManager
 * mock 을 적용. 각 it() 또는 describe 의 beforeEach 에서 호출.
 */
export function applyPrismaManagerMock(fixture: DbFixture) {
    jest.resetModules();
    const mockManager = {
        getWrap: (_name: string) => fixture.prisma,
        getClient: async (_name: string) => fixture.prisma,
        getClientSync: (_name: string) => fixture.prisma,
        isConnected: (_name: string) => true,
        getAvailableDatabases: () => ['default'],
        getDatabaseProviders: () => [{ name: 'default', provider: 'sqlite' }],
        getProviderForDatabase: (_name: string) => 'sqlite',
        healthCheck: async () => ({ databases: [{ name: 'default', status: 'healthy' }] })
    };
    jest.doMock('@lib/data/database/prismaManager', () => ({
        prismaManager: mockManager,
        PrismaManager: { getInstance: () => mockManager }
    }));

    // DependencyInjector — initialized 상태로 빈 modules/middlewares 노출
    const mockInjector = {
        getInjectedModules: () => ({}),
        getInjectedMiddlewares: () => ({}),
        getInjectedMiddleware: (_name: string) => undefined
    };
    jest.doMock('@lib/data/di/dependencyInjector', () => ({
        DependencyInjector: { getInstance: () => mockInjector }
    }));

    // repositoryManager — 빈 stub 으로 충분 (CRUD 라우트는 직접 사용 안 함)
    jest.doMock('@lib/data/database/repositoryManager', () => ({
        repositoryManager: {
            getRepository: (_name: string) => undefined,
            getAllRepositories: () => ({})
        }
    }));

    // kustoManager — req.kusto 에 할당. 단순 객체로 충분
    jest.doMock('@lib/data/di/kustoManager', () => ({
        kustoManager: {}
    }));
}
