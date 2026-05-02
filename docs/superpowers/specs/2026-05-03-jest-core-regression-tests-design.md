# Jest Core Regression Tests — Design Spec

- **Spec ID**: B
- **Date**: 2026-05-03
- **Branch**: ver/0.1.47
- **Status**: Awaiting user review
- **Related**: Spec A (Documentation system enhancement) — independent, parallel

## 1. 목적

Express.js-Kusto 프레임워크의 코어 코드에 대한 회귀 안전망을 Jest 기반으로 구축한다. 최근 진행된 다음 변경들이 향후 깨지지 않도록 보호하는 것이 1순위 목표:

- `ERROR_CODES` 상수 통일과 하드코딩 문자열 제거
- `console.*` → winston `log.*` 일괄 변환
- CRUD include 정책 옵션 (`maxIncludeCount` / `maxIncludeDepth` / `allowedIncludes` / `defaultIncludes`)
- 사일런트 실패에 `throw` 추가 (transactionCommitManager, soft-delete 관계 처리)
- DocumentationGenerator / errorFormatter 의 데드 코드 제거
- 문서·코드 불일치 정정 (필터 연산자 이름, JSON:API 응답 포맷 등)

CLI 도구 (`kusto-db-cli.ts`) 의 핵심 동작도 회귀 보호 대상에 포함한다.

본 spec 은 **테스트 인프라와 Tier 1 TC** 까지의 구현 범위를 정의한다. Tier 2/3 는 implementation plan 에서 phase 분리하여 작성한다.

## 2. 핵심 원칙

### 2.1 도달 가능성

- "도달 가능한 필수 TC" 만 작성. 100% line coverage 가 목표가 아니라 **회귀 보호 가치**.
- 이론상 가능하지만 실제 호출 경로가 없는 분기는 TC 면제 (`// no test: unreachable` 주석 권장).

### 2.2 TC 작성 컨벤션 — **"~~일 때 ~~한다(된다)"**

모든 `it()` / `test()` 의 제목은 다음 규칙을 따른다:

- **"~~일 때"** — 조건 / 입력 / 상태 (When/Given)
- **"~~한다(된다)"** — 기대 동작 / 결과 (Then)

예:

```ts
it('maxCount 가 지정됐고 항목 수가 초과할 때 INCLUDE_LIMIT_EXCEEDED 를 throw 한다', () => { ... });
it('항목 점 깊이가 maxDepth 와 같을 때 통과한다', () => { ... });
```

`describe()` 는 대상의 명사형 (식별자명 또는 한국어 자연어). 한 파일 = 한 단위 (`tests/unit/crud-helpers/include-policy.test.ts` 같이 미러 구조).

### 2.3 Provider 독립

코어 회귀 테스트는 DB provider (PostgreSQL / MySQL / SQLite) 에 종속되면 안 된다. 통합 테스트의 default backend 는 SQLite `:memory:` (Prisma native 지원) 이며, PostgreSQL 전용 동작은 별도 디렉토리 + 환경변수로 분기한다.

## 3. 디렉토리 구조

```
express.js-kusto/
├── jest.config.ts                  # Jest 설정 (ts-jest + path alias + coverage threshold)
├── tsconfig.test.json              # tests/ 전용 (jest 타입 추가)
├── tests/
│   ├── _setup/
│   │   ├── db-fixture.ts           # SQLite/PG 백엔드 부팅·schema 적용·teardown 헬퍼 (export only)
│   │   └── env-fixture.ts          # 테스트용 process.env 격리 (스냅샷·복원)
│   ├── _fixtures/
│   │   ├── test-schema.sqlite.prisma   # 기본 테스트 schema (provider = "sqlite")
│   │   ├── test-schema.postgres.prisma # PG-specific TC 용
│   │   └── seed.ts                     # 공통 seed 데이터
│   ├── unit/
│   │   ├── crud-helpers/           # CrudQueryParser, validateIncludes, 필터 연산자, PrismaQueryBuilder
│   │   ├── express-router/         # 옵션 처리, fluent API, build()
│   │   ├── error-handling/         # ERROR_CODES, formatJsonApiError, mapPrismaError
│   │   ├── serializer/             # BigInt/Date/Prisma Date 직렬화
│   │   ├── validator/              # Schema 기반 검증
│   │   └── docs-generator/         # OpenAPI 변환 (Spec A 후 강화)
│   ├── integration/
│   │   ├── repository/             # BaseRepository, $transaction
│   │   ├── crud-include-policy/    # GET / 의 include 정책 wiring
│   │   ├── soft-delete/            # DELETE/index/410 Gone/recover 흐름
│   │   ├── crud-create-update/     # POST/PATCH 응답 + ?include=
│   │   ├── prisma-manager/         # getWrap 재연결 시뮬레이션
│   │   └── postgres-specific/      # PG 전용 TC (KUSTO_TEST_DB=postgres 시만)
│   └── cli/
│       ├── handlers/               # 핸들러 함수 직접 호출 (단위)
│       └── e2e/                    # execa 로 `npm run db -- ...` smoke (2개)
└── .github/workflows/test.yml      # CI: tsc + jest (SQLite + PG matrix)
```

