import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type TestDbProvider = 'sqlite' | 'postgres';

// 락/대기 상수. jest testTimeout(30s) 보다 작게 잡아 contended 시에도 명확히 실패한다.
const GEN_MAX_WAIT_MS = 25000;   // 다른 워커의 생성 완료를 기다리는 최대 시간
const GEN_STALE_LOCK_MS = 60000; // 락 디렉터리가 이보다 오래되면 크래시로 간주하고 회수

// SharedArrayBuffer 는 한 번만 할당하여 재사용(매 호출 할당 방지)
const SLEEP_SAB = new Int32Array(new SharedArrayBuffer(4));

/** 동기 sleep (busy-CPU 없이 대기) */
function sleepSync(ms: number): void {
    Atomics.wait(SLEEP_SAB, 0, 0, ms);
}

/** 스키마 파일 내용의 지문 (변경 감지용) */
function schemaFingerprint(schemaPath: string): string {
    return crypto.createHash('sha1').update(fs.readFileSync(schemaPath, 'utf8')).digest('hex');
}

/** 현재 스키마 지문으로 생성된 client 가 require 가능한 상태로 완성됐는지 */
function isClientReady(clientDir: string, markerFile: string, fingerprint: string): boolean {
    try {
        return fs.readFileSync(markerFile, 'utf8') === fingerprint
            && fs.existsSync(path.join(clientDir, 'index.js'));
    } catch {
        return false;
    }
}

/**
 * Prisma client 를 워커 경쟁 없이 한 번만 생성한다.
 *
 * 여러 jest 워커가 공유 출력 디렉터리에 동시에 `prisma generate` 하면 client 가
 * 반쯤 쓰인 상태로 require 되어 깨질 수 있다(잠재 race). 원자적 디렉터리 락으로
 * 직렬화하고, 스키마 지문 마커 + index.js 존재로 완성 여부를 판정한다(동일 스키마는 1회만).
 *
 * 대기 워커는 "락"이 아니라 "완성된 client(아티팩트)"를 폴링하므로:
 *  - 첫 워커가 생성을 끝내는 즉시 반환(빠른 happy path)
 *  - 활성 락을 실수로 회수해 race 를 재유발하지 않음(회수는 락 자체의 나이로만 판단)
 */
