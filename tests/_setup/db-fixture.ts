import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type TestDbProvider = 'sqlite' | 'postgres';

/** 동기 sleep (busy-CPU 없이 대기) */
function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 스키마 파일 내용의 지문 (변경 감지용) */
function schemaFingerprint(schemaPath: string): string {
    return crypto.createHash('sha1').update(fs.readFileSync(schemaPath, 'utf8')).digest('hex');
}

/**
 * Prisma client 를 워커 경쟁 없이 한 번만 생성한다.
 *
 * 여러 jest 워커가 공유 출력 디렉터리에 동시에 `prisma generate` 하면 client 가
 * 반쯤 쓰인 상태로 require 되어 깨질 수 있다(잠재 race). 원자적 디렉터리 락으로
 * 직렬화하고, 스키마 지문 마커가 일치하면 재생성을 생략한다(동일 스키마는 1회만).
 */
function ensurePrismaClientGenerated(schemaPath: string, clientDir: string): void {
    const prismaRoot = path.resolve('node_modules/.prisma');
    fs.mkdirSync(prismaRoot, { recursive: true });

    const lockDir = clientDir + '.genlock';
    const markerFile = path.join(clientDir, '.kusto-gen-marker');
    const fingerprint = schemaFingerprint(schemaPath);

    const start = Date.now();
    // mkdir 은 원자적 → 락 획득. 이미 있으면 다른 워커가 생성 중이므로 대기.
    while (true) {
        try {
            fs.mkdirSync(lockDir);
            break;
        } catch (e: any) {
            if (e.code !== 'EEXIST') throw e;
            if (Date.now() - start > 120000) {
                // stale lock 방지: 2분 초과 시 강제 회수 후 재시도
                try { fs.rmdirSync(lockDir); } catch { /* 무시 */ }
                continue;
            }
            sleepSync(100);
        }
    }

    try {
        let current: string | null = null;
        try { current = fs.readFileSync(markerFile, 'utf8'); } catch { /* 마커 없음 */ }
        if (current === fingerprint) return; // 동일 스키마로 이미 생성됨

        const gen = spawnSync('npx', ['prisma', 'generate', '--schema', schemaPath], {
            stdio: 'pipe',
            shell: true
        });
        if (gen.status !== 0) {
            throw new Error(`prisma generate failed: ${gen.stderr?.toString() ?? ''}`);
        }
        fs.writeFileSync(markerFile, fingerprint);
    } finally {
        try { fs.rmdirSync(lockDir); } catch { /* 무시 */ }
    }
}

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
    const clientDir = path.resolve('node_modules/.prisma/test-sqlite-client');

    // client 생성은 워커 경쟁 없이 1회만 (공유 디렉터리 race 방지)
    ensurePrismaClientGenerated(schemaPath, clientDir);

    // db push 는 워커별 db 파일 대상이므로 그대로 병렬 수행 가능
    const push = spawnSync('npx', [
        'prisma', 'db', 'push',
        '--accept-data-loss',
        '--schema', schemaPath,
        '--url', url
    ], { stdio: 'pipe', shell: true });
    if (push.status !== 0) {
        throw new Error(`prisma db push failed: ${push.stderr?.toString() ?? ''}`);
    }

    const clientModule = require(clientDir);
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
    const clientDir = path.resolve('node_modules/.prisma/test-postgres-client');

    // client 생성은 워커 경쟁 없이 1회만 (공유 디렉터리 race 방지)
    ensurePrismaClientGenerated(schemaPath, clientDir);

    const push = spawnSync('npx', [
        'prisma', 'db', 'push',
        '--accept-data-loss',
        '--schema', schemaPath,
        '--url', url
    ], { stdio: 'pipe', shell: true });
    if (push.status !== 0) {
        throw new Error(`prisma db push failed: ${push.stderr?.toString() ?? ''}`);
    }

    const clientModule = require(clientDir);
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
