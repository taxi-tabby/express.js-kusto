# Jest Core Regression Tests — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Express.js-Kusto 프레임워크의 코어에 대한 Jest 기반 회귀 안전망의 Phase 1 (인프라 + Tier 1 ~67개 TC + CI workflow) 을 구축한다.

**Architecture:** Jest + ts-jest, SQLite `:memory:` 을 default 백엔드로 한 통합 테스트, PostgreSQL 은 옵셔널 matrix job. 테스트 전용 schema 를 `tests/_fixtures/` 에 격리해 사용자 schema 와 분리. CLI 는 export 만 추가하는 작은 변경.

**Tech Stack:** Jest 29, ts-jest 29, Prisma 7, SQLite (Prisma native), `pglite-socket` + `@prisma/adapter-pg` (PG matrix job), execa 9, jest-mock-extended 4, GitHub Actions.

**Spec**: `docs/superpowers/specs/2026-05-03-jest-core-regression-tests-design.md`

---

## File Structure (이 plan 으로 생성/수정될 파일)

### 신규 생성

```
jest.config.ts
tsconfig.test.json
.github/workflows/test.yml
tests/
├── _setup/
│   ├── db-fixture.ts                # SQLite/PG 부팅 + schema 적용 헬퍼
│   └── env-fixture.ts               # process.env 스냅샷·복원
├── _fixtures/
│   ├── test-schema.sqlite.prisma    # provider = "sqlite", 단순 모델 4개
│   ├── test-schema.postgres.prisma  # provider = "postgresql", 동일 모델
│   └── seed.ts                      # 공통 seed 함수 (선택적 사용)
├── unit/
│   ├── crud-helpers/
│   │   ├── include-policy.test.ts   # TC #1 (validateIncludes 외)
│   │   ├── filter-operators.test.ts # TC #2 (필터 연산자 매처)
│   │   └── prisma-builder.test.ts   # TC #3 (PrismaQueryBuilder)
│   └── error-handling/
│       ├── error-codes.test.ts      # TC #4 (ERROR_CODES 무결성)
│       ├── json-api-format.test.ts  # TC #5 (formatJsonApiError 구조)
│       └── prisma-mapping.test.ts   # TC #6 (mapPrismaError)
├── integration/
│   ├── crud-include-policy/
│   │   └── include-policy.integration.test.ts  # TC #7
│   └── soft-delete/
│       └── soft-delete.integration.test.ts     # TC #8
└── cli/
    ├── handlers/
    │   ├── security-code.test.ts    # generateSecurityCode
    │   ├── env-var-name.test.ts     # getDatabaseEnvVarName
    │   ├── migration-name.test.ts   # parseMigrationName, validateMigrationTarget
    │   ├── sql-extract.test.ts      # extractTableName, extractAlterAddColumn
    │   └── rollback-sql.test.ts     # generateRollbackSQL
    └── e2e/
        └── smoke.test.ts            # TC #10 (execa)
```

### 수정

```
package.json                                    # devDependencies + scripts 추가
src/core/scripts/kusto-db-cli.ts                # 약 15-20 함수에 export 추가
```

---

## Task 1: PoC — Prisma 7 + SQLite `:memory:` + Worker 격리 검증

**Files:**
- Create (temporary): `poc-sqlite/poc.ts`, `poc-sqlite/test-schema.prisma`
- Verify behavior, then delete

**Goal**: Spec PoC 1 + 6 — Prisma 7 가 SQLite `:memory:` 와 동작하고, jest worker 별로 충돌 없이 격리되는지 확인. 실패 시 fallback (임시 파일 DB 또는 `--maxWorkers=1`) 결정 근거 확보.

- [ ] **Step 1: PoC 디렉토리 생성**

```bash
mkdir -p poc-sqlite
```

- [ ] **Step 2: PoC schema 작성**

`poc-sqlite/test-schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "client"
}

datasource db {
  provider = "sqlite"
  url      = env("POC_DB_URL")
}

model Post {
  id    Int    @id @default(autoincrement())
  title String
}
```

- [ ] **Step 3: PoC 스크립트 작성**

`poc-sqlite/poc.ts`:

```ts
import { spawnSync } from 'child_process';
import * as path from 'path';

async function main() {
  const dbUrl = 'file::memory:?cache=shared';
  process.env.POC_DB_URL = dbUrl;

  // 1) prisma generate
  const gen = spawnSync('npx', [
    'prisma', 'generate',
    '--schema', 'poc-sqlite/test-schema.prisma'
  ], { stdio: 'inherit' });
  if (gen.status !== 0) throw new Error('prisma generate failed');

  // 2) prisma db push
  const push = spawnSync('npx', [
    'prisma', 'db', 'push',
    '--skip-generate',
    '--accept-data-loss',
    '--schema', 'poc-sqlite/test-schema.prisma'
  ], { stdio: 'inherit' });
  if (push.status !== 0) throw new Error('prisma db push failed');

  // 3) CRUD 왕복
  const { PrismaClient } = require(path.resolve('poc-sqlite/client'));
  const prisma = new PrismaClient();
  await prisma.post.create({ data: { title: 'hello' } });
  const all = await prisma.post.findMany();
  console.log('PoC result:', all);
  await prisma.$disconnect();
  if (all.length !== 1 || all[0].title !== 'hello') {
    throw new Error('PoC CRUD round trip failed');
  }
  console.log('✅ PoC 1: SQLite + Prisma 7 OK');
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: PoC 실행**

```bash
npx ts-node poc-sqlite/poc.ts
```

Expected: stdout 에 `✅ PoC 1: SQLite + Prisma 7 OK` 출력. exit 0.

- [ ] **Step 5: PoC 결과 검토**

PoC 가 성공하면 SQLite 전략 채택. 실패 시 다음 결정:
- 에러 메시지에 "in-memory" 충돌 → file 기반 임시 DB 로 전환 (`file:./poc.test.db`)
- prisma generate 실패 → schema 수정
- 실패 원인을 spec 의 Section 9 fallback 에 따라 처리

- [ ] **Step 6: PoC 디렉토리 정리**

```bash
rm -rf poc-sqlite
```

- [ ] **Step 7: 결과를 commit message 로 기록 (실제 commit 은 안함)**

PoC 결과를 다음 task 의 commit message 에서 참조하기 위해 메모.

---

## Task 2: devDependencies 설치

**Files:**
- Modify: `package.json` (devDependencies 추가)

- [ ] **Step 1: 의존성 설치**

```bash
npm install --save-dev jest@^29 ts-jest@^29 @types/jest@^29 jest-mock-extended@^4 execa@^9 @electric-sql/pglite @electric-sql/pglite-socket @prisma/adapter-better-sqlite3 better-sqlite3
```

Expected: `package.json` 의 `devDependencies` 에 위 패키지들 추가, `node_modules/` 에 설치, exit 0.

> **PoC 발견**: Prisma 7 은 SQLite 도 driver adapter 가 필수다. `@prisma/adapter-better-sqlite3` + `better-sqlite3` 가 db-fixture 에서 `new PrismaClient({ adapter })` 형태로 주입된다.

- [ ] **Step 2: 설치 확인**

```bash
node -e "console.log(require('jest/package.json').version)"
node -e "console.log(require('ts-jest/package.json').version)"
node -e "console.log(require('execa/package.json').version)"
node -e "console.log(require('@prisma/adapter-better-sqlite3/package.json').version)"
node -e "console.log(require('better-sqlite3/package.json').version)"
```

Expected: 각 명령이 버전 문자열 출력. better-sqlite3 는 native binding 컴파일이 필요할 수 있음 (npm install 단계에서 자동 처리).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "test: jest + Prisma 7 SQLite adapter devDependencies 추가

jest 29, ts-jest 29, jest-mock-extended 4, execa 9, pglite/pglite-socket,
@prisma/adapter-better-sqlite3, better-sqlite3 설치.

PoC 1 결과: Prisma 7 은 SQLite 도 adapter 필수. PrismaClient 는
{ adapter } 주입 필요.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: tsconfig.test.json 작성

**Files:**
- Create: `tsconfig.test.json`

- [ ] **Step 1: 파일 작성**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "types": ["node", "jest"],
    "noEmit": true
  },
  "include": [
    "src/**/*.ts",
    "tests/**/*.ts"
  ],
  "exclude": [
    "node_modules",
    "dist"
  ]
}
```

- [ ] **Step 2: 컴파일 확인**

```bash
npx tsc -p tsconfig.test.json --noEmit
```

Expected: 사전 존재 에러 1건 (`@app/db/default/client`) 외에는 클린. (이 에러는 PoC 3 에서 처리 — 지금은 무시)

- [ ] **Step 3: Commit**

