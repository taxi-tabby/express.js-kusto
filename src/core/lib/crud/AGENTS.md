# crud/ - CRUD 엔진 (JSON:API v1.1)

`router.CRUD(db, model, options)` 호출 시 JSON:API v1.1 준수 REST 엔드포인트(목록/단일/생성/수정/삭제/복구/atomic/relationship)를 자동 생성하는 tier. 쿼리 파싱·Prisma 쿼리 빌드·JSON:API 변환·PK 파싱·미디어 타입 상수를 담당한다.

## Structure

```
crud/
├── crudRouteBuilder.ts   # CRUD 라우트 일괄 등록 오케스트레이터 (index/show/create/update/destroy/recover/atomic/relationship)
├── crudHelpers.ts        # 쿼리 파싱 + Prisma 쿼리 빌더 + JSON:API 변환 + JSON:API 타입 정의
├── primaryKeyParsers.ts  # :id 파라미터 파서 (uuid/string/int/smart) — 순수 함수
└── jsonApiConstants.ts   # JSON:API 미디어 타입 상수 (SSOT)
```

## Files

### crudRouteBuilder.ts
**책임**: `ExpressRouter.CRUD()` 위임 대상. ExpressRouter 가 자신의 공유 능력을 담은 `CrudBuilderContext` 를 넘기면, 이 빌더가 활성 액션(`only`/`except` 계산)을 골라 Express 라우트를 등록한다. 각 핸들러는 JSON:API Content-Type 설정 → 쿼리/PK 파싱 → include 정책 적용 → Prisma 호출 → JSON:API 엔벨로프 직렬화 → `beforeXxx`/`afterXxx` 훅 실행 흐름을 따른다. soft delete(410 Gone 응답), relationships 처리(connect/disconnect/set, soft delete 대체), atomic operations(`POST /atomic`, 트랜잭션), 개발 모드 스키마 등록도 여기서 처리한다.
**주요 export**:
- `interface CrudBuilderContext` — 빌더가 ExpressRouter 로부터 요구하는 능력 집합(`router`, `basePath`, `schemaRegistry`, `schemaAnalyzer`, `wrapHandler`, `wrapMiddleware`, `registerDocumentation`).
- `class CrudRouteBuilder` — 생성자가 `CrudBuilderContext` 를 받고 `build(databaseName, modelName, options?)` 진입점을 노출. 나머지는 모두 private(`setupIndexRoute`/`setupShowRoute`/`setupCreateRoute`/`setupUpdateRoute`/`setupDestroyRoute`/`setupRecoverRoute`/`setupAtomicOperationsRoute`/`processRelationships` 등).
**의존**: 동일 tier `@lib/crud/crudHelpers`(CrudQueryParser·PrismaQueryBuilder·CrudResponseFormatter·JsonApiTransformer·JSON:API 타입), `@lib/crud/primaryKeyParsers`(parseString·parseIdSmart·getSmartPrimaryKeyParser), `@lib/crud/jsonApiConstants`(미디어 타입). 외부 tier: `@lib/data/database/prismaManager`(`getWrap`/`getClient`), `@lib/http/validation/requestHandler`(검증 미들웨어), `@lib/http/serialization/serializer`(BigInt/Date 직렬화), `@lib/http/errors/errorFormatter`·`errorHandler`·`errorCodes`, `@lib/devtools/schema-api/*`(CrudSchemaRegistry·PrismaSchemaAnalyzer, 개발 모드 한정), `@lib/devtools/documentation`(OpenAPI 헬퍼), `@lib/http/routing/expressRouter`(타입 `HandlerFunction`·`MiddlewareHandlerFunction`), `@ext/winston`.