## 4. Jest 설정 핵심

### 4.1 npm scripts

```jsonc
{
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage",
  "test:ci": "jest --ci --coverage --maxWorkers=2",
  "test:unit": "jest tests/unit",
  "test:integration": "jest tests/integration",
  "test:cli": "jest tests/cli"
}
```

### 4.2 jest.config.ts (요약)

```ts
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  // 글로벌 setup 파일은 두지 않음. 각 테스트 파일이 필요한 fixture 를
  // 직접 import + beforeAll/afterAll 에서 호출하는 패턴 (단위 테스트는
  // fixture 부팅 비용을 부담하지 않음).
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/app/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@lib/(.*)$': '<rootDir>/src/core/lib/$1',
    '^@ext/(.*)$': '<rootDir>/src/core/external/$1',
    '^@db/(.*)$': '<rootDir>/src/app/db/$1',
    '^@/(.*)$': '<rootDir>/$1'
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
  }
};

export default config;
```

### 4.3 신규 devDependencies

```jsonc
{
  "jest": "^29",
  "ts-jest": "^29",
  "@types/jest": "^29",
  "jest-mock-extended": "^4",
  "execa": "^9",
  "@electric-sql/pglite": "*",
  "@electric-sql/pglite-socket": "*"
}
```

`@electric-sql/pglite*` 는 transitive 로 이미 존재하나 직접 사용하므로 명시 추가.

## 5. DB 통합 전략

### 5.1 백엔드 매트릭스

| Provider | 백엔드 | 활성 조건 | 책임 |
|---|---|---|---|
| **SQLite** | `:memory:` (Prisma native) | 항상 (기본) | 모든 통합 TC 의 default 검증 |
| **PostgreSQL** | `pglite-socket` + `@prisma/adapter-pg` | `KUSTO_TEST_DB=postgres` | PG 전용 동작 (배열, JSON 연산자 등) |
| **MySQL** | (보류) | 본 spec 범위 밖 | — |

### 5.2 테스트 전용 schema

`src/app/db/default/schema.prisma` (사용자 영역) 와 분리. `tests/_fixtures/test-schema.sqlite.prisma` / `test-schema.postgres.prisma` 가 코어 테스트의 단일 진실. 사용자 schema 변경이 코어 테스트를 깨지 않도록 격리.

### 5.3 Fixture 라이프사이클

- **`beforeAll`**: 백엔드 부팅 + `prisma db push --schema=...` 으로 schema 적용
- **`afterEach`**: 모든 테이블 truncate (SQLite: `DELETE FROM`, PG: `TRUNCATE ... CASCADE`)
- **`afterAll`**: 백엔드 종료

### 5.4 Worker 격리

Jest 의 `--maxWorkers` 사용 시 worker 별로 독자 SQLite 파일 (`file:test-${workerId}.db?mode=memory`) 또는 pglite 인스턴스 (port 0 자동 할당) 사용. PoC 단계에서 검증.

## 6. CLI 테스트 전략

### 6.1 변경 규모 — `export` 키워드만 추가

`src/core/scripts/kusto-db-cli.ts` (1938줄) 의 본문은 그대로. 다음 함수에 `export` 추가:

- `generateSecurityCode`, `getDatabaseEnvVarName`, `getDatabaseUrl`
- `parseMigrationName`, `validateMigrationTarget`, `getMigrationDirectories`, `displayMigrations`
- `extractTableName`, `extractAlterAddColumn`, `extractIndexName`, `generateRollbackSQL`
- `getDatabaseDirs`, `getSchemaPath`, `getMigrationsPath`
- `createTempPrismaConfig`, `removeTempPrismaConfig`
- `cleanupClientSchemaFiles`

추가로 `promptSecurityCode(operation, getInput?)` — 옵셔널 인자 `getInput` 추가 (기본은 readline 사용). 테스트에서 stub 주입 가능.

### 6.2 단위 테스트 (mock fs 일부 사용)

순수 함수는 직접 호출. fs 의존 함수는 `jest.mock('fs')` 또는 `memfs` 로 격리.

### 6.3 e2e Smoke (`execa`)

2개만:

1. `npm run db -- --help` → stdout 에 사용법, exit 0
2. `migrate -t reset -d default` 를 보안 코드 입력 없이 → cancelled, exit non-zero

## 7. CI / Coverage Gates