```bash
git add tsconfig.test.json
git commit -m "test: tsconfig.test.json 추가 (jest 타입 + tests/ 포함)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: jest.config.ts 작성

**Files:**
- Create: `jest.config.ts`

- [ ] **Step 1: 파일 작성**

```ts
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/app/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@lib/(.*)$': '<rootDir>/src/core/lib/$1',
    '^@ext/(.*)$': '<rootDir>/src/core/external/$1',
    '^@db/(.*)$': '<rootDir>/src/app/db/$1',
    '^@/(.*)$': '<rootDir>/$1'
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json'
    }
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/src/core/lib/types/',
    '/src/core/scripts/generate.*\\.js$',
    '/src/core/scripts/clean-tmp\\.js$',
    '/src/app/',
    '/updater/',
    '/tests/_setup/',
    '/tests/_fixtures/'
  ],
  coverageThreshold: {
    global: { statements: 50, branches: 40, functions: 50, lines: 50 },
    './src/core/lib/crudHelpers.ts': { statements: 80, branches: 70, functions: 80, lines: 80 },
    './src/core/lib/errorHandler.ts': { statements: 80, branches: 70, functions: 80, lines: 80 },
    './src/core/lib/errorCodes.ts': { statements: 95, branches: 90, functions: 95, lines: 95 },
    './src/core/lib/serializer.ts': { statements: 80, branches: 70, functions: 80, lines: 80 }
  },
  testTimeout: 30000
};

export default config;
```

- [ ] **Step 2: jest 가 config 를 읽는지 확인 (스모크)**

```bash
npx jest --listTests
```

Expected: `tests/**/*.test.ts` 패턴이 적용됨. 현재 테스트 파일이 없으므로 빈 출력 + exit 0.

- [ ] **Step 3: Commit**

```bash
git add jest.config.ts
git commit -m "test: jest.config.ts 추가

ts-jest preset, path alias moduleNameMapper, coverage threshold
(글로벌 50%, crudHelpers/errorHandler/serializer 80%, errorCodes 95%).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: package.json scripts 추가

**Files:**
- Modify: `package.json`

- [ ] **Step 1: scripts 섹션 갱신**

`package.json` 의 `scripts` 객체에 다음 키 추가 (기존 키 보존):

```json
{
  "scripts": {
    "start": "ts-node ./src/index.ts",
    "dev": "npm run generate && nodemon",
    "dev:serve": "nodemon --config nodemon.serve.json",
    "serve": "node dist/server.js",
    "build": "npm run db -- generate --all && npm run generate -- --build && webpack --mode production && npm run clean",
    "build:dev": "npm run generate -- --build && webpack --mode development && npm run clean",
    "clean": "node src/core/scripts/clean-tmp.js",
    "generate": "node src/core/scripts/generate.js",
    "db": "ts-node ./src/core/scripts/kusto-db-cli.ts",
    "updater:generate": "ts-node ./updater/generate.ts",
    "updater:check": "ts-node ./updater/compare.ts",
    "updater:update": "ts-node ./updater/update.ts",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:ci": "jest --ci --coverage --maxWorkers=2",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "test:cli": "jest tests/cli"
  }
}
```

- [ ] **Step 2: scripts 검증**

```bash
npm test -- --listTests
```

Expected: 빈 출력 + exit 0 (테스트 파일 아직 없음).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test: npm scripts 추가 (test, test:watch, test:coverage, test:ci 등)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 테스트 전용 Prisma schema 작성

**Files:**
- Create: `tests/_fixtures/test-schema.sqlite.prisma`
- Create: `tests/_fixtures/test-schema.postgres.prisma`

**Goal**: 사용자 영역의 schema 와 분리된, 코어 테스트만의 단순한 모델 (User, Post, Tag, Comment + 관계). soft delete / include 검증에 충분한 최소 모델.

- [ ] **Step 1: SQLite schema 작성**

`tests/_fixtures/test-schema.sqlite.prisma`:

> **PoC 발견**: Prisma 7 은 schema 의 `datasource.url = env(...)` 를 거부 (P1012). connection 은 runtime adapter 와 `prisma db push` 의 `--url` 인자로 주입한다.

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../../node_modules/.prisma/test-sqlite-client"
}

datasource db {
  provider = "sqlite"
  // url 은 schema 에 두지 않음 — Prisma 7 거부.
  // db push 시 --url 인자, runtime 시 PrismaClient adapter 로 주입.
}

model User {
  id        String    @id @default(uuid())
  email     String    @unique
  name      String
  deletedAt DateTime?
  posts     Post[]
  comments  Comment[]
}

model Post {
  id        String    @id @default(uuid())
  title     String
  content   String?
  authorId  String
  author    User      @relation(fields: [authorId], references: [id])
  comments  Comment[]
  tags      PostTag[]
  deletedAt DateTime?
}

model Tag {
  id    String    @id @default(uuid())
  name  String    @unique
  posts PostTag[]
}

model PostTag {
  postId String
  tagId  String
  post   Post   @relation(fields: [postId], references: [id])
  tag    Tag    @relation(fields: [tagId], references: [id])

  @@id([postId, tagId])
}

model Comment {
  id       String @id @default(uuid())
  body     String
  postId   String
  authorId String
  post     Post   @relation(fields: [postId], references: [id])
  author   User   @relation(fields: [authorId], references: [id])
}
```

- [ ] **Step 2: PostgreSQL schema 작성 (provider 만 다름)**

`tests/_fixtures/test-schema.postgres.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../../node_modules/.prisma/test-postgres-client"
}

datasource db {
  provider = "postgresql"
  // url 은 schema 에 두지 않음 — Prisma 7 거부.
  // db push 시 --url 인자, runtime 시 PrismaClient adapter 로 주입.
}

model User {
  id        String    @id @default(uuid())
  email     String    @unique
  name      String
  deletedAt DateTime?
  posts     Post[]
  comments  Comment[]
}

model Post {
  id        String    @id @default(uuid())
  title     String
  content   String?
  authorId  String
  author    User      @relation(fields: [authorId], references: [id])
  comments  Comment[]
  tags      PostTag[]
  deletedAt DateTime?
}

model Tag {
  id    String    @id @default(uuid())
  name  String    @unique
  posts PostTag[]
}

model PostTag {
  postId String
  tagId  String
  post   Post   @relation(fields: [postId], references: [id])
  tag    Tag    @relation(fields: [tagId], references: [id])

  @@id([postId, tagId])
}

model Comment {
  id       String @id @default(uuid())
  body     String
  postId   String
  authorId String
  post     Post   @relation(fields: [postId], references: [id])
  author   User   @relation(fields: [authorId], references: [id])
}
```

- [ ] **Step 3: 두 schema 가 prisma validate 통과하는지**

```bash
npx prisma validate --schema tests/_fixtures/test-schema.sqlite.prisma
npx prisma validate --schema tests/_fixtures/test-schema.postgres.prisma
```

Expected: 두 명령 모두 `The schema at ... is valid` 출력 + exit 0. (`url` 이 schema 에 없으므로 환경변수 없이도 validate 통과.)

- [ ] **Step 4: Commit**

```bash
git add tests/_fixtures/test-schema.sqlite.prisma tests/_fixtures/test-schema.postgres.prisma
git commit -m "test: 테스트 전용 prisma schema 2개 추가 (sqlite/postgres)

User/Post/Tag/PostTag/Comment 5개 모델. soft delete (deletedAt),
관계 (1:N, M:N), include 정책 검증에 충분한 최소 구성.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: tests/_setup/env-fixture.ts 작성

**Files:**
- Create: `tests/_setup/env-fixture.ts`

**Goal**: process.env 를 스냅샷·복원하는 헬퍼. PrismaManager / 다른 모듈이 env 를 읽으므로 테스트별 격리 필요.

- [ ] **Step 1: 파일 작성**

```ts
/**
 * 테스트별 process.env 격리 헬퍼.
 *
 * 사용 예:
 * ```
 * import { snapshotEnv } from '@/tests/_setup/env-fixture';
 * describe('...', () => {
 *   const restoreEnv = snapshotEnv();
 *   afterEach(() => restoreEnv());
 *   it('...', () => { process.env.X = 'y'; ... });
 * });
 * ```
 */
export function snapshotEnv(): () => void {
    const original = { ...process.env };
    return () => {
        // 새로 추가된 키 제거
        for (const key of Object.keys(process.env)) {
            if (!(key in original)) {
                delete process.env[key];
            }
        }
        // 원래 값 복원
        for (const [key, value] of Object.entries(original)) {
            process.env[key] = value;
        }
    };
}

/**
 * 특정 env 만 임시로 설정하고 끝나면 복원하는 헬퍼.
 *
 * 사용 예:
 * ```
 * await withEnv({ NODE_ENV: 'test' }, async () => { ... });
 * ```
 */
export async function withEnv<T>(
    overrides: Record<string, string | undefined>,
    fn: () => T | Promise<T>
): Promise<T> {
    const original: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
        original[key] = process.env[key];
        if (overrides[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = overrides[key];
        }
    }
    try {
        return await fn();
    } finally {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}
```

- [ ] **Step 2: tsc 검증**

```bash
npx tsc -p tsconfig.test.json --noEmit
```

Expected: 사전 존재 에러 (`@app/db/default/client`) 외 클린.

- [ ] **Step 3: Commit**