### crudHelpers.ts
**책임**: CRUD 의 순수 변환 로직과 JSON:API 도메인 타입의 단일 출처. 쿼리스트링(`include`/`select`/`fields`/`sort`/`page`/`filter`, OR 조건 포함)을 파싱하고, include 정책(깊이·개수·화이트리스트) 검증, 스키마 기반 스마트 타입 변환(UUID 검증 실패 시 400 거부)을 수행한다. 파싱 결과를 Prisma `findMany`/`include`/`where`/`orderBy` 옵션으로 빌드하고, 페이지네이션 메타/에러 정제(민감정보 redact)와 raw row → JSON:API 리소스 변환을 담당한다.
**주요 export**:
- 클래스: `CrudQueryParser`(`parseQuery`·`validateIncludes`·`mergeDefaultIncludes`), `PrismaQueryBuilder`(`buildFindManyOptions`·`buildIncludeOptions`·`buildSelectOptions`), `CrudResponseFormatter`(`createPaginationMeta`·`formatResponse`·`formatError`·`sanitizePrismaError`·`sanitizeDetails`), `JsonApiTransformer`(`transformToResource`·`transformToCollection`·`createJsonApiErrorResponse`·`createJsonApiResponse`·`createIncludedResources`).
- 타입/인터페이스: `CrudQueryParams`, `SortParam`, `PageParam`, `FilterCondition`, `FilterOperator`, `ErrorSecurityOptions`, JSON:API 계열(`JsonApiResource`, `JsonApiResourceIdentifier`, `JsonApiRelationship`, `JsonApiRelationshipData`, `JsonApiResponse`, `JsonApiError`, `JsonApiErrorResponse`, `JsonApiObject`, `JsonApiLinks`, `JsonApiRelationshipLinks`, `JsonApiAtomicOperation`, `JsonApiAtomicOperationsDocument`, `JsonApiAtomicResultsDocument`).
**의존**: 외부 tier `@lib/http/errors/errorHandler`(`ErrorHandler`·`ErrorResponseFormat`), `@lib/http/errors/errorCodes`(`ERROR_CODES`·`PRISMA_CANONICAL_ERROR_MAP`), `@ext/winston`. 동일 tier 의존 없음(이 파일이 crud tier 의 타입/로직 허브이며 `crudRouteBuilder` 가 이를 소비).

### primaryKeyParsers.ts
**책임**: CRUD 라우트의 `:id` / `:primaryKey` 경로 파라미터를 적절한 타입으로 변환하는 순수 함수 모음. 인스턴스 상태에 의존하지 않으며, `options.primaryKeyParser` 미지정 시 빌더가 자동 선택하는 기본 파서를 제공한다.
**주요 export**: `parseUuid`(UUID 검증 후 문자열), `parseString`(그대로), `parseInt_`(정수 검증), `parseIdSmart`(UUID/숫자/문자열 자동 판별), `getSmartPrimaryKeyParser(databaseName, modelName, primaryKey)`(PK 이름으로 파서 선택 — `uuid` 계열이면 `parseUuid`, 그 외 `parseIdSmart`).
**의존**: 없음(외부/동일 tier import 없는 leaf 모듈). `crudRouteBuilder` 가 소비.

### jsonApiConstants.ts
**책임**: JSON:API v1.1 미디어 타입 문자열의 단일 출처(SSOT). 과거 곳곳에 하드코딩되던 `application/vnd.api+json` 표기를 한곳으로 모아 누락을 방지한다.
**주요 export**: `JSON_API_CONTENT_TYPE`(표준 미디어 타입), `JSON_API_ATOMIC_CONTENT_TYPE`(atomic 확장 미디어 타입).
**의존**: 없음(leaf 상수 모듈). `crudRouteBuilder` 및 라우팅/미들웨어/문서 tier 가 소비.

## Import 규약

정식 import 경로는 단일 `@lib` 루트를 깊게 내려가는 `@lib/crud/<file>` 형태다.

```ts
import { CrudRouteBuilder, CrudBuilderContext } from '@lib/crud/crudRouteBuilder';
import { CrudQueryParser, PrismaQueryBuilder, JsonApiTransformer } from '@lib/crud/crudHelpers';
import { parseIdSmart, getSmartPrimaryKeyParser } from '@lib/crud/primaryKeyParsers';
import { JSON_API_CONTENT_TYPE } from '@lib/crud/jsonApiConstants';
```

**레이어링 방향**:
- **Inbound**: `@lib/http/routing/expressRouter` 가 `CrudRouteBuilder` 를 인스턴스화하고 자신을 `CrudBuilderContext` 로 주입한다. 라우팅/미들웨어/문서 tier 는 `jsonApiConstants` 를 참조한다.
- **Outbound (crud → 하위 tier)**: `crud` 는 `@lib/data/database`(Prisma), `@lib/http/{validation,serialization,errors}`, 그리고 개발 모드 한정으로 `@lib/devtools/{schema-api,documentation}`(AUTO_DOCS / ENABLE_SCHEMA_API 게이트) 에 의존한다.
- **Intra-tier**: `crudRouteBuilder` → (`crudHelpers`, `primaryKeyParsers`, `jsonApiConstants`). 나머지 세 파일은 서로 의존하지 않는 leaf/허브로, `crudRouteBuilder` 가 단일 소비자다.
