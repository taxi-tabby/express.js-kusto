import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type TestDbProvider = 'sqlite' | 'postgres';

export interface DbFixture {
    provider: TestDbProvider;
    url: string;
    prisma: any; // Prisma client (test schema 기준, generic 으로 선언하기 어려움)
    teardown: () => Promise<void>;
}

/**
 * 환경변수 KUSTO_TEST_DB 로 백엔드 선택 (sqlite | postgres). 기본값: sqlite.
 */
export function selectProvider(): TestDbProvider {
    const v = (process.env.KUSTO_TEST_DB ?? 'sqlite').toLowerCase();
    if (v === 'postgres' || v === 'postgresql') return 'postgres';
    return 'sqlite';
}

/**
 * 통합 테스트 백엔드 부팅. Prisma 7 의 driver adapter 패턴을 사용한다.
 */
export async function bootDbFixture(): Promise<DbFixture> {
    const provider = selectProvider();
    if (provider === 'sqlite') {
        return await bootSqlite();
    } else {
        return await bootPostgres();
    }
}

async function bootSqlite(): Promise<DbFixture> {
    const workerId = process.env.JEST_WORKER_ID ?? '0';
    const dbDir = path.resolve('node_modules/.prisma');
    fs.mkdirSync(dbDir, { recursive: true });
    const dbFile = path.join(dbDir, `test-sqlite-${workerId}.db`);
    try { fs.unlinkSync(dbFile); } catch { /* 없으면 무시 */ }
    const url = `file:${dbFile}`;

    const schemaPath = path.resolve('tests/_fixtures/test-schema.sqlite.prisma');

    const gen = spawnSync('npx', ['prisma', 'generate', '--schema', schemaPath], {
        stdio: 'pipe',
        shell: true
    });
    if (gen.status !== 0) {
        throw new Error(`prisma generate failed: ${gen.stderr?.toString() ?? ''}`);
    }

    const push = spawnSync('npx', [
        'prisma', 'db', 'push',
        '--accept-data-loss',
        '--schema', schemaPath,
        '--url', url
    ], { stdio: 'pipe', shell: true });
    if (push.status !== 0) {
        throw new Error(`prisma db push failed: ${push.stderr?.toString() ?? ''}`);
    }

    const clientModule = require(path.resolve('node_modules/.prisma/test-sqlite-client'));
    const PrismaClient = clientModule.PrismaClient;
    const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
    const adapter = new PrismaBetterSqlite3({ url });
    const prisma = new PrismaClient({ adapter });

    return {
        provider: 'sqlite',
        url,
        prisma,
        teardown: async () => {
            await prisma.$disconnect();
            try { fs.unlinkSync(dbFile); } catch { /* 이미 없을 수 있음 */ }
        }
    };
}

async function bootPostgres(): Promise<DbFixture> {
    const { PGlite } = await import('@electric-sql/pglite');
    const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
    const { PrismaPg } = await import('@prisma/adapter-pg');

    const pglite = new (PGlite as any)();
    const server = new (PGLiteSocketServer as any)({ db: pglite, port: 0 });
    await server.start();
    const port = (server as any).port;
    const url = `postgres://test:test@localhost:${port}/postgres`;

    const schemaPath = path.resolve('tests/_fixtures/test-schema.postgres.prisma');

    const gen = spawnSync('npx', ['prisma', 'generate', '--schema', schemaPath], {
        stdio: 'pipe',
        shell: true
    });
    if (gen.status !== 0) {
        throw new Error(`prisma generate failed: ${gen.stderr?.toString() ?? ''}`);
    }

    const push = spawnSync('npx', [
        'prisma', 'db', 'push',
        '--accept-data-loss',
        '--schema', schemaPath,
        '--url', url
    ], { stdio: 'pipe', shell: true });
    if (push.status !== 0) {
        throw new Error(`prisma db push failed: ${push.stderr?.toString() ?? ''}`);
    }

    const clientModule = require(path.resolve('node_modules/.prisma/test-postgres-client'));
    const PrismaClient = clientModule.PrismaClient;
    const adapter = new (PrismaPg as any)({ connectionString: url });
    const prisma = new PrismaClient({ adapter });

    return {
        provider: 'postgres',
        url,
        prisma,
        teardown: async () => {
            await prisma.$disconnect();
            await server.stop();
            await pglite.close();
        }
    };
}

/**
 * 모든 테이블 비우기. 통합 테스트의 afterEach 에서 호출.
 */
export async function truncateAll(fixture: DbFixture): Promise<void> {
    const tables = ['Comment', 'PostTag', 'Post', 'Tag', 'User']; // FK 의존성 역순
    if (fixture.provider === 'sqlite') {
        for (const t of tables) {
            await fixture.prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
        }
    } else {
        await fixture.prisma.$executeRawUnsafe(
            `TRUNCATE TABLE "${tables.join('", "')}" RESTART IDENTITY CASCADE`
        );
    }
}