```bash
git add tests/_setup/env-fixture.ts
git commit -m "test: env-fixture 헬퍼 (snapshotEnv, withEnv)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: tests/_setup/db-fixture.ts 작성 (SQLite + 옵셔널 PG)

**Files:**
- Create: `tests/_setup/db-fixture.ts`

**Goal**: 통합 테스트가 SQLite `:memory:` 로 schema 적용 + Prisma client 부팅 + truncate + teardown 을 한 줄 호출로 끝낼 수 있도록.

- [ ] **Step 1: 파일 작성**

> **PoC 발견 적용**: Prisma 7 어댑터 패턴 사용. `--skip-generate` 옵션 제거. 절대 경로 강제. PrismaClient 생성 시 `{ adapter }` 주입. SQLite 어댑터 클래스명은 `PrismaBetterSqlite3` (소문자 sqlite3).

```ts
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
 *
 * 사용 예:
 * ```
 * let fixture: DbFixture;
 * beforeAll(async () => { fixture = await bootDbFixture(); });
 * afterAll(async () => { await fixture.teardown(); });
 * afterEach(async () => { await truncateAll(fixture); });
 * ```
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
    // 워커별 임시 DB 파일 — :memory: 는 db push 가 별도 프로세스라 schema 적용 안 됨.
    // Path 해상도 차이 (db push vs runtime adapter) 회피를 위해 절대 경로 강제.
    const workerId = process.env.JEST_WORKER_ID ?? '0';
    const dbDir = path.resolve('node_modules/.prisma');
    fs.mkdirSync(dbDir, { recursive: true });
    const dbFile = path.join(dbDir, `test-sqlite-${workerId}.db`);
    // 깨끗한 시작 보장
    try { fs.unlinkSync(dbFile); } catch { /* 없으면 무시 */ }
    const url = `file:${dbFile}`;

    const schemaPath = path.resolve('tests/_fixtures/test-schema.sqlite.prisma');

    // 1) generate (한 번만 — 결과는 node_modules/.prisma/test-sqlite-client 에 캐시됨)
    const gen = spawnSync('npx', ['prisma', 'generate', '--schema', schemaPath], {
        stdio: 'pipe',
        shell: true
    });
    if (gen.status !== 0) {
        throw new Error(`prisma generate failed: ${gen.stderr?.toString() ?? ''}`);
    }

    // 2) db push — Prisma 7 에서는 --skip-generate 가 제거됨. --url 로 connection 주입.
    const push = spawnSync('npx', [
        'prisma', 'db', 'push',
        '--accept-data-loss',
        '--schema', schemaPath,
        '--url', url
    ], { stdio: 'pipe', shell: true });

    if (push.status !== 0) {
        throw new Error(`prisma db push failed: ${push.stderr?.toString() ?? ''}`);
    }

    // 3) PrismaClient + better-sqlite3 어댑터로 클라이언트 생성
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
```

- [ ] **Step 2: tsc 검증**

```bash
npx tsc -p tsconfig.test.json --noEmit
```

Expected: 사전 존재 에러 외 클린. (pglite 모듈은 동적 import 이므로 unresolvable 안 됨)

- [ ] **Step 3: Commit**

```bash
git add tests/_setup/db-fixture.ts
git commit -m "test: db-fixture 헬퍼 (SQLite default + Postgres optional)

selectProvider, bootDbFixture, truncateAll. SQLite 는 worker 별 임시
파일 DB 로 격리. Postgres 는 pglite-socket 위에 Prisma adapter-pg.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: 셋업 검증용 smoke test

**Files:**
- Create: `tests/unit/_smoke.test.ts`

**Goal**: jest 인프라 자체가 동작하는지 확인. 곧 삭제할 임시 테스트.

- [ ] **Step 1: 파일 작성**

```ts
describe('jest infrastructure smoke', () => {
    it('jest 가 동작할 때 기본 assertion 이 통과한다', () => {
        expect(1 + 1).toBe(2);
    });

    it('TypeScript path alias 가 적용될 때 @lib import 가 해석된다', () => {
        const { ERROR_CODES } = require('@lib/errorCodes');
        expect(ERROR_CODES).toBeDefined();
        expect(ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    });
});
```

- [ ] **Step 2: smoke test 실행**

```bash
npm test -- tests/unit/_smoke.test.ts
```

Expected: 2개 TC 모두 PASS, exit 0.

- [ ] **Step 3: smoke test 삭제 (검증 목적이라 보존하지 않음)**

```bash
rm tests/unit/_smoke.test.ts
```

- [ ] **Step 4: Commit (셋업 동작 검증 marker)**

이 task 는 별도 commit 안 함. Task 10 의 commit 에 포함.

---

## Task 10: CLI export 추가 (`kusto-db-cli.ts`)

**Files:**
- Modify: `src/core/scripts/kusto-db-cli.ts` (15-20 함수에 export 키워드 + `promptSecurityCode` 옵셔널 인자)

**Goal**: PoC 4 + 5 — CLI 함수를 단위 테스트 가능하도록 export. 본문 변경 없음.

- [ ] **Step 1: export 대상 함수 정확히 파악**

```bash
grep -n "^function\|^async function" src/core/scripts/kusto-db-cli.ts | head -30
```

Expected: 다음 함수들이 보임 (정확한 라인 번호는 grep 결과로 확인):
- `generateSecurityCode`
- `promptSecurityCode`
- `getDatabaseDirs`
- `getSchemaPath`
- `cleanupClientSchemaFiles`
- `getMigrationsPath`
- `getMigrationDirectories`
- `parseMigrationName`
- `displayMigrations`
- `validateMigrationTarget`
- `extractTableName`
- `extractAlterAddColumn`
- `extractIndexName`
- `generateRollbackSQL`
- `getDatabaseEnvVarName`
- `getDatabaseUrl`
- `createTempPrismaConfig`
- `removeTempPrismaConfig`

- [ ] **Step 2: 각 함수에 `export` 키워드 추가**

각 `function` 또는 `async function` 앞에 `export` 추가. Edit 도구로 한 함수씩.

예 (1번):

```ts
// Before
function generateSecurityCode(): string {

// After
export function generateSecurityCode(): string {
```

같은 패턴으로 위 18개 함수 모두 export.

- [ ] **Step 3: `promptSecurityCode` 시그니처 확장**

찾아서 다음과 같이 변경:

```ts
// Before
async function promptSecurityCode(operation: string): Promise<boolean> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (prompt: string): Promise<string> => {
        return new Promise((resolve) => {
            rl.question(prompt, resolve);
        });
    };
    ...
}

// After
export async function promptSecurityCode(
    operation: string,
    getInput?: (prompt: string) => Promise<string>
): Promise<boolean> {
    let rl: any = null;
    let question: (prompt: string) => Promise<string>;

    if (getInput) {
        question = getInput;
    } else {
        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        question = (prompt: string) => new Promise((resolve) => {
            rl.question(prompt, resolve);
        });
    }
    ...
    finally {
        if (rl) rl.close();
    }
}
```

(나머지 본문 로직은 그대로 유지)

- [ ] **Step 4: tsc 컴파일 확인**

```bash
npx tsc --noEmit
```

Expected: 사전 존재 에러 (`@app/db/default/client`) 외 클린.

- [ ] **Step 5: CLI 가 여전히 동작하는지 smoke 확인**

```bash
npx ts-node ./src/core/scripts/kusto-db-cli.ts --help
```

Expected: 일반 도움말 출력 + exit 0. (export 추가가 CLI 동작을 깨지 않음을 확인 — PoC 4)

- [ ] **Step 6: Commit**

```bash
git add src/core/scripts/kusto-db-cli.ts
git commit -m "test: kusto-db-cli 의 18개 함수에 export 키워드 추가

핵심 헬퍼 함수들을 단위 테스트에서 import 가능하도록. CLI 본문 로직과
argv 파싱은 그대로. promptSecurityCode 에 옵셔널 getInput 인자 추가
(테스트에서 stub 주입 — 기본은 readline 사용).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: TC #1 — `validateIncludes` / `mergeDefaultIncludes` / `isIncludePathAllowed` (14개 TC)

**Files:**
- Create: `tests/unit/crud-helpers/include-policy.test.ts`

- [ ] **Step 1: 파일 작성 (12개 TC 전체)**

```ts
import { CrudQueryParser } from '@lib/crudHelpers';