function ensurePrismaClientGenerated(schemaPath: string, clientDir: string): void {
    const prismaRoot = path.resolve('node_modules/.prisma');
    fs.mkdirSync(prismaRoot, { recursive: true });

    const lockDir = clientDir + '.genlock';
    const markerFile = path.join(clientDir, '.kusto-gen-marker');
    const fingerprint = schemaFingerprint(schemaPath);

    if (isClientReady(clientDir, markerFile, fingerprint)) return; // 이미 완성됨

    const start = Date.now();
    while (true) {
        try {
            fs.mkdirSync(lockDir); // 원자적 락 획득
            break;
        } catch (e: any) {
            if (e.code !== 'EEXIST') throw e;
            // 락을 못 잡음 — 다른 워커가 생성 중. 완성된 아티팩트가 보이면 락 없이 반환.
            if (isClientReady(clientDir, markerFile, fingerprint)) return;
            // 회수는 "대기 시간"이 아니라 "락 디렉터리의 나이"로만 판단(활성 락 보호).
            let lockAge = Infinity;
            try { lockAge = Date.now() - fs.statSync(lockDir).mtimeMs; } catch { /* 막 사라짐 */ }
            if (lockAge > GEN_STALE_LOCK_MS) {
                try { fs.rmdirSync(lockDir); } catch { /* 무시 */ }
                continue; // 회수 후 재시도
            }
            if (Date.now() - start > GEN_MAX_WAIT_MS) {
                throw new Error(`Timed out waiting for prisma client generation: ${clientDir}`);
            }
            sleepSync(100);
        }
    }

    try {
        // 락을 잡는 사이 다른 워커가 끝냈을 수 있다
        if (isClientReady(clientDir, markerFile, fingerprint)) return;

        // 부분 생성 마커가 남지 않도록, 생성 전에 기존 마커를 제거한다(생성 성공 후에만 재기록)
        try { fs.rmSync(markerFile, { force: true }); } catch { /* 무시 */ }

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
    // 실제 외부 Postgres 가 지정되면(예: CI 의 postgres service container) PGlite 대신 사용.
    // 임베디드 PGlite 가 Postgres 와이어 프로토콜·SQL 방언은 이미 커버하므로, 외부 경로는
    // 실제 네트워크 소켓·서버 프로세스·커넥션 풀 동작을 추가로 검증한다.
    const externalUrl = process.env.KUSTO_TEST_PG_URL;
    if (externalUrl) {
        return await bootPostgresExternal(externalUrl);
    }

    const { PGlite } = await import('@electric-sql/pglite');
    const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
    const { PrismaPg } = await import('@prisma/adapter-pg');

    const pglite = new (PGlite as any)();
    // maxConnections 기본값은 1 인데, PrismaPg(node-postgres) 는 풀로 여러 연결을 열어
    // 초과 연결이 거부·종료되면서 "Server has closed the connection" 이 발생한다.
    // pglite 는 queryQueue 로 쿼리를 직렬화하므로 다중 연결을 허용해도 안전하다.
    const server = new (PGLiteSocketServer as any)({ db: pglite, port: 0, maxConnections: 100 });
    await server.start();
    const port = (server as any).port;
    // host 는 127.0.0.1 로 고정(PGLiteSocketServer 는 기본 127.0.0.1/IPv4 바인딩 —
    // `localhost` 는 일부 OS 에서 ::1 로 해석되어 닿지 못할 수 있다).
    // sslmode=disable 필수: PGLiteSocketServer 는 StartupMessage 만 파싱하고 SSLRequest
    // 는 처리하지 못한다. prisma schema engine(db push)은 기본 sslmode=prefer 로 먼저
    // SSLRequest 를 보내므로, 비활성화하지 않으면 핸드셰이크가 멈춰 P1001 로 실패한다.
    const url = `postgres://test:test@127.0.0.1:${port}/postgres?sslmode=disable`;

    const schemaPath = path.resolve('tests/_fixtures/test-schema.postgres.prisma');
    const clientDir = path.resolve('node_modules/.prisma/test-postgres-client');

    // client 생성은 워커 경쟁 없이 1회만 (공유 디렉터리 race 방지)
    ensurePrismaClientGenerated(schemaPath, clientDir);

    // 중요: postgres 백엔드는 PGLiteSocketServer 가 "이 프로세스 안"에서 돌며 이벤트 루프로
    // 연결을 수락한다. 따라서 db push 를 동기 spawnSync 로 돌리면 이벤트 루프가 막혀
    // 서버가 push 연결을 수락하지 못하고 P1001(Can't reach database server)로 실패한다.
    // (sqlite 는 파일 접속이라 spawnSync 로도 무관.) 비동기 spawn 으로 루프를 살려둔다.
    await new Promise<void>((resolve, reject) => {
        const child = spawn('npx', [
            'prisma', 'db', 'push',
            '--accept-data-loss',
            '--schema', schemaPath,
            '--url', url
        ], { stdio: 'pipe', shell: true });
        let stderr = '';
        child.stderr?.on('data', (d) => { stderr += d.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`prisma db push failed: ${stderr}`));
        });
    });

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
 * 외부에서 제공된 실제 Postgres URL 로 백엔드를 부팅한다(KUSTO_TEST_PG_URL).
 * PGlite 경로와 달리 in-process 이벤트 루프 제약이 없으므로 db push 를 동기로 돌려도 된다.
 * 서버는 우리가 소유하지 않으므로 teardown 은 client disconnect 만 수행한다.
 *
 * 주의(CI): 모든 jest 워커가 같은 DB 를 공유하므로, 외부 Postgres 잡은 워커 간 간섭을 막기
 * 위해 단일 워커(--runInBand)로 실행해야 한다. (db-fixture 자체는 워커 수에 무관하게 동작)
 */
async function bootPostgresExternal(externalUrl: string): Promise<DbFixture> {
    const { PrismaPg } = await import('@prisma/adapter-pg');

    const schemaPath = path.resolve('tests/_fixtures/test-schema.postgres.prisma');
    const clientDir = path.resolve('node_modules/.prisma/test-postgres-client');

    ensurePrismaClientGenerated(schemaPath, clientDir);

    const push = spawnSync('npx', [
        'prisma', 'db', 'push',
        '--accept-data-loss',
        '--schema', schemaPath,
        '--url', externalUrl
    ], { stdio: 'pipe', shell: true });
    if (push.status !== 0) {
        throw new Error(`prisma db push failed (external postgres): ${push.stderr?.toString() ?? ''}`);
    }

    const clientModule = require(clientDir);
    const PrismaClient = clientModule.PrismaClient;
    const adapter = new (PrismaPg as any)({ connectionString: externalUrl });
    const prisma = new PrismaClient({ adapter });

    return {
        provider: 'postgres',
        url: externalUrl,
        prisma,
        teardown: async () => {
            await prisma.$disconnect();
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
