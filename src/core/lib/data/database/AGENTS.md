# data/database/ - Multi-DB Persistence Layer

멀티 DB Prisma 클라이언트의 생명주기 관리, 리포지터리 추상 베이스, 분산 트랜잭션 처리, DB 폴더명→환경변수 변환 규칙을 담당하는 티어.

## Structure

```
database/
├── prismaManager.ts            # 멀티 DB Prisma 클라이언트 싱글톤 (getWrap 자동 재연결, driver adapter)
├── baseRepository.ts           # 리포지터리 추상 베이스 (this.client, 트랜잭션/배치)
├── repositoryManager.ts        # 생성된 REPOSITORY_REGISTRY 에서 리포지터리 로드
├── transactionCommitManager.ts # Saga + 보상(compensating) 분산 트랜잭션
└── dbNaming.ts                 # 폴더명 → 환경변수명 변환 단일 출처(SSOT)
```

## Files

### `prismaManager.ts`
- **책임**: `src/app/db/{name}/` 폴더를 스캔해 DB별 Prisma 클라이언트를 동적 import/생성하고 싱글톤으로 보관. `getWrap()` 호출 시 연결 오류가 나면 DB당 최대 `MAX_RECONNECTION_ATTEMPTS=3`회, `RECONNECTION_COOLDOWN_MS=30000`(30초) 쿨다운으로 lazy 재연결한다. 주기적 헬스 폴링은 없고 `healthCheck()`는 온디맨드 호출이다. driver adapter 는 datasource provider 로 자동 감지.
- **주요 export**: `class PrismaManager`(`getInstance`, `initialize`, `getClient`(async, 재연결 포함), `getClientSync`, `getWrap`, `getAvailableDatabases`, `isConnected`, `getStatus`, `healthCheck`), `const prismaManager`(싱글톤), `interface DatabaseConfig`, 그리고 `folderNameToEnvVarName`를 `dbNaming`에서 re-export.
- **의존**: `@lib/data/database/dbNaming`(폴더명 변환), `@lib/types/generated-db-types`(`DatabaseClientMap`/`DatabaseName`/`PrismaManager*Overloads`), `@ext/winston`, `fs`/`path`/`dotenv`.

### `baseRepository.ts`
- **책임**: 앱 리포지터리(`src/app/repos/*`)가 상속하는 추상 베이스. 하위 클래스의 `getDatabaseName()` 구현을 생성자에서 강제 검증하고, `this.client`(= `PrismaManager.getWrap()`)로 타입 안전한 Prisma 클라이언트를 제공한다. 트랜잭션/배치 헬퍼를 포함한다.
- **주요 export**: `abstract class BaseRepository<T extends DatabaseNamesUnion>`(protected `getDatabaseName()`, protected get `client`, `getAsyncClient()`, `$createDistributedOperation()`, `$transaction()`, `$batchOperation()`, `$runDistributedTransaction()`), `interface DistributedTransactionOperation`.
- **의존**: `@lib/data/database/prismaManager`(`prismaManager`/`PrismaManager`), `@lib/data/database/transactionCommitManager`(분산 트랜잭션 위임), `@lib/types/generated-db-types`, `@ext/winston`.
- **주의**: `$createDistributedOperation()`/`$runDistributedTransaction()`는 Prisma 커넥션 풀 한계로 신뢰성이 낮아 사용을 피한다(CLAUDE.md 참고).

### `repositoryManager.ts`
- **책임**: 생성된 `REPOSITORY_REGISTRY`의 모든 리포지터리를 동적 import 하여 인스턴스화하고(생성자에 `PrismaManager` 주입) 이름으로 조회·재로드한다. 싱글톤.
- **주요 export**: `class RepositoryManager`(`getInstance`, `initialize`, `getRepository`, `hasRepository`, `getLoadedRepositoryNames`, `reloadRepository`, `getStatus`), `const repositoryManager`(싱글톤).
- **의존**: `@lib/data/database/prismaManager`(주입용 싱글톤), `@lib/types/generated-repository-types`(`REPOSITORY_REGISTRY`/`RepositoryName`/`GetRepositoryType`), `@ext/winston`.

### `transactionCommitManager.ts`
- **책임**: Saga 패턴 + 보상 트랜잭션 기반 분산 트랜잭션 실행기. Prisma 커넥션 풀 제약으로 진정한 2PC가 불가능하므로 Phase 1(부수효과 없는 검증) → Phase 2(순차 커밋) → 실패 시 보상(compensation) 순으로 동작한다. 최종 일관성·Durability는 보장하나 Atomicity/Isolation은 부분 보장이다.
- **주요 export**: `class TransactionCommitManager`(`executeDistributedTransaction`), `enum TransactionState`, `interface TransactionParticipant`, `interface TransactionCommitOptions`, `interface TransactionCommitResult`.
- **의존**: `@lib/data/database/prismaManager`(`PrismaManager` 주입), `@lib/types/generated-db-types`, `@ext/winston`. `baseRepository`에서 인스턴스화되어 사용된다.

### `dbNaming.ts`
- **책임**: DB 폴더명을 연결 환경변수명으로 변환하는 단일 출처(SSOT). camelCase/PascalCase 경계에 `_`를 삽입하고 UPPER_SNAKE 로 바꾼 뒤 `__KUSTO_RDB_URL` 접미사를 붙인다(예: `myDatabase` → `MY_DATABASE__KUSTO_RDB_URL`). 의존성 없는 모듈로 분리되어 `prismaManager`(런타임)와 CLI(`kusto-db-cli`) 양쪽에서 import 한다.
- **주요 export**: `function folderNameToEnvVarName(folderName: string): string`.
- **의존**: 없음(외부 의존성 없는 순수 함수). `prismaManager`가 이를 re-export 한다.

## Import note

정규 import 경로는 `@lib/data/database/<file>` 형태다 (단일 `@lib` 루트, 경로만 깊어짐).
예: `@lib/data/database/prismaManager`, `@lib/data/database/baseRepository`.

- 인바운드: 앱 리포지터리(`src/app/repos/*`)가 `baseRepository`를 상속하고, `RepositoryManager`/`KustoManager`(`@lib/data/di`)가 `prismaManager`·`repositoryManager`를 소비한다. `Core` 초기화가 `PrismaManager → RepositoryManager` 순으로 호출.
- 아웃바운드: 생성 타입(`@lib/types/generated-*`)과 로깅(`@ext/winston`)에만 의존한다. 상위 라우팅/DI/문서 티어를 역참조하지 않는다. `dbNaming`은 이 티어 내 최하단(무의존) 모듈이다.