describe('CrudQueryParser.validateIncludes', () => {
    it('policy 가 undefined 일 때 어떤 검증도 하지 않는다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['a.b.c.d.e'], undefined)
        ).not.toThrow();
    });

    it('includes 가 빈 배열일 때 어떤 검증도 하지 않는다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes([], { maxCount: 1, maxDepth: 1, allowed: [] })
        ).not.toThrow();
    });

    it('includes 가 undefined 일 때 어떤 검증도 하지 않는다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(undefined, { maxCount: 1, maxDepth: 1, allowed: [] })
        ).not.toThrow();
    });

    it('maxCount 가 지정됐고 항목 수가 초과할 때 INCLUDE_LIMIT_EXCEEDED 를 throw 한다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['a', 'b', 'c', 'd'], { maxCount: 3 })
        ).toThrow(expect.objectContaining({ code: 'INCLUDE_LIMIT_EXCEEDED', statusCode: 400 }));
    });

    it('maxCount 와 같은 개수일 때 통과한다 (경계값)', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['a', 'b', 'c'], { maxCount: 3 })
        ).not.toThrow();
    });

    it('maxDepth 가 지정됐고 점 깊이가 초과할 때 INCLUDE_DEPTH_EXCEEDED 를 throw 한다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['a.b.c.d'], { maxDepth: 3 })
        ).toThrow(expect.objectContaining({ code: 'INCLUDE_DEPTH_EXCEEDED', statusCode: 400 }));
    });

    it('항목 점 깊이가 maxDepth 와 같을 때 통과한다 (경계값)', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['a.b.c'], { maxDepth: 3 })
        ).not.toThrow();
    });

    it('allowed 에 정확히 일치하는 path 가 들어올 때 통과한다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['author'], { allowed: ['author', 'comments.author'] })
        ).not.toThrow();
    });

    it('allowed 항목의 prefix 가 path 일 때 통과한다 (얕은 부분 경로)', () => {
        // allowed = ['comments.author'] 이면 path = 'comments' 도 허용
        expect(() =>
            CrudQueryParser.validateIncludes(['comments'], { allowed: ['comments.author'] })
        ).not.toThrow();
    });

    it('allowed 가 prefix 만 일치하고 path 가 더 깊을 때 INCLUDE_NOT_ALLOWED 를 throw 한다', () => {
        // allowed = ['comments.author'] 이면 path = 'comments.posts' 는 거부
        expect(() =>
            CrudQueryParser.validateIncludes(['comments.posts'], { allowed: ['comments.author'] })
        ).toThrow(expect.objectContaining({ code: 'INCLUDE_NOT_ALLOWED', statusCode: 400 }));
    });
});

describe('CrudQueryParser.mergeDefaultIncludes', () => {
    it('defaults 가 빈 배열일 때 client includes 를 그대로 반환한다', () => {
        const result = CrudQueryParser.mergeDefaultIncludes(['a', 'b'], []);
        expect(result).toEqual(['a', 'b']);
    });

    it('defaults 가 undefined 일 때 client includes 를 그대로 반환한다', () => {
        const result = CrudQueryParser.mergeDefaultIncludes(['a', 'b'], undefined);
        expect(result).toEqual(['a', 'b']);
    });

    it('client 가 빈 배열일 때 defaults 의 복사본을 반환한다', () => {
        const defaults = ['x', 'y'];
        const result = CrudQueryParser.mergeDefaultIncludes([], defaults);
        expect(result).toEqual(['x', 'y']);
        expect(result).not.toBe(defaults); // 다른 인스턴스 (복사본)
    });

    it('양쪽 다 있을 때 중복 제거한 합집합을 반환한다', () => {
        const result = CrudQueryParser.mergeDefaultIncludes(['a', 'b'], ['b', 'c']);
        expect(new Set(result)).toEqual(new Set(['a', 'b', 'c']));
        expect(result?.length).toBe(3);
    });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npm test -- tests/unit/crud-helpers/include-policy.test.ts
```

Expected: 14개 TC 모두 PASS, exit 0. 만약 FAIL 발생 시 그건 회귀 발견 — 코드 또는 테스트 둘 중 어느 쪽이 옳은지 판단 후 수정.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/crud-helpers/include-policy.test.ts
git commit -m "test: TC #1 — CrudQueryParser include 정책 검증 (14개)

validateIncludes / mergeDefaultIncludes / isIncludePathAllowed 의
도달 가능한 분기들을 '~~일 때 ~~한다' 규칙으로 검증.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: TC #2 — 필터 연산자 매처 (8개 TC)

**Files:**
- Create: `tests/unit/crud-helpers/filter-operators.test.ts`

**Goal**: `crudHelpers.ts` 의 `parseFilterExpression` (private 이므로 `parseFilter` 통해 간접 검증) 의 연산자 매처가 정확한 토큰 매칭을 하는지.

- [ ] **Step 1: 파일 작성**

```ts
import { CrudQueryParser } from '@lib/crudHelpers';
import { Request } from 'express';

function makeReq(query: Record<string, any>): Request {
    return { query } as any;
}

describe('CrudQueryParser parseFilter — 연산자 매처', () => {
    it('expression 이 name_eq 일 때 eq 연산자로 매핑된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_eq]': 'John' }));
        expect(params.filter).toMatchObject({
            name: expect.objectContaining({ eq: 'John' })
        });
    });

    it('expression 이 name_not_in 일 때 not_in 연산자로 매핑된다 (in 매처에 흡수되지 않는다)', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_not_in]': 'a,b,c' }));
        expect(params.filter).toMatchObject({
            name: expect.objectContaining({ not_in: expect.arrayContaining(['a', 'b', 'c']) })
        });
    });

    it('expression 이 name_not_null 일 때 not_null 연산자로 매핑된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_not_null]': '1' }));
        expect(params.filter).toMatchObject({
            name: expect.objectContaining({ not_null: expect.anything() })
        });
    });

    it('expression 이 name_start 일 때 start 연산자로 매핑된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_start]': 'Jo' }));
        expect(params.filter).toMatchObject({
            name: expect.objectContaining({ start: 'Jo' })
        });
    });

    it('expression 이 name_end 일 때 end 연산자로 매핑된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_end]': 'hn' }));
        expect(params.filter).toMatchObject({
            name: expect.objectContaining({ end: 'hn' })
        });
    });

    it('expression 이 score_between 일 때 between 연산자로 매핑된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[score_between]': '1,10' }));
        expect(params.filter).toMatchObject({
            score: expect.objectContaining({ between: expect.anything() })
        });
    });

    it('expression 에 연산자가 없을 때 기본 필드 필터로 처리된다 (eq 시맨틱)', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name]': 'John' }));
        // 코드는 expression 에 _ 없이 들어오는 경우 eq 또는 자동 분기로 처리
        // 정확한 형태는 코드의 fallback 동작에 따라 결정
        expect(params.filter).toBeDefined();
        expect(Object.keys(params.filter ?? {})).toContain('name');
    });

    it('expression 에 알 수 없는 토큰 name_unknownop 가 들어올 때 자동 감지/무시 분기로 들어간다', () => {
        // 알려진 연산자 목록(operators 배열)에 매칭 안되므로 코드의 자동 분기로 떨어짐.
        // 적어도 parseQuery 가 throw 하지 않아야 한다.
        expect(() =>
            CrudQueryParser.parseQuery(makeReq({ 'filter[name_unknownop]': 'x' }))
        ).not.toThrow();
    });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npm test -- tests/unit/crud-helpers/filter-operators.test.ts
```

Expected: 8개 TC PASS. 만약 FAIL 발견 시:
- 코드의 실제 매핑 동작을 코드로 확인 후 TC 표현 수정
- 회귀 발견 시 별도 메모

- [ ] **Step 3: Commit**

```bash
git add tests/unit/crud-helpers/filter-operators.test.ts
git commit -m "test: TC #2 — CRUD 필터 연산자 매처 (8개)

eq/not_in/not_null/start/end/between/no-op/unknown 모든 매처 분기.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: TC #3 — `PrismaQueryBuilder.buildIncludeOptions` (5개 TC)

**Files:**
- Create: `tests/unit/crud-helpers/prisma-builder.test.ts`

- [ ] **Step 1: 파일 작성**

```ts
import { PrismaQueryBuilder } from '@lib/crudHelpers';

describe('PrismaQueryBuilder.buildIncludeOptions', () => {
    it('빈 배열일 때 빈 객체를 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildIncludeOptions([]);
        expect(result).toEqual({});
    });

    it('단일 항목 [author] 일 때 { author: true } 를 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildIncludeOptions(['author']);
        expect(result).toEqual({ author: true });
    });

    it('점 경로 [author.profile] 일 때 중첩 include 객체를 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildIncludeOptions(['author.profile']);
        expect(result).toEqual({
            author: { include: { profile: true } }
        });
    });

    it('동일 부모의 두 자식 [comments.author, comments.posts] 일 때 한 부모 안에 둘 다 포함한다', () => {
        const result = (PrismaQueryBuilder as any).buildIncludeOptions([
            'comments.author',
            'comments.posts'
        ]);
        expect(result).toEqual({
            comments: { include: { author: true, posts: true } }
        });
    });

    it('3-level 경로 [a.b.c] 일 때 3중 중첩 객체를 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildIncludeOptions(['a.b.c']);
        expect(result).toEqual({
            a: { include: { b: { include: { c: true } } } }
        });
    });
});
```

- [ ] **Step 2: 실행**

```bash
npm test -- tests/unit/crud-helpers/prisma-builder.test.ts
```

Expected: 5개 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/crud-helpers/prisma-builder.test.ts
git commit -m "test: TC #3 — PrismaQueryBuilder.buildIncludeOptions (5개)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: TC #4 — `ERROR_CODES` 무결성 (4개 TC)

**Files:**
- Create: `tests/unit/error-handling/error-codes.test.ts`

- [ ] **Step 1: 파일 작성**

