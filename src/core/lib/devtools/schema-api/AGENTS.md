# schema-api/ - CRUD 스키마 Introspection API (ENABLE_SCHEMA_API)

Prisma DMMF 를 introspection 하여 CRUD 스키마 정보를 등록·조회하는 하위 티어. `/api/schema/*` 엔드포인트를 제공하며 `ENABLE_SCHEMA_API=true` 또는 `NODE_ENV=development`/`dev` 일 때만 활성화된다. 분석 결과(`PrismaModelInfo` 등)는 CRUD 라우터와 `documentation/` 티어 양쪽이 공유한다.

## Structure

```
schema-api/
├── crudSchemaTypes.ts      # 상수(CRUD_ACTIONS/PRISMA_TYPE_MAPPING) + 모든 스키마 인터페이스
├── relationshipConfig.ts   # 관계 패턴/Many-to-Many 탐지 매니저
├── prismaSchemaAnalyzer.ts # Prisma 클라이언트 DMMF introspection (CRUD+docs 공급원)
├── crudSchemaRegistry.ts   # CRUD 스키마 등록/조회 싱글톤 레지스트리 + 활성화 게이트
├── schemaApiRouter.ts      # /api/schema GET 엔드포인트 Express 라우터 (dev-only)
└── schemaApiSetup.ts       # Express 앱에 라우터 등록하는 헬퍼 (중복 등록 방지)
```

## Files

### crudSchemaTypes.ts
- **역할**: 티어 전반의 상수와 타입 원천. 순수 정의 파일(런타임 의존 없음).
- **주요 export**: 상수 `CRUD_ACTIONS`(`index`/`show`/`create`/`update`/`destroy` — `recover` 제외), `PRISMA_TYPE_MAPPING`(Prisma → JS 타입). 인터페이스 `PrismaFieldMetadata`, `PrismaRelationInfo`, `PrismaIndexInfo`, `PrismaModelInfo`, `CrudEndpointInfo`, `CrudSchemaInfo`, `SchemaApiResponse<T>`, `AllSchemasResponse`.
- **의존**: 없음.

### relationshipConfig.ts
- **역할**: 모델 관계를 패턴 매칭으로 분석해 Many-to-Many 관계를 탐지하고 조인 테이블/컬럼/역방향 관계명을 동적 생성. User-Role/User-Permission/Role-Permission 및 generic m2m 기본 패턴을 내장.
- **주요 export**: `RelationshipConfigManager`(클래스 — `isManyToManyRelation()`/`getManyToManyConfig()`/`isIntermediateTableRelation()`/`getActualTargetModel()`/`generateInverseSideName()`/`addPattern()`/`addManyToManyConfig()` 등), `RelationshipPattern`(인터페이스), `ManyToManyConfig`(인터페이스).
- **의존**: `@ext/util`(`pluralize`, `singularize`).

### prismaSchemaAnalyzer.ts
- **역할**: Prisma 클라이언트의 DMMF(`_runtimeDataModel` 등 경계)를 분석하여 모델/필드/관계/인덱스/enum 메타데이터(`PrismaModelInfo`)를 추출. DB명별 인스턴스 캐시와 모델 캐시 보유. CRUD 라우터와 문서 동기화의 공통 introspection 공급원.
- **주요 export**: `PrismaSchemaAnalyzer`(클래스 — `getInstance()`/생성자, `getDatabaseName()`/`getAllModels()`/`getModel()`/`hasModel()`/`getPrimaryKeyField()`/`getRequiredFields()`/`getUpdatableFields()`/`getJsonFields()`/`isEnumType()`/`getEnumValues()`/`clearCache()`).
- **의존**: `@ext/winston`(`log`), `@lib/devtools/schema-api/crudSchemaTypes`(모델 타입들 + `PRISMA_TYPE_MAPPING`). Prisma 클라이언트는 `any` 경계로 받음.

