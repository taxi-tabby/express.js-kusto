# types/ - 전역 타입 확장 및 코드젠 타입

Express 요청 객체에 대한 손수 작성한 앰비언트 확장과, `src/app/{db,injectable,repos}` 구조로부터 자동 생성되는 타입 매핑을 한곳에 모은 티어다.

## Structure

```
types/
├── express-extensions.ts            # 손수 작성: Express.Request에 .with / .kusto 앰비언트 확장
├── generated-db-types.ts            # 자동 생성(do-not-edit): DB 클라이언트 타입 + PrismaManager 오버로드 augment
├── generated-injectable-types.ts    # 자동 생성(do-not-edit): injectable/middleware 레지스트리 타입
└── generated-repository-types.ts    # 자동 생성(do-not-edit): repository 레지스트리 타입
```

## express-extensions.ts (손수 작성)

`declare global`로 `Express.Request` 인터페이스를 확장하여 프레임워크 전용 속성을 타입 레벨에 주입한다.

- **책임**: 핸들러에서 `req.with`(WITH 미들웨어로 주입된 파라미터 맵)와 `req.kusto`(중앙 관리자)를 타입 안전하게 노출.
- **주요 export**: 없음(`export {}`로 모듈 스코프만 확보). 부수효과로 `Express.Request`에 다음을 추가:
  - `with: { [K in MiddlewareParamName]?: MiddlewareParams[K] }` — 미들웨어별 파라미터.
  - `kusto: KustoManager` — injectable/repo/db 통합 접근자.
- **의존**: `@lib/types/generated-injectable-types`의 `MiddlewareParamName`/`MiddlewareParams`(타입), `@lib/data/di/kustoManager`의 `KustoManager`(타입). 같은 티어의 코드젠 타입과 데이터/DI 티어를 타입 전용으로 참조한다.

## generated-db-types.ts (자동 생성 · 수정 금지)

`src/app/db/` 폴더 구조에서 발견된 각 데이터베이스의 Prisma 클라이언트를 타입에 매핑하고, `PrismaManager`의 메서드 오버로드를 보강한다.

- **책임**: DB 이름 → Prisma 클라이언트 인스턴스 타입 매핑, `getWrap`/`getClient`의 구체 오버로드 제공.
- **주요 export**: `interface DatabaseClientMap`, `type DatabaseClientType<T>`, `type DatabaseName`, `type DatabaseNamesUnion`, `interface PrismaManagerWrapOverloads`, `interface PrismaManagerClientOverloads`.
- **augment**: `declare module '../data/database/prismaManager'`로 `PrismaManager`에 DB별 `getWrap`/`getClient` 오버로드를 추가(상대 경로는 `@lib/data/database/prismaManager`를 가리킴).
- **의존**: `@app/db/{name}/client`의 `PrismaClient`(예: `default`). 앱 DB 클라이언트와 데이터 티어를 향한다.
- **재생성**: `src/core/scripts/generate-*.js`(`npm run generate`). **손수 편집 금지.**

## generated-injectable-types.ts (자동 생성 · 수정 금지)

`src/app/injectable/`의 모듈/미들웨어/미들웨어 인터페이스 파일을 스캔해 레지스트리와 타입 맵을 생성한다(모듈이 없으면 빈 인터페이스로 생성).

- **책임**: `injected.*`/`WITH(...)` 접근의 타입 안전성 기반 제공.
- **주요 export**: `interface Injectable`, `interface Middleware`, `interface MiddlewareParams`; 런타임 레지스트리 `MODULE_REGISTRY`/`MIDDLEWARE_REGISTRY`/`MIDDLEWARE_PARAM_MAPPING`; 타입 `ModuleName`/`MiddlewareName`/`MiddlewareParamName` 및 헬퍼 `GetModuleType`/`GetMiddlewareType`/`GetMiddlewareParamType`.
- **의존**: `@app/injectable/*`(생성 소스). 외부 import 없음(앱이 비어있을 땐 순수 타입/상수만).
- **재생성**: `src/core/scripts/generate-*.js`(`npm run generate`). **손수 편집 금지.**

## generated-repository-types.ts (자동 생성 · 수정 금지)

`src/app/repos/`의 `*.repository.ts`를 스캔해 `repo.getRepository(name)` 반환 타입과 동적 로딩 레지스트리를 생성한다.

- **책임**: 리포지토리 이름 → 인스턴스 타입 매핑 및 lazy import 레지스트리 제공.
- **주요 export**: `interface RepositoryTypeMap`, `const REPOSITORY_REGISTRY`, `type RepositoryName`, `type GetRepositoryType<T>`.
- **의존**: `@app/repos/*.repository`(예: `example.repository`)를 default import. 앱 리포지토리 티어를 향한다.
- **재생성**: `src/core/scripts/generate-*.js`(`npm run generate`). **손수 편집 금지.**

## Import 규칙

표준 import 경로는 `@lib/types/<file>`다(`@lib` 단일 루트, 티어 경로 심화). 예: `@lib/types/express-extensions`, `@lib/types/generated-db-types`.

- **Inbound(이 티어를 쓰는 쪽)**: 라우터/핸들러 타입(`req.with`, `req.kusto`, `injected.*`, `repo.*`, `db.*`)과 `PrismaManager`가 코드젠 타입/오버로드를 소비한다.
- **Outbound(이 티어가 쓰는 것)**: 코드젠 파일들은 `@app/{db,injectable,repos}`(앱 워크스페이스)를 향하고, `express-extensions.ts`는 `@lib/data/di/kustoManager`와 같은 티어의 `generated-injectable-types`를 타입 전용으로 참조한다. `generated-db-types.ts`는 `@lib/data/database/prismaManager` 모듈을 augment한다.
- **주의**: `generated-*` 3종은 codegen 산출물이므로 직접 수정하면 다음 `npm run generate`에서 덮어쓰여진다. 변경이 필요하면 소스(`src/app/...`) 또는 생성기(`src/core/scripts/generate-*.js`)를 수정한다.