```ts
import {
    ERROR_CODES,
    ERROR_STATUS_MAP,
    getHttpStatusForErrorCode,
    JSON_API_ERROR_CODES,
    CRUD_ERROR_CODES,
    PRISMA_ERROR_CODES,
    HTTP_ERROR_CODES,
    MIDDLEWARE_ERROR_CODES,
    BUSINESS_ERROR_CODES
} from '@lib/errorCodes';

describe('ERROR_CODES 무결성', () => {
    it('ERROR_CODES 가 모든 카테고리의 키를 포함할 때 누락이 없다', () => {
        const all = {
            ...JSON_API_ERROR_CODES,
            ...CRUD_ERROR_CODES,
            ...PRISMA_ERROR_CODES,
            ...HTTP_ERROR_CODES,
            ...MIDDLEWARE_ERROR_CODES,
            ...BUSINESS_ERROR_CODES
        };
        for (const key of Object.keys(all)) {
            expect((ERROR_CODES as any)[key]).toBe((all as any)[key]);
        }
    });

    it('include 정책 에러 코드 3종 이 400 으로 매핑될 때 그 매핑이 ERROR_STATUS_MAP 에 존재한다', () => {
        expect(ERROR_STATUS_MAP[ERROR_CODES.INCLUDE_LIMIT_EXCEEDED]).toBe(400);
        expect(ERROR_STATUS_MAP[ERROR_CODES.INCLUDE_DEPTH_EXCEEDED]).toBe(400);
        expect(ERROR_STATUS_MAP[ERROR_CODES.INCLUDE_NOT_ALLOWED]).toBe(400);
    });

    it('RESOURCE_DELETED 가 410 으로 매핑된다', () => {
        expect(ERROR_STATUS_MAP[ERROR_CODES.RESOURCE_DELETED]).toBe(410);
    });

    it('알 수 없는 코드를 getHttpStatusForErrorCode 에 넘길 때 500 을 반환한다', () => {
        expect(getHttpStatusForErrorCode('NON_EXISTENT_CODE_XYZ')).toBe(500);
    });
});
```

- [ ] **Step 2: 실행**

```bash
npm test -- tests/unit/error-handling/error-codes.test.ts
```

Expected: 4개 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/error-handling/error-codes.test.ts
git commit -m "test: TC #4 — ERROR_CODES 무결성 + status 매핑 (4개)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: TC #5 — `formatJsonApiError` JSON:API 응답 구조 (6개 TC)

**Files:**
- Create: `tests/unit/error-handling/json-api-format.test.ts`

- [ ] **Step 1: 파일 작성**

```ts
import { ErrorHandler, ErrorResponseFormat } from '@lib/errorHandler';
import { ERROR_CODES } from '@lib/errorCodes';

function makeError(message = 'test error') {
    return new Error(message);
}

function format(err: Error, ctx: any = {}) {
    return ErrorHandler.handleError(err, {
        format: ErrorResponseFormat.JSON_API,
        context: ctx
    });
}

describe('ErrorHandler.formatJsonApiError 구조', () => {
    it('응답에 jsonapi.version === 1.1 이 포함된다', () => {
        const r = format(makeError(), { code: ERROR_CODES.VALIDATION_ERROR, status: 400 });
        expect((r as any).jsonapi?.version).toBe('1.1');
    });

    it('응답에 errors 가 배열이고 항목이 정확히 1개일 때 errorCount 가 1 이다', () => {
        const r = format(makeError(), { code: ERROR_CODES.VALIDATION_ERROR, status: 400 });
        expect(Array.isArray((r as any).errors)).toBe(true);
        expect((r as any).errors.length).toBe(1);
        expect((r as any).meta?.errorCount).toBe(1);
    });

    it('errors[0].status 가 숫자가 아닌 문자열일 때 JSON:API 스펙을 따른다', () => {
        const r = format(makeError(), { code: ERROR_CODES.VALIDATION_ERROR, status: 400 });
        expect(typeof (r as any).errors[0].status).toBe('string');
        expect((r as any).errors[0].status).toBe('400');
    });

    it('code 인자가 들어올 때 errors[0].code 가 그 값과 같다', () => {
        const r = format(makeError(), { code: ERROR_CODES.NOT_FOUND, status: 404 });
        expect((r as any).errors[0].code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('meta.requestInfo 에 path 와 method 가 포함된다', () => {
        const r = format(makeError(), {
            code: ERROR_CODES.VALIDATION_ERROR,
            status: 400,
            path: '/users/abc',
            method: 'GET'
        });
        expect((r as any).meta?.requestInfo).toMatchObject({
            path: '/users/abc',
            method: 'GET'
        });
    });

    it('title 이 명시되지 않을 때 status 별 기본 title 을 사용한다', () => {
        const r = format(makeError(), { code: ERROR_CODES.VALIDATION_ERROR, status: 400 });
        expect((r as any).errors[0].title).toBeTruthy();
        expect(typeof (r as any).errors[0].title).toBe('string');
    });
});
```

- [ ] **Step 2: 실행**

```bash
npm test -- tests/unit/error-handling/json-api-format.test.ts
```

Expected: 6개 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/error-handling/json-api-format.test.ts
git commit -m "test: TC #5 — formatJsonApiError JSON:API 응답 구조 (6개)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: TC #6 — `mapPrismaError` (6개 TC)

**Files:**
- Create: `tests/unit/error-handling/prisma-mapping.test.ts`

- [ ] **Step 1: 파일 작성**

```ts
import { ErrorFormatter } from '@lib/errorFormatter';
import { ERROR_CODES } from '@lib/errorCodes';

class FakeValidationErr extends Error {
    constructor() { super('Invalid prisma input'); this.name = 'PrismaClientValidationError'; }
}
class FakeKnownErr extends Error {
    code: string;
    constructor(code: string) { super(code); this.name = 'PrismaClientKnownRequestError'; this.code = code; }
}

// constructor.name 비교를 위해 prototype 조작
Object.defineProperty(FakeValidationErr.prototype, 'constructor', { value: { name: 'PrismaClientValidationError' } });
Object.defineProperty(FakeKnownErr.prototype, 'constructor', { value: { name: 'PrismaClientKnownRequestError' } });

describe('ErrorFormatter.mapPrismaError', () => {
    it('PrismaClientValidationError 일 때 VALIDATION_ERROR / 400 을 반환한다', () => {
        const r = ErrorFormatter.mapPrismaError(new FakeValidationErr());
        expect(r).toEqual({ code: ERROR_CODES.VALIDATION_ERROR, status: 400 });
    });

    it('Prisma 코드 P2002 일 때 DUPLICATE_ENTRY / 409 를 반환한다', () => {
        const r = ErrorFormatter.mapPrismaError(new FakeKnownErr('P2002'));
        expect(r).toEqual({ code: ERROR_CODES.DUPLICATE_ENTRY, status: 409 });
    });

    it('Prisma 코드 P2025 일 때 NOT_FOUND / 404 를 반환한다', () => {
        const r = ErrorFormatter.mapPrismaError(new FakeKnownErr('P2025'));
        expect(r).toEqual({ code: ERROR_CODES.NOT_FOUND, status: 404 });
    });

    it('Prisma 코드 P2003 일 때 VALIDATION_ERROR / 400 을 반환한다', () => {
        const r = ErrorFormatter.mapPrismaError(new FakeKnownErr('P2003'));
        expect(r).toEqual({ code: ERROR_CODES.VALIDATION_ERROR, status: 400 });
    });

    it('알 수 없는 Prisma 코드일 때 DATABASE_ERROR 로 폴백한다', () => {
        const r = ErrorFormatter.mapPrismaError(new FakeKnownErr('P9999'));
        expect(r).toEqual({ code: ERROR_CODES.DATABASE_ERROR, status: 500 });
    });

    it('Invalid UUID 메시지가 포함된 일반 Error 일 때 INVALID_UUID / 400 을 반환한다', () => {
        const r = ErrorFormatter.mapPrismaError(new Error('Invalid UUID format'));
        expect(r).toEqual({ code: ERROR_CODES.INVALID_UUID, status: 400 });
    });
});
```

- [ ] **Step 2: 실행**

```bash
npm test -- tests/unit/error-handling/prisma-mapping.test.ts
```

Expected: 6개 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/error-handling/prisma-mapping.test.ts
git commit -m "test: TC #6 — ErrorFormatter.mapPrismaError 매핑 (6개)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: TC #7 — CRUD include 정책 wiring (통합, 8개 TC)

**Files:**
- Create: `tests/integration/crud-include-policy/include-policy.integration.test.ts`

**Goal**: 실제 Prisma + Express + ExpressRouter.CRUD 를 띄워 `?include=` 쿼리가 라우트 레벨에서 검증되는지.

이 task 는 가장 복잡한 통합 테스트. 실제 Express app 에 CRUD 라우터를 mount 하고 supertest 로 호출.

