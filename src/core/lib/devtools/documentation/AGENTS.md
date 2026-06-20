# documentation/ - OpenAPI 3.1 문서 자동 생성 (AUTO_DOCS)

등록된 라우트와 Prisma 모델로부터 OpenAPI 3.1.0 문서를 조립하고 Swagger UI / `openapi.json` / dev 정보 페이지를 제공하는 하위 티어. 전체가 `AUTO_DOCS=true` & `NODE_ENV !== 'production'` 게이트로 보호된다.

## Structure

```
documentation/
├── index.ts                  # 배럴 — 하위 모듈 re-export (documentationGenerator/staticFileMiddleware 제외)
├── openApiTypes.ts           # OpenAPI 3.1 부분 타입 정의 (전 모듈의 타입 원천)
├── pathConverter.ts          # Express 경로 → OpenAPI 경로 + 태그/operationId 파생
├── contentTypeRule.ts        # contentType 모드 → media type 키 (json / jsonapi)
├── infoSource.ts             # env + package.json → OpenAPI info 객체
├── serversSource.ts          # env(OPENAPI_SERVERS / HOST·PORT) → OpenAPI servers[]
├── schemaConverter.ts        # validator Schema/FieldSchema → OpenAPI schema
├── dmmfToOpenApi.ts          # Prisma 스칼라/enum 필드 → OpenAPI schema
├── jsonApiSchemas.ts         # Prisma 모델 → JSON:API resource/attributes/relationships/error schema
├── jsonApiHelpers.ts         # CRUD 라우트용 JSON:API request body/response schema
├── openApiBuilder.ts         # 전체 OpenApiDocument 조립 (라우트 → paths/components)
├── syncSchemas.ts            # analyzer → components.schemas 동기화 (DMMF 기반)
├── documentationGenerator.ts # 정적 레지스트리 + Swagger HTML + isDocumentationEnabled() 게이트
└── staticFileMiddleware.ts   # dev 문서 정적 에셋(css/js) 서빙 미들웨어
```

## Files

### index.ts
- **역할**: 하위 모듈을 한곳에서 re-export 하는 배럴.
- **export**: `openApiTypes`, `pathConverter`, `contentTypeRule`, `infoSource`, `serversSource`, `schemaConverter`, `dmmfToOpenApi`, `jsonApiSchemas`, `openApiBuilder`, `syncSchemas`, `jsonApiHelpers` 의 `export *`. (의도적으로 `documentationGenerator`/`staticFileMiddleware` 는 제외 — 순환 회피 및 직접 import 권장.)
- **의존**: 동일 티어 내부 파일들.

### openApiTypes.ts
- **역할**: 프레임워크가 생성·소비하는 OpenAPI 3.1.0 / JSON Schema 2020-12 부분 타입 정의. 티어 전체 타입의 단일 원천.
- **주요 export**: `OpenApiSchema`, `OpenApiRef`, `OpenApiSchemaOrRef`, `OpenApiObjectSchema`, `OpenApiInfo`, `OpenApiServer`, `OpenApiParameter`, `OpenApiMediaTypeObject`, `OpenApiRequestBody`, `OpenApiResponse`, `OpenApiOperation`, `OpenApiPathItem`, `OpenApiComponents`, `OpenApiTag`, `OpenApiDocument`, `OpenApiPrimitiveType`, `ContentTypeMode`.
- **의존**: 없음(순수 타입).

### pathConverter.ts
- **역할**: Express 라우터 경로를 OpenAPI 경로(`:foo` → `{foo}`)로 변환하고, 경로에서 Swagger 그룹 태그와 안정적 `operationId` 를 파생. 정규식 파라미터의 캡처그룹을 정규화로 제거.
- **주요 export**: `PathConversionResult`(인터페이스), `toOpenApiPath()`, `deriveResourceTag()`, `deriveOperationId()`.
- **의존**: 없음(순수 함수).

### contentTypeRule.ts
- **역할**: `ContentTypeMode`('json' | 'jsonapi')를 실제 media type 문자열로 결정.
- **주요 export**: `mediaTypeFor(mode)` → `'application/json'` 또는 `'application/vnd.api+json'`.
- **의존**: `@lib/devtools/documentation/openApiTypes`(`ContentTypeMode`), `@lib/crud/jsonApiConstants`(`JSON_API_CONTENT_TYPE`).