### crudSchemaRegistry.ts
- **역할**: CRUD 스키마 정보를 등록·관리하는 싱글톤 레지스트리. `checkEnvironment()` 로 활성화 여부를 판정(`isSchemaApiEnabled()` — 티어의 단일 캐논 게이트)하고, analyzer 로부터 전 모델을 자동 등록하며 DB/모델별 조회 및 TypeORM 호환 스키마 변환을 제공.
- **주요 export**: `CrudSchemaRegistry`(싱글톤 클래스 — `getInstance()`, `isSchemaApiEnabled()`, `autoRegisterAllModels()`, `registerSchema()`, `getAllSchemas()`/`getSchema()`/`getSchemasByDatabase()`, `hasSchema()`/`hasModelInAnyDatabase()`, `getRegisteredModelNames()`/`getSchemaCount()`, `getTypeOrmCompatibleSchema()`, `getAutoRegisteredSchemas()`/`getManualRegisteredSchemas()`, `getRelationshipManager()`, `clearAllSchemas()`/`debugRegisteredSchemas()`).
- **의존**: `@lib/devtools/schema-api/crudSchemaTypes`, `@lib/devtools/schema-api/prismaSchemaAnalyzer`, `@lib/devtools/schema-api/relationshipConfig`, `@ext/util`(`pluralize`, `createPaginationCursor`), `@ext/winston`(`log`).

### schemaApiRouter.ts
- **역할**: `/api/schema/*` GET 엔드포인트를 정의하는 Express 라우터. `developmentOnlyMiddleware` 로 활성화 게이트 + localhost 제한을 적용하고, 레지스트리에서 스키마 목록/상세/통계/헬스/도움말을 응답. 라우트: `/`, `/databases`, `/database/:databaseName`, `/database/:databaseName/:modelName`, `/:databaseName/:modelName`, `/auto-registered`, `/manual-registered`, `/meta/health`, `/meta/help`, `/meta/stats`.
- **주요 export**: `SchemaApiRouter`(클래스 — 생성자에서 라우트 셋업, `getRouter()` 로 Express `Router` 반환).
- **의존**: `express`, `@lib/devtools/schema-api/crudSchemaRegistry`, `@ext/util`(`createPaginationCursor`), `@ext/winston`(`log`), `@lib/http/errors/errorCodes`(`ERROR_CODES`).

### schemaApiSetup.ts
- **역할**: Express 앱에 `SchemaApiRouter` 를 마운트하는 헬퍼. 활성화 판정은 `CrudSchemaRegistry.isSchemaApiEnabled()` 에 위임하고, 중복 등록을 정적 플래그로 방지하며 등록 로그를 출력.
- **주요 export**: `SchemaApiSetup`(정적 클래스 — `registerSchemaApi(app, basePath='/api/schema')`, `isSchemaApiRegistered()`, `resetRegistrationState()`).
- **의존**: `express`(`Application`), `@lib/devtools/schema-api/schemaApiRouter`, `@lib/devtools/schema-api/crudSchemaRegistry`, `@ext/winston`(`log`).

## Import

캐논 import 경로는 `@lib/devtools/schema-api/<file>` 이다(단일 `@lib` 루트, 깊어진 경로). 폴더 내부 상호참조도 동일하게 작성한다(상대경로 금지).

**레이어링 방향**:
- **인바운드**: `src/core/Core.ts`(부트스트랩 시 `SchemaApiSetup.registerSchemaApi` + `CrudSchemaRegistry.autoRegisterAllModels`), CRUD 라우터(`PrismaSchemaAnalyzer` 로 모델 분석), `@lib/devtools/documentation/*`(`dmmfToOpenApi`/`jsonApiSchemas`/`syncSchemas` 가 `PrismaSchemaAnalyzer`·`crudSchemaTypes` 소비).
- **아웃바운드**: `@ext/util`, `@ext/winston`, `@lib/http/errors/errorCodes` 만 의존. **이 티어는 `documentation/` 티어에 의존하지 않는다(단방향 — documentation → schema-api).**
- **내부 의존 그래프**: `crudSchemaTypes`(타입 원천) ← `prismaSchemaAnalyzer`/`relationshipConfig` ← `crudSchemaRegistry` ← `schemaApiRouter` ← `schemaApiSetup`.