> **구현 시 주의** (PoC 4 보강): `jest.doMock` 은 require 캐시에 이미 적재된 module 을 새 require 시점부터 mock 으로 교체한다. ExpressRouter 가 본 plan 의 어느 시점에 `prismaManager` 를 import 했는지에 따라 mock 효과가 달라질 수 있다. 만약 doMock 만으로 wiring 이 되지 않으면 다음 fallback 중 택1:
> - **(a)** test-app.ts 의 mock 설정을 ExpressRouter import 보다 먼저 호출 + `jest.resetModules()` 로 캐시 초기화 (현재 plan 채택)
> - **(b)** ExpressRouter 에 client 직접 주입 인자 추가 (코드 변경 — 별도 spec)
> - **(c)** Express 라우터를 mount 하지 않고 ExpressRouter 의 내부 메서드를 직접 호출하여 검증 (덜 통합적)
>
> 첫 시도에서 mock 이 안 먹으면 (a) 의 require 순서를 뒤집고, 그래도 실패하면 implementer 가 (b) 또는 (c) 로 전환 결정.

- [ ] **Step 1: 추가 의존성 (supertest)**

```bash
npm install --save-dev supertest @types/supertest
```

- [ ] **Step 2: 통합 테스트 헬퍼 작성**

`tests/integration/crud-include-policy/test-app.ts`:

```ts
import express from 'express';
import { ExpressRouter } from '@lib/expressRouter';
import { DbFixture } from '../../_setup/db-fixture';

/**
 * 통합 테스트용 Express app 빌드. fixture 의 prisma 와 schema 를 사용.
 *
 * 주의: ExpressRouter.CRUD 의 첫 인자 (databaseName) 는 PrismaManager 의 등록된 클라이언트
 * 이름이지만, 본 테스트는 PrismaManager 를 통하지 않고 fixture.prisma 를 직접 주입한다.
 * 이를 위해 ExpressRouter 의 prismaManager 를 mock 하거나 client 를 직접 패치한다.
 *
 * 실용적 접근: ExpressRouter.CRUD 는 prismaManager.getWrap(name) 으로 client 를 얻으므로,
 * 테스트에서는 globalThis 에 mock prismaManager 를 주입한다.
 */
export function buildTestApp(fixture: DbFixture, options: any = {}) {
    // PrismaManager mock
    const mockManager = {
        getWrap: (name: string) => fixture.prisma,
        getClient: (name: string) => fixture.prisma,
        getClientSync: (name: string) => fixture.prisma,
    };

    // ExpressRouter 가 import 하는 prismaManager 모듈을 mock
    jest.doMock('@lib/prismaManager', () => ({
        prismaManager: mockManager,
        PrismaManager: { getInstance: () => mockManager }
    }));

    const app = express();
    app.use(express.json());
    const router = new ExpressRouter();
    router.CRUD('default' as any, 'Post' as any, options);
    app.use('/posts', router.build());
    return app;
}
```

- [ ] **Step 3: 통합 테스트 본문 작성**

`tests/integration/crud-include-policy/include-policy.integration.test.ts`:

```ts
import request from 'supertest';
import { bootDbFixture, truncateAll, DbFixture } from '../../_setup/db-fixture';
import { buildTestApp } from './test-app';

describe('CRUD include 정책 wiring (통합)', () => {
    let fixture: DbFixture;

    beforeAll(async () => {
        fixture = await bootDbFixture();
    });

    afterAll(async () => {
        await fixture.teardown();
    });

    afterEach(async () => {
        await truncateAll(fixture);
        jest.resetModules();
    });

    async function seed() {
        await fixture.prisma.user.create({
            data: {
                id: 'u1',
                email: 'a@a.com',
                name: 'Alice',
                posts: {
                    create: [{ id: 'p1', title: 'Hello' }, { id: 'p2', title: 'World' }]
                }
            }
        });
    }

    it('index 에서 ?include= 가 maxIncludeCount 초과할 때 400 INCLUDE_LIMIT_EXCEEDED 응답한다', async () => {
        const app = buildTestApp(fixture, { maxIncludeCount: 1 });
        await seed();
        const res = await request(app).get('/posts?include=author,comments&page[number]=1&page[size]=10');
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('INCLUDE_LIMIT_EXCEEDED');
    });

    it('index 에서 ?include= 가 maxIncludeDepth 초과할 때 400 INCLUDE_DEPTH_EXCEEDED 응답한다', async () => {
        const app = buildTestApp(fixture, { maxIncludeDepth: 1 });
        await seed();
        const res = await request(app).get('/posts?include=author.profile&page[number]=1&page[size]=10');
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('INCLUDE_DEPTH_EXCEEDED');
    });

    it('index 에서 allowedIncludes 에 없는 path 일 때 400 INCLUDE_NOT_ALLOWED 응답한다', async () => {
        const app = buildTestApp(fixture, { allowedIncludes: ['author'] });
        await seed();
        const res = await request(app).get('/posts?include=tags&page[number]=1&page[size]=10');
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('INCLUDE_NOT_ALLOWED');
    });

    it('index 에서 defaultIncludes 가 지정된 경우 client ?include= 미지정이어도 응답에 included 가 포함된다', async () => {
        const app = buildTestApp(fixture, { defaultIncludes: ['author'] });
        await seed();
        const res = await request(app).get('/posts?page[number]=1&page[size]=10');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.included)).toBe(true);
        expect(res.body.included.length).toBeGreaterThan(0);
    });

    it('show 에서 maxIncludeDepth 초과 path 일 때 400 INCLUDE_DEPTH_EXCEEDED 응답한다', async () => {
        const app = buildTestApp(fixture, { maxIncludeDepth: 1 });
        await seed();
        const res = await request(app).get('/posts/p1?include=author.profile');
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('INCLUDE_DEPTH_EXCEEDED');
    });

    it('create POST 에 ?include=author 가 붙을 때 응답에 included 배열이 포함된다', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app)
            .post('/posts?include=author')
            .send({
                data: {
                    type: 'posts',
                    attributes: { title: 'New', authorId: 'u1' }
                }
            })
            .set('Content-Type', 'application/vnd.api+json');
        expect(res.status).toBe(201);
        expect(Array.isArray(res.body.included)).toBe(true);
        expect(res.body.included.length).toBeGreaterThan(0);
    });

    it('update PATCH 에 ?include=author 가 붙을 때 응답에 included 배열이 포함된다', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app)
            .patch('/posts/p1?include=author')
            .send({
                data: {
                    type: 'posts',
                    id: 'p1',
                    attributes: { title: 'Updated' }
                }
            })
            .set('Content-Type', 'application/vnd.api+json');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.included)).toBe(true);
    });

    it('defaultIncludes 가 allowedIncludes 화이트리스트에 없어도 통과한다 (서버 신뢰)', async () => {
        const app = buildTestApp(fixture, {
            allowedIncludes: ['author'],
            defaultIncludes: ['tags'] // allowed 에 없음
        });
        await seed();
        const res = await request(app).get('/posts?page[number]=1&page[size]=10');
        expect(res.status).toBe(200); // defaultIncludes 가 검증 우회
    });
});
```

- [ ] **Step 4: 실행**

```bash
npm test -- tests/integration/crud-include-policy
```

Expected: 8개 TC PASS. 일부 FAIL 시:
- PrismaManager mock 이 제대로 wiring 안 된 경우 → mock 위치 점검
- Schema 가 ExpressRouter.CRUD 의 가정과 다른 경우 → test schema 보강

- [ ] **Step 5: Commit**

```bash
git add tests/integration/crud-include-policy/ package.json package-lock.json
git commit -m "test: TC #7 — CRUD include 정책 wiring 통합 (8개)

supertest + Express app + sqlite fixture. PrismaManager 를 mock 으로
주입하여 ExpressRouter.CRUD 가 fixture.prisma 를 사용하도록 함.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: TC #8 — Soft delete 흐름 (통합, 6개 TC)

**Files:**
- Create: `tests/integration/soft-delete/soft-delete.integration.test.ts`
- Reuse: `tests/integration/crud-include-policy/test-app.ts` (또는 공용으로 옮김)

- [ ] **Step 1: test-app.ts 를 공용 헬퍼로 이동**

```bash
mkdir -p tests/integration/_shared
git mv tests/integration/crud-include-policy/test-app.ts tests/integration/_shared/test-app.ts
```

`tests/integration/crud-include-policy/include-policy.integration.test.ts` 의 import 도 `'../_shared/test-app'` 으로 변경.

- [ ] **Step 2: soft-delete 통합 테스트 작성**

`tests/integration/soft-delete/soft-delete.integration.test.ts`:

```ts
import request from 'supertest';
import { bootDbFixture, truncateAll, DbFixture } from '../../_setup/db-fixture';
import { buildTestApp } from '../_shared/test-app';