### infoSource.ts
- **역할**: OpenAPI `info` 객체 빌드. 우선순위 env(`OPENAPI_TITLE`/`OPENAPI_VERSION`/`OPENAPI_DESC`) > package.json > 하드코딩 fallback(`kusto-api`/`0.0.0`).
- **주요 export**: `buildInfo(packageJson, env)` → `OpenApiInfo`.
- **의존**: `@lib/devtools/documentation/openApiTypes`(`OpenApiInfo`).

### serversSource.ts
- **역할**: OpenAPI `servers[]` 빌드. `OPENAPI_SERVERS`(JSON 배열) 유효 시 사용, 아니면 `HOST`/`PORT` 기반 단일 서버 fallback. 무효 항목은 경고 로깅 후 스킵.
- **주요 export**: `buildServers(env)` → `OpenApiServer[]`.
- **의존**: `@lib/devtools/documentation/openApiTypes`(`OpenApiServer`), `@ext/winston`(`log`).

### schemaConverter.ts
- **역할**: `@lib/http/validation/validator` 의 `FieldSchema`/`Schema`(validated 라우트의 요청/응답 스키마)를 OpenAPI 3.1 schema 로 변환. 알 수 없는 타입은 fail-fast(throw).
- **주요 export**: `fieldToOpenApi(field)`, `schemaToOpenApi(schema)`.
- **의존**: `@lib/http/validation/validator`(`FieldSchema`, `Schema`, `ValidatorType`), `@lib/devtools/documentation/openApiTypes`.

### dmmfToOpenApi.ts
- **역할**: Prisma 스칼라 타입/enum 을 OpenAPI primitive type+format 으로 매핑. optional 은 type union(`T | null`), list 는 array wrapper. enum 필드는 `$ref` 로.
- **주요 export**: `fieldToSchema(field, enumValuesByName)`, `enumToOpenApi(name, values)`.
- **의존**: `@lib/devtools/schema-api/crudSchemaTypes`(`PrismaFieldMetadata`), `@lib/devtools/documentation/openApiTypes`, `@ext/winston`(`log`). **(하위 티어 schema-api 에 의존)**

### jsonApiSchemas.ts
- **역할**: Prisma 모델 메타데이터를 JSON:API resource object 구성요소(attributes / relationships / resource / error)의 OpenAPI schema 로 변환. id·관계·PK 필드를 attributes 에서 제외.
- **주요 export**: `jsonApiAttributes(model, enumValuesByName)`, `jsonApiRelationships(model)`, `jsonApiResource(model, enumValuesByName)`, `jsonApiErrorObject()`.
- **의존**: `@lib/devtools/schema-api/crudSchemaTypes`(`PrismaModelInfo`), `@lib/devtools/documentation/openApiTypes`, `@lib/devtools/documentation/dmmfToOpenApi`(`fieldToSchema`). **(하위 티어 schema-api 에 의존)**

### jsonApiHelpers.ts
- **역할**: CRUD 라우트가 등록하는 JSON:API request body / 단일·컬렉션 응답 / 에러 응답 schema 생성. attributes·relationships 는 `syncSchemas` 가 미리 등록한 컴포넌트로 `$ref`.
- **주요 export**: `jsonApiBody(modelName, op)`('create'|'update'), `jsonApiResponse(modelName, statusCode)`, `jsonApiErrorResponse(statusCode)`, `jsonApiCollectionResponse(modelName)`.
- **의존**: `@lib/devtools/documentation/openApiTypes`(`OpenApiObjectSchema`).

### openApiBuilder.ts
- **역할**: 등록된 라우트 배열 + components schemas → 완성된 `OpenApiDocument` 조립. paths/operations 빌드, 파라미터/requestBody/responses 변환, 입력이 이미 OpenAPI 형태인지 validator Schema 인지 감지, operationId 유일성 보장(중복 시 `_2`/`_3` suffix), 문서 레벨 tags[] 구성.
- **주요 export**: `RouteDocumentationLike`(인터페이스), `BuildOpenApiInput`(인터페이스), `buildOpenApiDocument(input)`.
- **의존**: `@lib/http/validation/validator`(`Schema`), `@lib/devtools/documentation/openApiTypes`, `schemaConverter`, `infoSource`(`buildInfo`), `serversSource`(`buildServers`), `pathConverter`(`toOpenApiPath`/`deriveResourceTag`/`deriveOperationId`), `contentTypeRule`(`mediaTypeFor`).