### 7.1 GitHub Actions — `.github/workflows/test.yml` 신규

```yaml
name: tests
on:
  push:
    branches: [main, 'ver/**']
  pull_request:

jobs:
  test-sqlite:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run db -- generate -a   # generated client 부재로 인한 tsc 에러 회피
      - run: npx tsc --noEmit
      - run: npm run test:ci

  test-postgres:
    runs-on: ubuntu-latest
    needs: test-sqlite
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run db -- generate -a
      - run: npm run test:ci
        env:
          KUSTO_TEST_DB: postgres
```

### 7.2 Coverage 임계치

본 spec 은 **회귀 안전망 회복** 이 목표라 글로벌 임계치를 보수적 (50%) 으로, 핵심 모듈만 엄격 (80%, errorCodes 95%) 으로 둔다. Section 4.2 참고.

## 8. Tier 우선순위 매트릭스

### 8.1 Tier 1 — 즉시 (회귀 가치 최대)

| # | 기능 | 종류 | 위치 | 예상 TC 수 |
|---|------|------|------|---|
| 1 | `CrudQueryParser.validateIncludes` / `mergeDefaultIncludes` / `isIncludePathAllowed` | 단위 | tests/unit/crud-helpers/include-policy.test.ts | 12 |
| 2 | `CrudQueryParser` 필터 연산자 매처 | 단위 | tests/unit/crud-helpers/filter-operators.test.ts | 8 |
| 3 | `PrismaQueryBuilder.buildIncludeOptions` / `buildSelectOptions` / `buildWhereOptions` | 단위 | tests/unit/crud-helpers/prisma-builder.test.ts | 5 |
| 4 | `ERROR_CODES` 무결성 + `getHttpStatusForErrorCode` | 단위 | tests/unit/error-handling/error-codes.test.ts | 4 |
| 5 | `ErrorHandler.formatJsonApiError` JSON:API errors[] 구조 | 단위 | tests/unit/error-handling/json-api-format.test.ts | 6 |
| 6 | `ErrorFormatter.mapPrismaError` | 단위 | tests/unit/error-handling/prisma-mapping.test.ts | 6 |
| 7 | CRUD include 정책 wiring (index/show/create/update) | 통합 (sqlite) | tests/integration/crud-include-policy/ | 8 |
| 8 | Soft delete 흐름 | 통합 (sqlite) | tests/integration/soft-delete/ | 6 |
| 9 | CLI 핵심 단위 | 단위 | tests/cli/handlers/*.test.ts | 10 |
| 10 | CLI smoke (`--help`, dangerous op cancel) | e2e (execa) | tests/cli/e2e/smoke.test.ts | 2 |

**Tier 1 합계: 약 67개 TC**

### 8.2 Tier 2 — 중요 (기본 기능)

| # | 기능 | 종류 |
|---|------|------|
| 11 | `BaseRepository.client` getter, `$transaction` (retry 옵션) | 통합 (sqlite) |
| 12 | `RepositoryManager` 등록·로드 | 단위 (mock fs) |
| 13 | `prismaManager.getWrap` 재연결 Proxy | 단위 (mock client) |
| 14 | `prismaManager` URL 결정 우선순위 | 단위 (mock fs) |
| 15 | `DependencyInjector` 모듈 등록·camelCase 변환 | 단위 |
| 16 | `Validator` 타입별 검증 | 단위 |
| 17 | `Serializer` BigInt/Date/Prisma Date | 단위 |
| 18 | `ExpressRouter` fluent API | 단위 |
| 19 | `loadRoutes_V6_Clean` 경로 변환 (`[param]` / `[^regex]` / `..[^wildcard]`) | 단위 |
| 20 | JSON:API Atomic Operations | 통합 (sqlite) |

**Tier 2 합계: 약 50개 TC** (implementation plan 에서 확정)

### 8.3 Tier 3 — Spec A 후

| # | 기능 | 종류 |
|---|------|------|
| 21 | `DocumentationGenerator.convertSchemaToOpenAPI` (Spec A 강화 후) | 단위 |
| 22 | Schema API 활성 조건 + IP 제한 + 응답 형식 | 통합 |
| 23 | `PrismaSchemaAnalyzer` DMMF 추출 | 단위 (mock client) |

## 9. Implementation Plan 단계 PoC 항목

| # | PoC | 검증 방법 | Fallback |
|---|---|---|---|
| 1 | Prisma 7 + SQLite `:memory:` + worker 격리 | 단순 모델 SELECT/INSERT + 동시 worker 2개 | 임시 파일 DB 또는 `--maxWorkers=1` |
| 2 | `pglite-socket` + `@prisma/adapter-pg` (PG job) | wire-protocol 호환 | testcontainers postgres 또는 PG job 보류 |
| 3 | CI 의 `tsc --noEmit` — generated client 부재 회피 | `npm run db -- generate -a` 선행 | tsconfig.test.json 에서 exclude |
| 4 | `kusto-db-cli.ts` export 추가가 webpack/ts-node 빌드와 충돌 없는지 | `npm run build` 와 `npm run db -- list` 양쪽 정상 | 별도 핸들러 파일 분리 (큰 변경, 사용자 확인 필요) |
| 5 | `promptSecurityCode` 옵셔널 인자 추가 | grep + 호출처 점검 | 별도 헬퍼 함수 |
| 6 | Jest worker 별 `process.env` 격리 | beforeAll 에서 worker-id 기반 URL 생성 | 워커 단일화 |

## 10. Phased Delivery

| Phase | 범위 | 산출물 |
|---|---|---|
| **Phase 1** | Jest 셋업 + Tier 1 TC #1-10 + CI workflow | jest.config.ts, tsconfig.test.json, npm scripts, tests/_setup, Tier 1 TC ~67개, CI 동작 |
| **Phase 2** | Tier 2 TC #11-20 | 추가 ~50개 TC |
| **Phase 3** | (Spec A 완료 후) Tier 3 TC #21-23 | 추가 ~15개 TC |

각 phase 끝에 커밋. Phase 1 완료 시점에 안전망 가치의 대부분 확보.

## 11. Out-of-Scope

| 항목 | 이유 / 처리 방향 |
|---|---|
| ESLint / Prettier 도입 | 별도 spec |
| `husky` / pre-commit hook | CI 게이트로 충분, 별도 spec |
| Codecov / 외부 커버리지 서비스 | CI artifact 로 충분 |
| 사용자 영역 (`src/app/**`) 회귀 테스트 | 사용자 코드 책임 |
| `updater/` 폴더 도구 | 별개 책임 |
| `webpack.config.js` / 빌드 산출물 검증 | `tsc --noEmit` + 수동 |
| `nodemon` / `ts-node` 자체 동작 | 외부 도구 신뢰 |
| Spec A (DocumentationGenerator 강화) 의 실제 변경 | Spec A 책임 |
| MySQL 통합 테스트 | testcontainers 비용 큼, 별도 spec |
| 시각/UI 검증 | 문자열 포함 여부만 |
| 부하/성능/동시성 | `artillery-test.yml` 담당 |
| 모든 atomic op 조합 | 핵심만 검증 (Tier 2#20) |

## 12. 성공 기준

본 spec 의 implementation 완료 시점에 다음이 모두 충족되어야 한다:

1. `npm test` 호출로 단위·통합·CLI 단위·CLI e2e 모두 실행되고 통과한다
2. `npm run test:coverage` 가 Section 4.2 의 임계치를 만족한다 (글로벌 50%, crudHelpers/errorHandler/serializer 80%, errorCodes 95%)
3. `.github/workflows/test.yml` 의 SQLite job 이 main/PR 에서 자동 실행된다
4. PostgreSQL job (`KUSTO_TEST_DB=postgres`) 도 정상 통과한다
5. CLI 단위 TC 가 `kusto-db-cli.ts` 의 모든 export 함수의 도달 가능 분기를 커버한다
6. CLI e2e smoke 2개가 통과한다
7. 모든 TC 의 `it()` 제목이 "~~일 때 ~~한다(된다)" 규칙을 따른다 (review 게이트)
8. Section 8.1 의 Tier 1 약 67개 TC 가 모두 작성·통과한다
9. Tier 2 (Phase 2) 약 50개 TC 도 작성·통과한다
10. Tier 3 (Phase 3) 는 Spec A 완료 후 별도 작업

## 13. 의존성 / 위험 요약

| 위험 | 심각도 | 완화 |
|---|---|---|
| Prisma 7 + SQLite 의 일부 기능 차이 (배열, JSON 연산자) | Low | provider-agnostic schema. 차이는 PG job 으로 |
| `prisma db push` 가 매 fixture 부팅마다 호출되어 느림 | Med | worker 당 1회만. afterEach 는 truncate 만 |
| CLI subprocess 테스트의 OS 별 path 차이 | Low | `execa` cross-platform. CI 는 ubuntu only |
| 사용자 코드베이스의 `src/app/db/default/client/` 부재로 컴파일 에러 | Med | CI step 에 `prisma generate` 선행 |
| pglite 의 PostgreSQL 호환성 한계 (advisory lock 등) | Low | 코어 테스트는 그런 기능 사용 안 함 |
| `kusto-db-cli.ts` export 추가가 향후 리팩토링 부담 | Low | 본 spec 은 export 만, 큰 분리는 별도 spec |

---

**다음 단계**: 본 spec 사용자 승인 → `superpowers:writing-plans` 스킬로 implementation plan (phase 1 우선) 작성.