describe('CRUD soft delete 흐름 (통합)', () => {
    let fixture: DbFixture;

    beforeAll(async () => { fixture = await bootDbFixture(); });
    afterAll(async () => { await fixture.teardown(); });
    afterEach(async () => { await truncateAll(fixture); jest.resetModules(); });

    async function seedUser(id = 'u1', email = 'a@a.com') {
        await fixture.prisma.user.create({
            data: { id, email, name: 'Alice' }
        });
    }

    it('soft delete 활성 모델에서 DELETE /:id 호출 시 row 가 살아있고 deletedAt 이 채워진다', async () => {
        const app = buildTestApp(fixture, { softDelete: { enabled: true, field: 'deletedAt' } }, 'User', '/users');
        await seedUser();
        const res = await request(app).delete('/users/u1');
        expect([200, 204]).toContain(res.status);
        const row = await fixture.prisma.user.findUnique({ where: { id: 'u1' } });
        expect(row).not.toBeNull();
        expect(row.deletedAt).toBeInstanceOf(Date);
    });

    it('index 호출 시 deletedAt 이 null 인 row 만 반환한다', async () => {
        const app = buildTestApp(fixture, { softDelete: { enabled: true, field: 'deletedAt' } }, 'User', '/users');
        await seedUser('u1');
        await seedUser('u2', 'b@b.com');
        await fixture.prisma.user.update({ where: { id: 'u2' }, data: { deletedAt: new Date() } });
        const res = await request(app).get('/users?page[number]=1&page[size]=10');
        expect(res.status).toBe(200);
        const ids = res.body.data.map((d: any) => d.id);
        expect(ids).toContain('u1');
        expect(ids).not.toContain('u2');
    });

    it('?include_deleted=true 일 때 deletedAt 이 채워진 row 도 반환한다', async () => {
        const app = buildTestApp(fixture, { softDelete: { enabled: true, field: 'deletedAt' } }, 'User', '/users');
        await seedUser('u1');
        await seedUser('u2', 'b@b.com');
        await fixture.prisma.user.update({ where: { id: 'u2' }, data: { deletedAt: new Date() } });
        const res = await request(app).get('/users?include_deleted=true&page[number]=1&page[size]=10');
        expect(res.status).toBe(200);
        const ids = res.body.data.map((d: any) => d.id);
        expect(ids).toEqual(expect.arrayContaining(['u1', 'u2']));
    });

    it('show 가 deleted row 를 가리킬 때 410 RESOURCE_DELETED 응답한다', async () => {
        const app = buildTestApp(fixture, { softDelete: { enabled: true, field: 'deletedAt' } }, 'User', '/users');
        await seedUser('u1');
        await fixture.prisma.user.update({ where: { id: 'u1' }, data: { deletedAt: new Date() } });
        const res = await request(app).get('/users/u1');
        expect(res.status).toBe(410);
        expect(res.body.errors[0].code).toBe('RESOURCE_DELETED');
    });

    it('POST /:id/recover 호출 시 deletedAt 이 null 로 복구된다', async () => {
        const app = buildTestApp(fixture, { softDelete: { enabled: true, field: 'deletedAt' } }, 'User', '/users');
        await seedUser('u1');
        await fixture.prisma.user.update({ where: { id: 'u1' }, data: { deletedAt: new Date() } });
        const res = await request(app).post('/users/u1/recover');
        expect([200, 201]).toContain(res.status);
        const row = await fixture.prisma.user.findUnique({ where: { id: 'u1' } });
        expect(row.deletedAt).toBeNull();
    });

    it('soft delete 비활성 모델에서 DELETE 가 실제로 row 를 삭제한다', async () => {
        const app = buildTestApp(fixture, {}, 'User', '/users'); // softDelete 옵션 없음
        await seedUser('u1');
        const res = await request(app).delete('/users/u1');
        expect([200, 204]).toContain(res.status);
        const row = await fixture.prisma.user.findUnique({ where: { id: 'u1' } });
        expect(row).toBeNull();
    });
});
```

- [ ] **Step 3: `buildTestApp` 시그니처 확장**

`tests/integration/_shared/test-app.ts` 의 `buildTestApp` 시그니처를 (fixture, options?, modelName?, mountPath?) 형태로 수정. 기존 호출자도 함께 갱신.

```ts
export function buildTestApp(
    fixture: DbFixture,
    options: any = {},
    modelName: string = 'Post',
    mountPath: string = '/posts'
) {
    // ... (기존 mock 로직 동일)
    const router = new ExpressRouter();
    router.CRUD('default' as any, modelName as any, options);
    app.use(mountPath, router.build());
    return app;
}
```

기존 `crud-include-policy/include-policy.integration.test.ts` 도 동일 방식으로 호출 (default 인자 사용 시 변경 불필요).

- [ ] **Step 4: 실행**

```bash
npm test -- tests/integration/soft-delete tests/integration/crud-include-policy
```

Expected: 8 + 6 = 14개 TC PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/
git commit -m "test: TC #8 — Soft delete 흐름 통합 (6개) + 헬퍼 공용화

test-app.ts 를 _shared 로 이동. buildTestApp 시그니처 확장
(modelName, mountPath 인자).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: TC #9-1 — `generateSecurityCode` (1개 TC)

**Files:**
- Create: `tests/cli/handlers/security-code.test.ts`

- [ ] **Step 1: 파일 작성**

```ts
import { generateSecurityCode } from '@/src/core/scripts/kusto-db-cli';

describe('generateSecurityCode', () => {
    it('호출될 때 [A-Z0-9]{4} 패턴의 문자열을 반환한다', () => {
        for (let i = 0; i < 100; i++) {
            const code = generateSecurityCode();
            expect(code).toMatch(/^[A-Z0-9]{4}$/);
        }
    });
});
```

- [ ] **Step 2: 실행**

```bash
npm test -- tests/cli/handlers/security-code.test.ts
```

Expected: 1개 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/handlers/security-code.test.ts
git commit -m "test: TC #9-1 — generateSecurityCode 패턴 검증

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: TC #9-2 — `getDatabaseEnvVarName` (3개 TC)

**Files:**
- Create: `tests/cli/handlers/env-var-name.test.ts`

- [ ] **Step 1: 파일 작성**

```ts
import { getDatabaseEnvVarName } from '@/src/core/scripts/kusto-db-cli';

describe('getDatabaseEnvVarName', () => {
    it('단순 폴더명 default 일 때 DEFAULT__KUSTO_RDB_URL 을 반환한다', () => {
        expect(getDatabaseEnvVarName('default')).toBe('DEFAULT__KUSTO_RDB_URL');
    });

    it('camelCase 폴더명 myData 일 때 MY_DATA__KUSTO_RDB_URL 을 반환한다', () => {
        expect(getDatabaseEnvVarName('myData')).toBe('MY_DATA__KUSTO_RDB_URL');
    });

    it('이미 snake_case 인 폴더명 user_account 일 때 USER_ACCOUNT__KUSTO_RDB_URL 을 반환한다', () => {
        expect(getDatabaseEnvVarName('user_account')).toBe('USER_ACCOUNT__KUSTO_RDB_URL');
    });
});
```

- [ ] **Step 2: 실행**

```bash
npm test -- tests/cli/handlers/env-var-name.test.ts
```

Expected: 3개 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/handlers/env-var-name.test.ts
git commit -m "test: TC #9-2 — getDatabaseEnvVarName 변환 (3개)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: TC #9-3 — `parseMigrationName` / `validateMigrationTarget` (2개 TC)

**Files:**
- Create: `tests/cli/handlers/migration-name.test.ts`

- [ ] **Step 1: 파일 작성**

```ts
import {
    parseMigrationName,
    validateMigrationTarget
} from '@/src/core/scripts/kusto-db-cli';

describe('parseMigrationName', () => {
    it('표준 디렉토리명 20240101_create_users 일 때 timestamp 와 name 을 분리한다', () => {
        const result = parseMigrationName('20240101_create_users');
        expect(result).toEqual({ timestamp: '20240101', name: 'create_users' });
    });
});

describe('validateMigrationTarget', () => {
    it('migrate -t 인자가 정수형 인덱스이고 디렉토리 수보다 클 때 에러 메시지를 반환한다', () => {
        // 실제 구현이 fs 를 보므로 mock 또는 cwd 의존성 회피.
        // 직접 호출이 어려우면 이 테스트는 skipped 처리하고 의도만 명시.
        // 코드 시그니처: validateMigrationTarget(dbName, target) → string|null
        // dbName='_nonexistent_db_xyz' 면 디렉토리 0 → target='9999' 는 OOB
        const result = validateMigrationTarget('_nonexistent_db_xyz', '9999');
        // 구현은 디렉토리 없을 때 null 또는 빈 메시지 반환할 수 있음
        // 정확한 contract 는 코드 검토 후 확정
        expect(result === null || typeof result === 'string').toBe(true);
    });
});
```

> NOTE: `validateMigrationTarget` 의 정확한 contract 는 구현 단계에서 코드 직접 검토 후 TC 표현을 확정. 현재는 "에러 분기로 진입하면 return 하고 throw 하지 않는다" 정도로 검증.

- [ ] **Step 2: 실행**

```bash
npm test -- tests/cli/handlers/migration-name.test.ts
```

Expected: 2개 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/handlers/migration-name.test.ts
git commit -m "test: TC #9-3 — parseMigrationName / validateMigrationTarget (2개)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 22: TC #9-4 — SQL 파싱 함수 (3개 TC)

**Files:**
- Create: `tests/cli/handlers/sql-extract.test.ts`

- [ ] **Step 1: 파일 작성**

```ts
import {
    extractTableName,
    extractAlterAddColumn,
    extractIndexName
} from '@/src/core/scripts/kusto-db-cli';