### syncSchemas.ts
- **역할**: `PrismaSchemaAnalyzer` 1개의 전체 모델 → 각 모델의 JSON:API 3변형(resource/attributes/relationships) + enum schema 들을 `DocumentationGenerator.registerSchema` 로 components.schemas 에 등록. 공통 `JsonApiError` 스키마 등록. 게이트 off 시 즉시 return.
- **주요 export**: `syncSchemasFromAnalyzer(analyzer, databaseName)`, `registerJsonApiErrorSchema()`.
- **의존**: `@lib/devtools/schema-api/prismaSchemaAnalyzer`, `@lib/devtools/schema-api/crudSchemaTypes`(`PrismaModelInfo`), `documentationGenerator`(`DocumentationGenerator`/`isDocumentationEnabled`), `jsonApiSchemas`, `dmmfToOpenApi`(`enumToOpenApi`), `@ext/winston`(`log`). **(schema-api 와 documentationGenerator 둘 다 연결하는 동기화 지점)**

### documentationGenerator.ts
- **역할**: 라우트·스키마·태그설명을 모으는 정적 레지스트리이자 문서 산출물 생성기. `isDocumentationEnabled()` 단일 캐논 게이트를 보유하고, Swagger UI 5.x HTML 셸과 dev 정보 페이지 HTML 을 렌더. 게이트 off 시 모든 register/generate 가 no-op.
- **주요 export**: `DocumentationGenerator`(정적 클래스 — `registerRoute`/`registerTag`/`registerSchema`/`updateRoutePaths`/`generateOpenAPISpec`/`generateHTMLDocumentation`/`generateDevInfoPage`/`getRoutes`/`reset` 등), `isDocumentationEnabled()`, `RouteDocumentation`(인터페이스), `ApiDocumentation`(= `OpenApiDocument` alias).
- **의존**: `@lib/http/validation/requestHandler`(`ResponseConfig`), `@ext/winston`(`log`), `@lib/devtools/documentation`(배럴 — `buildOpenApiDocument`/타입들). `package.json` 을 동적 require.

### staticFileMiddleware.ts
- **역할**: dev 문서용 정적 에셋(`.css`/`.js`)을 `static/` 디렉터리에서 서빙하는 Express 미들웨어. `AUTO_DOCS=true` & non-production 일 때만 동작, 그 외 요청은 `next()` 통과.
- **주요 export**: `StaticFileMiddleware`(정적 클래스 — `serveStaticFiles()` 미들웨어 팩토리, `getAvailableFiles()`, `fileExists()`).
- **의존**: `express`, `path`, `fs`, `@ext/winston`(`log`). (배럴 미포함 — 직접 import.)

## Import

캐논 import 경로는 `@lib/devtools/documentation/<file>` 이다(단일 `@lib` 루트, 깊어진 경로). 일반 소비처는 배럴 `@lib/devtools/documentation` 에서 가져오되, `documentationGenerator`/`staticFileMiddleware` 는 파일 경로로 직접 import 한다.

**레이어링 방향**:
- **인바운드**: `src/core/Core.ts`(문서 라우트 등록·모델 동기화), `ExpressRouter`(라우트 등록 시 `DocumentationGenerator.registerRoute`/`registerTag`), CRUD 라우터(JSON:API body/response 헬퍼 사용).
- **아웃바운드**: `@lib/devtools/schema-api/*`(DMMF 분석·모델 타입 — `dmmfToOpenApi`/`jsonApiSchemas`/`syncSchemas`), `@lib/http/validation/*`(validator·requestHandler), `@lib/crud/jsonApiConstants`, `@ext/winston`. **이 티어는 schema-api 에 의존하지만 schema-api 는 이 티어에 의존하지 않는다.**