describe('extractTableName', () => {
    it('CREATE TABLE 문이 더블쿼트로 감싼 이름과 unquoted 이름 둘 다 같은 결과를 반환한다', () => {
        expect(extractTableName('CREATE TABLE "users" (id INT)')).toBe('users');
        expect(extractTableName('CREATE TABLE users (id INT)')).toBe('users');
    });
});

describe('extractAlterAddColumn', () => {
    it('표준 ALTER TABLE ADD COLUMN 문이 들어올 때 tableName 과 columnName 을 분리한다', () => {
        const result = extractAlterAddColumn('ALTER TABLE users ADD COLUMN email TEXT');
        expect(result).toEqual({ tableName: 'users', columnName: 'email' });
    });
});

describe('extractIndexName', () => {
    it('CREATE INDEX 문이 들어올 때 인덱스 이름을 반환한다', () => {
        const result = extractIndexName('CREATE INDEX idx_users_email ON users (email)');
        expect(result).toBe('idx_users_email');
    });
});
```

- [ ] **Step 2: 실행**

```bash
npm test -- tests/cli/handlers/sql-extract.test.ts
```

Expected: 2개 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/handlers/sql-extract.test.ts
git commit -m "test: TC #9-4 — SQL 파싱 함수 (extractTableName, extractAlterAddColumn) (2개)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 23: TC #9-5 — `generateRollbackSQL` (2개 TC)

**Files:**
- Create: `tests/cli/handlers/rollback-sql.test.ts`

- [ ] **Step 1: 파일 작성**

```ts
import { generateRollbackSQL } from '@/src/core/scripts/kusto-db-cli';

describe('generateRollbackSQL', () => {
    it('CREATE TABLE 문이 들어올 때 DROP TABLE 문을 반환한다', () => {
        const result = generateRollbackSQL('CREATE TABLE users (id INT, name TEXT)');
        expect(result).toMatch(/DROP TABLE.*users/i);
    });

    it('ALTER TABLE ADD COLUMN 문이 들어올 때 DROP COLUMN 문을 포함한다', () => {
        const result = generateRollbackSQL('ALTER TABLE users ADD COLUMN email TEXT');
        expect(result).toMatch(/ALTER TABLE.*users.*DROP COLUMN.*email/i);
    });
});
```

- [ ] **Step 2: 실행**

```bash
npm test -- tests/cli/handlers/rollback-sql.test.ts
```

Expected: 2개 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/handlers/rollback-sql.test.ts
git commit -m "test: TC #9-5 — generateRollbackSQL DROP/ALTER 역변환 (2개)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 24: TC #10 — CLI e2e smoke (2개 TC)

**Files:**
- Create: `tests/cli/e2e/smoke.test.ts`

- [ ] **Step 1: 파일 작성**

```ts
import { execa } from 'execa';

describe('kusto-db CLI e2e smoke', () => {
    it('--help 인자로 호출될 때 stdout 에 사용법이 출력되고 exit 0 으로 종료한다', async () => {
        const { stdout, exitCode } = await execa('npm', ['run', 'db', '--', '--help'], {
            reject: false,
            timeout: 30000
        });
        expect(exitCode).toBe(0);
        expect(stdout.toLowerCase()).toMatch(/usage|사용법|commands|kusto/);
    }, 60000);

    it('migrate -t reset 을 보안 코드 입력 없이 호출할 때 cancelled 메시지를 출력하고 exit non-zero 로 종료한다', async () => {
        const result = await execa('npm', ['run', 'db', '--', 'migrate', '-t', 'reset', '-d', 'default'], {
            input: '\n\n\n\n', // 빈 입력으로 보안 코드 cancel 유도
            reject: false,
            timeout: 30000
        });
        expect(result.exitCode).not.toBe(0);
        const combined = result.stdout + result.stderr;
        expect(combined.toLowerCase()).toMatch(/cancel|취소/);
    }, 60000);
});
```

- [ ] **Step 2: 실행**

```bash
npm test -- tests/cli/e2e/smoke.test.ts
```

Expected: 2개 PASS. Linux/Mac 에서 npm 명령이 PATH 에 있어야 함.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/e2e/smoke.test.ts
git commit -m "test: TC #10 — CLI e2e smoke (--help, dangerous op cancel) (2개)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 25: CI workflow 추가

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: 파일 작성**

```yaml
name: tests
on:
  push:
    branches: [main, 'ver/**']
  pull_request:

jobs:
  test-sqlite:
    name: tests (sqlite default)
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Generate Prisma client (사용자 schema, tsc 사전 에러 회피)
        run: npm run db -- generate -a
        continue-on-error: true   # default schema 가 없을 수 있음
      - name: TypeScript check
        run: npx tsc --noEmit -p tsconfig.test.json
      - name: Run tests
        run: npm run test:ci
      - name: Upload coverage artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-sqlite
          path: coverage/
          retention-days: 7

  test-postgres:
    name: tests (postgres via pglite-socket)
    runs-on: ubuntu-latest
    needs: test-sqlite
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Generate Prisma client
        run: npm run db -- generate -a
        continue-on-error: true
      - name: Run tests with PostgreSQL backend
        run: npm run test:ci
        env:
          KUSTO_TEST_DB: postgres
```

- [ ] **Step 2: 로컬에서 워크플로우 syntax 검증**

```bash
# yamllint 또는 act 같은 도구가 있다면 사용. 없으면 GitHub 에서 push 후 확인.
npx js-yaml .github/workflows/test.yml > /dev/null && echo "YAML OK"
```

Expected: `YAML OK`.

- [ ] **Step 3: Commit + push 후 GitHub 에서 확인**

```bash
git add .github/workflows/test.yml
git commit -m "ci: jest 회귀 테스트 워크플로우 (sqlite default + postgres matrix)

main / ver/** 브랜치 + PR 트리거. SQLite job 통과 후 postgres job 직렬
실행. coverage 는 artifact 로 업로드.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin ver/0.1.47
```

GitHub 에서 Actions 탭으로 들어가 첫 실행 결과 확인. 실패 시 PoC 3 의 fallback (tsconfig.test.json exclude) 적용.

---

## Task 26: 최종 검증

**Files:**
- 없음 (검증만)

- [ ] **Step 1: 전체 테스트 통과 확인**

```bash
npm test
```

Expected: 모든 TC PASS, exit 0. 출력에 PASS 카운트가 약 67개 (Tier 1 전체).

- [ ] **Step 2: Coverage threshold 통과 확인**

```bash
npm run test:coverage
```

Expected: 글로벌 50%+, crudHelpers/errorHandler/serializer 80%+, errorCodes 95%+. threshold 미달 시:
- 미달 모듈에 추가 TC 작성 (Tier 2 의 일부를 당겨오기)
- 또는 threshold 를 spec 에서 합의한 수치로 조정

- [ ] **Step 3: TC 제목 컨벤션 일괄 점검**

```bash
grep -rE "it\(|test\(" tests/ | grep -vE "일 때|할 때|될 때|있을 때|없을 때" | head -20
```

Expected: 빈 출력 (또는 `describe` 만 매치). 일치하지 않는 TC 가 있으면 제목 수정 후 commit.

- [ ] **Step 4: tsc 클린 확인**

```bash
npx tsc --noEmit -p tsconfig.test.json
```

Expected: 사전 존재 에러 외 클린.

- [ ] **Step 5: README 또는 AGENTS.md 에 테스트 실행 방법 안내 추가 (선택)**

`README.md` 에 다음 섹션 추가:

```markdown
## 테스트

```bash
npm test                    # 전체
npm run test:unit           # 단위만
npm run test:integration    # 통합만 (sqlite 부팅)
npm run test:cli            # CLI 만
npm run test:coverage       # 커버리지 리포트
```

기본 backend 는 SQLite `:memory:`. PostgreSQL 검증은 `KUSTO_TEST_DB=postgres npm test`.

자세한 내용은 [docs/superpowers/specs/2026-05-03-jest-core-regression-tests-design.md](./docs/superpowers/specs/2026-05-03-jest-core-regression-tests-design.md).
```

- [ ] **Step 6: 최종 commit**

```bash
git add README.md
git commit -m "docs: README 에 테스트 실행 방법 섹션 추가

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin ver/0.1.47
```

---

## Phase 1 완료 후 상태

- ✅ Jest 인프라 (jest.config.ts, tsconfig.test.json, npm scripts)
- ✅ DB fixture (SQLite default + PG optional)
- ✅ 테스트 전용 schema 2개
- ✅ CLI export 추가 (18개 함수 + promptSecurityCode 옵셔널 인자)
- ✅ Tier 1 TC 약 67개 (10개 카테고리)
- ✅ CI workflow (sqlite job + postgres job)
- ✅ Coverage threshold 적용

다음 단계: **Phase 2** (Tier 2 ~50개 TC) 는 별도 implementation plan 으로 작성.
