# Documentation System Enhancement — Design Spec

- **Spec ID**: A
- **Date**: 2026-05-04
- **Branch**: ver/0.1.47
- **Status**: Awaiting user review
- **Related**: Spec B (Jest 코어 회귀 테스트) — TC #21 가 본 spec 이 만드는 코드를 표적으로 함. Phase 3 는 본 spec 구현 완료 후 진행.

## 1. 목적

Express.js-Kusto 프레임워크의 자동 API 문서 시스템 (`/docs`, `/docs/openapi.json`, `/docs/dev`) 을 **dev 도구 수준에서 실무용 (배포 가능, 외부 도구 호환, 다중 환경) 수준으로 강화**.

본 spec 의 4가지 가치:

1. **정확성 (A)** — 생성되는 OpenAPI 가 실제 라우트의 동작과 일치. JSON:API content-type, path 파라미터 표기, 5xx 응답을 spec 표준에 맞게 반영.
2. **통합 (B)** — Prisma DMMF 가 SSOT. CRUD 라우트는 `components.schemas` 의 `$ref` 로 모델 재사용. 인라인 스키마 중복 제거.
3. **운영 (C)** — `info` / `servers` 가 환경별로 주입 가능. 빌드 시 정적 `openapi.json` export. `/docs/dev` 에 IP 가드.
4. **테스트 가능성 (D, 부분)** — 새로 추가하는 변환 함수는 export pure functions 로 만들어 단위 테스트 가능. 기존 `DocumentationGenerator` 정적 API 는 backward compat 유지.

본 spec **에 포함되지 않는 것** (12절 deferrals 참조): 정적 클래스 → 인스턴스 리팩터, NOTFOUND/proxy/multipart 라우트의 docs, Swagger UI self-host, Redoc/Postman/yaml export, 모델 단위 tags 정밀화.

## 2. 컨텍스트 — 현재 상태 감사

본 spec 작성 시점의 documentation 시스템 완성도:

| 영역 | % | 핵심 사실 |
|---|---|---|
| A 정확성 | ~50% | GET 쿼리 파라미터 등록 OK / POST·PUT·DELETE 응답 코드 일부 등록 / **Content-Type 이 `application/json` 으로 잘못 표기** (실제는 `application/vnd.api+json`) / **Path 파라미터 변환 없음** (`:id` 그대로, OpenAPI 표준은 `{id}`) / file·binary·buffer FieldSchema 미처리 / 5xx 응답 미등록 |
| B 통합 | **0%** | `DocumentationGenerator.schemas` 필드는 선언만, 채우는 코드 없음 / `CrudSchemaRegistry` ↔ `DocumentationGenerator` 사이 import·호출 0건 / `$ref` 사용 0건 |
| C 운영 | ~30% | Production 게이트 동작 / `servers` 배열은 `http://localhost:${PORT}` 하드코딩 / `info.title/version/description` 하드코딩 / build-time export 없음 / `/docs/dev` IP·auth 가드 없음 |
| D 테스트성 | ~20% | `reset()` 헬퍼 / 단위 테스트 0개 / private 메서드 외부 접근 불가 |

가장 치명적인 갭: **OpenAPI 표준 위반 2건 (Content-Type, Path param)** — 외부 도구 (Postman, Insomnia, codegen) 가 spec 을 못 읽음. 본 spec 의 단계 M2 가 이 두 가지를 가장 먼저 수정.

## 3. 설계 원칙

### 3.1 Single Source of Truth

- **SSOT 1단계**: `prisma/schema.prisma` (각 DB 별).
- **SSOT 2단계 (런타임)**: `PrismaSchemaAnalyzer.getModel()` 의 정규화 출력 — 이미 존재.
- Documentation 시스템은 이 위에 얹히는 **변환 layer** 만 추가. 자체 모델 캐시 없음. CRUD 도, /docs 도, /api/schema 도 동일한 SSOT 를 읽음.

### 3.2 외부 라이브러리 추가 0

- 변환 (FieldSchema, Prisma model, JSON:API resource) 모두 자체 구현. `validator.ts` 의 Schema, `prismaSchemaAnalyzer.ts` 의 model 둘 다 우리 소유 → 자체 변환기가 컨트롤·테스트성에서 유리.
- 단 하나 예외: `@apidevtools/swagger-parser` 를 **devDependency** 로 추가. OpenAPI 표준 검증의 사실상 표준 라이브러리. 통합 테스트가 spec 거짓말을 잡아낼 수 있게 함.

### 3.3 OpenAPI 3.1 타깃

- 현재 `'3.0.0'` 하드코딩 → `'3.1.0'` 으로 업그레이드.
- 이유: JSON Schema 2020-12 정렬, `nullable` 처리 정확 (`type: ['T', 'null']` union), `examples` 표현 정확, 2026 시점의 정석 타깃. Swagger UI 5.x 가 지원.

### 3.4 레이어 분리

```
변환 layer (pure)  →  등록 layer (side-effect)  →  빌드 layer (aggregation)  →  라우트 layer (I/O)
```

각 layer 가 한 책임만. 변환은 모두 export 된 pure function — 입력만 받아 출력 반환, 정적 상태 무참조. 등록·빌드만 `DocumentationGenerator` 의 정적 상태에 닿음.

### 3.5 호환성 우선

- 기존 `DocumentationGenerator` 정적 API 시그니처 유지.
- 기존 28+ `registerDocumentation` 호출 site 의 시그니처 변경 없음. 신규 헬퍼 (`jsonApiBody`/`jsonApiResponse`/`jsonApiErrorResponse`) 가 inline 객체를 점진 치환.
- 사용자 라우트 (`route.ts` 의 `.GET`/`.POST_VALIDATED` 등) 변경 없음.

## 4. 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│ SSOT: PrismaSchemaAnalyzer (정규화 model, 변경 없음)        │
│                            ▲                                 │
│  ┌─────────────────────────┴──────────┐                     │
│ CrudSchemaRegistry (기존)        DocumentationSchemaSync    │
│  → /api/schema (변경 X)            → init-time push (NEW)   │
│                                       │                      │
│                                       ▼                      │
│                          DocumentationGenerator              │
│                          (기존 정적 클래스, 내부 분할)      │
│                          ├ openApiBuilder    (NEW)          │
│                          ├ schemaConverter   (NEW)          │
│                          ├ dmmfToOpenApi     (NEW)          │
│                          ├ jsonApiSchemas    (NEW)          │
│                          ├ pathConverter     (NEW)          │
│                          ├ contentTypeRule   (NEW)          │
│                          ├ infoSource        (NEW)          │
│                          └ serversSource     (NEW)          │
│                                       │                      │
│                          ┌────────────┴───────────┐         │
│                          ▼                        ▼         │
│                     /docs 라우트              docs:export   │
│                     (Core.ts, dev 가드)       (NEW script)  │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 디렉토리 (NEW 만)

```
src/core/lib/documentation/
├── openApiBuilder.ts        # generateOpenAPISpec 본체
├── schemaConverter.ts       # validator.ts FieldSchema → OpenAPI 3.1
├── dmmfToOpenApi.ts         # PrismaSchemaAnalyzer model → components.schemas
├── jsonApiSchemas.ts        # JSON:API 3변형
├── pathConverter.ts         # :foo → {foo}
├── contentTypeRule.ts       # CRUD vs non-CRUD content-type
├── infoSource.ts            # info from package.json + env
├── serversSource.ts         # servers from env
└── index.ts                 # barrel

src/core/lib/middleware/devDocsIpGuard.ts        # /docs/dev IP 가드
src/core/initSteps/syncDocumentationSchemas.ts   # init-time push helper
scripts/exportOpenApi.ts                         # docs:export 명령
```

### 4.2 기존 파일 영향

| 파일 | 변경 |
|---|---|
| `src/core/Core.ts` | `setupDocumentationRoutes` 에 `devDocsIpGuard` 추가 / `initialize()` 에 `syncDocumentationSchemas` 호출 추가 |
| `src/core/lib/documentationGenerator.ts` | 내부 코드 → `documentation/` 모듈 호출. Public API 유지 + `registerSchema(name, schema)` 신규 추가. `openapi: '3.1.0'` |
| `src/core/lib/expressRouter.ts` | `jsonApiBody/Response/ErrorResponse` 헬퍼 추가, CRUD 호출 site 점진 치환 |
| `src/core/lib/loadRoutes_V6_Clean.ts` | `dryRun: true` 옵션 추가 (Express app 마운트 skip) |
| `src/core/lib/prismaManager.ts` | `initialize({ skipConnect: true })` 옵션 추가 |
| `package.json` | `docs:export` script 추가, `build` 마지막 단계에서 호출. `@apidevtools/swagger-parser` devDep |
| `webpack.config.js` | CopyWebpackPlugin patterns 에 `package.json` 추가 (없는 경우) |
| `.env.template` | `OPENAPI_TITLE/VERSION/DESC/SERVERS`, `DOCS_DEV_ALLOWED_IPS` 5개 추가 |

## 5. Components

### 5.1 변환 layer (pure functions)

#### `documentation/schemaConverter.ts`

`validator.ts` 의 `FieldSchema` / `Schema` → OpenAPI 3.1 schema. **모든 type variant** 처리 (현재 누락된 `file`/`binary`/`buffer` 포함).

```ts
export function fieldToOpenApi(field: FieldSchema): OpenApiSchema;
export function schemaToOpenApi(schema: Schema): OpenApiObjectSchema;
```

내부 동작:
- type/format/min·max/enum/pattern/required 정규화.
- nullable → `type: ['T', 'null']` (3.1 union).
- `file`/`binary`/`buffer` → `{ type: 'string', format: 'binary' }`.
- 알 수 없는 type variant → throw `Error('Unknown FieldSchema type: ...')` (fail-fast).

의존: validator 타입만.

#### `documentation/dmmfToOpenApi.ts`

`PrismaSchemaAnalyzer` 의 정규화 model → OpenAPI components.schemas. Relations 는 `$ref`. Enum 은 별 schema 로 분리.

```ts
export function modelToOpenApi(model: PrismaModelInfo, enumValuesByName: Map<string, string[]>): OpenApiObjectSchema;
export function enumToOpenApi(name: string, values: string[]): OpenApiSchema;
export function buildAllSchemas(analyzer: PrismaSchemaAnalyzer): {
  models: Record<string, OpenApiObjectSchema>;
  enums: Record<string, OpenApiSchema>;
};
```

의존: `prismaSchemaAnalyzer.ts` (read-only), `schemaConverter.ts` (Prisma scalar 매핑 일부 공유).

#### `documentation/jsonApiSchemas.ts`

1 model → JSON:API 3변형:
- `{Model}` — JSON:API resource object (id/type/attributes/relationships).
- `{Model}Attributes` — id 와 관계 필드 제외한 attributes.
- `{Model}Relationships` — 관계 필드만, JSON:API resource identifier 형식.

```ts
export function jsonApiResource(modelName: string, ...): OpenApiSchema;
export function jsonApiAttributes(modelName: string, ...): OpenApiSchema;
export function jsonApiRelationships(modelName: string, ...): OpenApiSchema;
export function jsonApiErrorObject(): OpenApiSchema;  // 공용 errors[] 스키마
```

의존: `dmmfToOpenApi.ts`.

#### `documentation/pathConverter.ts`

Express path → OpenAPI path. Path parameter 메타데이터도 함께 추출.

```ts
export function toOpenApiPath(expressPath: string): {
  path: string;
  parameters: Array<{ name: string; pattern?: string; isWildcard?: boolean }>;
};
```

규칙:
- `:foo` → `{foo}`.
- `:^slug` (regex param) → `{slug}` + `parameters[].pattern` 에 원본 패턴 보존.
- `..[^path]` (wildcard) → `{path}` + `isWildcard: true`.

의존: 없음.

#### `documentation/contentTypeRule.ts`

라우트가 JSON:API 인지 plain JSON 인지 결정. `RouteDocumentation` 에 `contentType?: 'json' | 'jsonapi'` 옵셔널 필드 추가 (기본 `'json'`).

```ts
export type ContentTypeMode = 'json' | 'jsonapi';
export function mediaTypeFor(mode: ContentTypeMode): string;
// 'json' → 'application/json', 'jsonapi' → 'application/vnd.api+json'
```

#### `documentation/infoSource.ts`

OpenAPI `info` 객체 빌드. 우선순위: env (`OPENAPI_TITLE` / `OPENAPI_VERSION` / `OPENAPI_DESC`) > `package.json` (`name` / `version` / `description`) > 하드코딩 fallback.

```ts
export function buildInfo(packageJson: { name?: string; version?: string; description?: string }, env: NodeJS.ProcessEnv): OpenApiInfo;
```

#### `documentation/serversSource.ts`

OpenAPI `servers` 배열 빌드. `OPENAPI_SERVERS` (JSON 배열) 우선, 없으면 `[{ url: 'http://${HOST}:${PORT}', description: 'Local' }]`. 잘못된 JSON → `log.Warn` + fallback.

```ts
export function buildServers(env: NodeJS.ProcessEnv): OpenApiServer[];
```

### 5.2 빌드 / 등록 layer

#### `documentation/openApiBuilder.ts`

모든 layer 의 결과를 모아 최종 OpenAPI 3.1 document 빌드. `DocumentationGenerator.routes[]` + `DocumentationGenerator.schemas` 를 입력으로.

```ts
export function buildOpenApiDocument(input: {
  routes: RouteDocumentation[];
  schemas: Record<string, OpenApiSchema>;
  env: NodeJS.ProcessEnv;
  packageJson: { name?: string; version?: string; description?: string };
}): ApiDocumentation;
```

이 함수가 **단위 테스트의 핵심 표적** (Spec B Phase 3 TC #21).

특수 처리:
- `routes[]` 안의 inline `Schema` 와 `{ $ref: '#/...' }` 가 섞여 있으면 둘 다 처리.
- `routes[]` 의 `$ref` 가 `components.schemas` 에 dangling → throw `Error('Dangling $ref: ...')`.
- 같은 path + method 중복 등록 → `log.Warn` + last-write-wins (기존 동작 유지).

#### `documentationGenerator.ts` (기존 — refactor)

정적 클래스. `routes[]` + `schemas{}` 보관, public static API 유지.

변경:
- 내부 변환 메서드 제거 → `documentation/` 모듈 호출.
- 신규: `static registerSchema(name: string, schema: OpenApiSchema): void` (init-time push 진입점).
- 기존 메서드 (`registerRoute`, `updateRoutePaths`, `getRouteCount`, `generateOpenAPISpec`, `generateHTMLDocumentation`, `generateDevInfoPage`, `reset`, `getRoutes`) 시그니처 유지.
- `openapi: '3.0.0'` → `'3.1.0'`.

#### `initSteps/syncDocumentationSchemas.ts`

Core.initialize 에서 PrismaManager 가 모든 DB 의 DMMF 를 로드한 직후 호출.

```ts
export async function syncDocumentationSchemas(prismaManager: PrismaManager): Promise<void>;
```

동작:
- `AUTO_DOCS!=='true' || NODE_ENV==='production'` → 즉시 return.
- 모든 DB 의 analyzer 순회 → `buildAllSchemas` → 각 model 에 대해 3변형 + enum 등록.
- `DocumentationGenerator.registerSchema('JsonApiError', jsonApiErrorObject())`.
- Cross-DB 충돌 시 둘째부터 `${dbName}__${modelName}` 키로 fallback + warn.

### 5.3 운영 layer

#### `middleware/devDocsIpGuard.ts`

`/docs/dev` 전용 미들웨어. `DOCS_DEV_ALLOWED_IPS` (CSV, 기본 `127.0.0.1,::1`) 매치 안 되면 **404** 응답 (존재 자체 숨김). CIDR 단순 처리.

```ts
export function devDocsIpGuard(): RequestHandler;
```

의존: `req.ip` (이미 `clientIpMiddleware` 가 정규화 중).

#### `scripts/exportOpenApi.ts`

ts-node 단독 실행. 최소한의 framework 부팅 (Express 인스턴스화 X) → `buildOpenApiDocument` → `dist/openapi.json` 작성.

```bash
# CLI
node -r ts-node/register scripts/exportOpenApi.ts [--out path]

# package.json
"docs:export": "ts-node ...",
"build": "... && npm run docs:export -- --out dist/openapi.json"
```

### 5.4 expressRouter.ts 헬퍼 (신규)

CRUD 호출 site 점진 치환에 사용:

```ts
private static jsonApiBody(modelName: string, op: 'create' | 'update'): RequestConfig['body'];
private static jsonApiResponse(modelName: string, status: number): ResponseConfig[number];
private static jsonApiErrorResponse(status: number): ResponseConfig[number];
```

**Cross-DB 충돌 처리**: 위 시그니처는 단일 DB 만 다룸. 충돌이 있으면 dotted 표기로 확장 (`'default.User'`) — implementation plan 에서 확정.

## 6. Data flow

### 6.1 Init-time

```
Application.start() → Core.initialize()
  1. PrismaManager.initialize()         ─ 모든 DB DMMF 로드 + Analyzer 인스턴스화
  2. RepositoryManager.initialize()
  3. DependencyInjector.initialize()
  4. setupMiddleware()
 *5. syncDocumentationSchemas(prismaManager)     ─ NEW
       ├─ AUTO_DOCS!=='true' || NODE_ENV==='production' → return
       ├─ for each db in prismaManager.getAllAnalyzers():
       │    └─ buildAllSchemas(analyzer) → { models, enums }
       │       └─ for each model: 3변형 + enum 등록
       ├─ DocumentationGenerator.registerSchema('JsonApiError', ...)
       └─ log.Info: "Documentation schemas synced: {n} models, {m} enums"
  6. loadRoutes(...)                    ─ 각 route.ts → registerDocumentation 누적
  7. setupDocumentationRoutes()         ─ /docs/* 마운트 (AUTO_DOCS && !production 시)
```

**키 포인트**:
- 단계 5 (스키마 sync) **반드시** 단계 6 (라우트 로드) 보다 앞.
- 단계 5 는 dev 모드에서만 동작. prod 영향 0.

### 6.2 Request-time `/docs/openapi.json`

```
GET /docs/openapi.json
  └─ Core.ts handler
       └─ DocumentationGenerator.generateOpenAPISpec()
            └─ buildOpenApiDocument({ routes, schemas, env, packageJson })
                 1. buildInfo(packageJson, env)
                 2. buildServers(env)
                 3. for each route in routes:
                      ├─ toOpenApiPath(route.path)
                      ├─ mediaTypeFor(route.contentType)
                      ├─ schemaToOpenApi → requestBody / responses (or pass-through $ref)
                      └─ paths[opPath][method] = operation
                 4. components.schemas = this.schemas
                 5. return { openapi: '3.1.0', info, servers, paths, components }
       └─ res.json(spec)
```

매 요청마다 build. dev 전용이라 비용 미미. routes[] 가 부팅 후 immutable 이라 결정적.

### 6.3 Request-time `/docs` 와 `/docs/dev`

- `/docs`: Swagger UI 5.x bootstrap HTML 반환 (변경 없음). 클라이언트가 `/docs/openapi.json` fetch.
- `/docs/dev`: `devDocsIpGuard()` 미들웨어 prepend → 매치 시만 `generateDevInfoPage()` 도달.

### 6.4 Build-time `docs:export`

```
npm run docs:export
  └─ ts-node scripts/exportOpenApi.ts
       1. process.env.AUTO_DOCS = 'true', NODE_ENV = NODE_ENV || 'development'
       2. PrismaManager.initialize({ skipConnect: true })
       3. syncDocumentationSchemas(prismaManager)
       4. loadRoutes(routesPath, { dryRun: true })       ─ Express app 마운트 X
       5. const spec = buildOpenApiDocument({...})
       6. fs.writeFileSync(outPath, JSON.stringify(spec, null, 2))
       7. log.Info: "OpenAPI spec written to {outPath}"

npm run build  (마지막 단계로 자동 호출)
  └─ ... (기존 webpack)
  └─ npm run docs:export -- --out dist/openapi.json
```

**옵션 추가 필요**:
- `loadRoutes({ dryRun: true })` — Express app 마운트 skip, `router.<verb>(...)` 호출만.
- `PrismaManager.initialize({ skipConnect: true })` — Prisma client 생성 시 `$connect()` skip.

### 6.5 CRUD 라우트 등록 흐름 (한 모델 기준)

```
expressRouter.CRUD('default', 'User', { primaryKey: 'id' })
  ├─ setupIndexRoute    → registerDocumentation('GET', '/', { ..., contentType: 'jsonapi' })
  │                          └─ responses.200 = { data: { type: 'array', items: { $ref: '#/components/schemas/User' } } }
  ├─ setupShowRoute     → registerDocumentation('GET', '/:id', { ..., contentType: 'jsonapi' })
  │                          └─ responses.200 = jsonApiResponse('User', 200)
  ├─ setupCreateRoute   → registerDocumentation('POST', '/', { ..., contentType: 'jsonapi' })
  │                          ├─ parameters.body = jsonApiBody('User', 'create')
  │                          └─ responses = { 201: jsonApiResponse('User', 201), 422: jsonApiErrorResponse(422), 500: jsonApiErrorResponse(500) }
  ├─ setupUpdateRoute   → registerDocumentation('PUT'|'PATCH', '/:id', { ..., contentType: 'jsonapi' })
  ├─ setupDestroyRoute  → registerDocumentation('DELETE', '/:id', { ..., contentType: 'jsonapi' })
  └─ setupRecoverRoute  → registerDocumentation('POST', '/:id/recover', { ..., contentType: 'jsonapi' })
```

`syncDocumentationSchemas` 가 부팅 단계 5 에서 이미 `User` / `UserAttributes` / `UserRelationships` / `JsonApiError` 등록 → `$ref` dangling 없음.

## 7. Error handling

CLAUDE.md 원칙 준수: internal code 신뢰, 시스템 경계에서만 검증.

### 7.1 외부 입력 — env 파싱

| Env | 잘못된 값 시 | 로그 |
|---|---|---|
| `OPENAPI_SERVERS` | JSON 파싱 실패 / 배열 아님 / `url` 키 없음 → fallback (`http://${HOST}:${PORT}`) | `log.Warn` |
| `OPENAPI_TITLE/VERSION/DESC` | 빈 문자열 → package.json fallback | (Debug only) |
| `DOCS_DEV_ALLOWED_IPS` | CSV 파싱 실패 / 잘못된 CIDR → 항목별 무시. 전부 무효 → 기본값 (`127.0.0.1,::1`) | `log.Warn` |
| `AUTO_DOCS` | `'true'` 외 모두 비활성 (현재 동작 유지) | — |

env 파싱 실패는 throw 안 함.

### 7.2 시스템 I/O

#### package.json 읽기 (`infoSource.ts`)
- `require('package.json')` 캐시. webpack 빌드 후 `dist/package.json` 가 copy 돼 있어야 함 → CopyWebpackPlugin 에 `package.json` 추가.
- 누락 시: 하드코딩 fallback `{ name: 'kusto-api', version: '0.0.0', description: '' }` + `log.Warn`.

#### docs:export 파일 쓰기 (`scripts/exportOpenApi.ts`)
- 부모 디렉토리 없으면 `fs.mkdirSync(dir, { recursive: true })`.
- 쓰기 실패 → 에러 throw → `process.exit(1)` + `log.Error`. 빌드 파이프라인이 인지해야 함.

### 7.3 변환 layer 내부 — 명시적 보증

- `schemaConverter`: 알 수 없는 `FieldSchema.type` → throw `Error('Unknown FieldSchema type: ...')`. Fail-fast.
- `dmmfToOpenApi`: 빈 fields → `log.Warn` + 빈 object schema. Cross-DB 충돌 → 둘째부터 `${dbName}__${modelName}` + warn. 빈 enum → warn + skip.
- `openApiBuilder`: dangling `$ref` → throw `Error('Dangling $ref: ...')`. Fail-fast. Path 충돌 → warn + last-write-wins.

### 7.4 Request-time `/docs/*` 핸들러

```ts
this._app.get('/docs/openapi.json', (req, res) => {
    try {
        const spec = DocumentationGenerator.generateOpenAPISpec();
        res.json(spec);
    } catch (error) {
        log.Error('Failed to generate OpenAPI spec', { error });
        res.status(500).json({
            errors: [{
                status: '500',
                code: 'OPENAPI_BUILD_FAILED',
                title: 'Failed to generate OpenAPI specification',
                detail: process.env.NODE_ENV === 'development' ? String(error) : undefined,
            }],
        });
    }
});
```

응답 형식은 JSON:API errors. `errorFormatter.formatJsonApiError` 사용 가능하면 재사용.

### 7.5 `/docs/dev` IP 가드

- `req.ip` falsy → 404.
- CIDR 매치 실패 → 404 (정보 노출 방지).
- 매치 자체에서 throw → 404 + `log.Error`. fail-closed.
- 매치 성공 → next().

**404 선택 이유**: 401/403 은 "여기에 뭔가 있다" 누설.

### 7.6 OpenAPI spec 자체의 에러 응답 (CRUD)

`jsonApiErrorResponse(status)` 가 등록할 응답 본문 schema:

```yaml
content:
  application/vnd.api+json:
    schema:
      $ref: '#/components/schemas/JsonApiError'
```

`JsonApiError` schema (init-time push 단계 5 에서 등록):

```yaml
type: object
required: [errors]
properties:
  errors:
    type: array
    items:
      type: object
      required: [status, code, title]
      properties:
        id: { type: string }
        status: { type: string }
        code: { type: string }
        title: { type: string }
        detail: { type: string }
        source:
          type: object
          properties:
            pointer: { type: string }
            parameter: { type: string }
            header: { type: string }
        meta: { type: object }
```

CRUD 메서드에서 등록할 표준 응답 코드:
- 모든 CRUD: 5xx (`500`).
- POST/PUT/PATCH: 400, 422.
- /:id 가 있는 verb: 404.
- DELETE: 204 + 404 + 410 (soft-deleted).
- POST recover: 200 + 404 + 410.
- index: 400 (페이지네이션 누락).

각 코드는 같은 `JsonApiError` ref 사용.

## 8. Testing

### 8.1 책임 분리 (Spec A vs Phase 3)

본 spec 은 **Spec A 자체가 ship 가능하다는 최소한의 sanity 보장**까지만 포함. 망라적 회귀 보호는 Phase 3 (Spec B Tier 3) 의 책임.

| 범위 | Spec A 가 ship | Phase 3 가 추가 |
|---|---|---|
| `schemaConverter` 모든 type variant | smoke (string/number/array/file 1개씩) | 망라 (TC #21 일부) |
| `dmmfToOpenApi` model→schema | smoke (1 model) | 망라 (TC #21 일부) |
| `jsonApiSchemas` 3변형 | smoke (1 model) | 망라 |
| `pathConverter` :→{} | smoke (3 케이스) | regex/wildcard 망라 |
| `openApiBuilder` end-to-end build | smoke (routes 0개 + 1개) | 다양한 시나리오 |
| `syncDocumentationSchemas` | smoke (모킹 PrismaManager) | cross-DB 충돌 등 엣지 |
| `/docs/*` HTTP | smoke (200/404) | dev 가드 매트릭스 (TC #22 인접) |
| `docs:export` | smoke (실행하면 dist/openapi.json 생성) | spec validation, CI diff |
| `devDocsIpGuard` | smoke (allow/deny) | CIDR 엣지 |

명시적 채무: Spec A ship 시 회귀 안전망은 미완. Phase 3 까지 가야 완성.

### 8.2 신규 테스트 파일 (Spec A 범위)

기존 인프라 (`jest.config.ts`, `tests/_setup`, `tests/integration/_shared/test-app.ts`) 그대로 재사용. 미러 구조:

```
tests/unit/documentation/
├── schemaConverter.test.ts       # smoke: string, number, array, file
├── dmmfToOpenApi.test.ts         # smoke: 1 model + 1 enum
├── jsonApiSchemas.test.ts        # smoke: 3변형
├── pathConverter.test.ts         # smoke: :id→{id}, regex, wildcard
├── infoSource.test.ts            # smoke: env override, package.json fallback
├── serversSource.test.ts         # smoke: OPENAPI_SERVERS JSON, fallback, malformed
└── openApiBuilder.test.ts        # smoke: empty, 1 route, $ref 통합

tests/unit/middleware/
└── devDocsIpGuard.test.ts        # smoke: 127.0.0.1 통과, 외부 IP 404, malformed CIDR

tests/integration/documentation/
├── docs-routes.test.ts           # GET /docs/openapi.json 200, /docs HTML 200, /docs/dev 404
├── sync-schemas.test.ts          # syncDocumentationSchemas 후 components.schemas 채워짐
└── crud-jsonapi-spec.test.ts     # CRUD 1 model + spec 의 paths/responses 가 application/vnd.api+json + swagger-parser validate

tests/cli/
└── exportOpenApi.test.ts         # docs:export 실행 → dist/openapi.json 생성 + JSON 파싱
```

총 **~12 파일, ~40 TC** (Spec A ship 기준 minimum).

### 8.3 컨벤션

Spec B 가 확립한 규칙 그대로:
- "~~일 때 ~~한다(된다)" 패턴.
- `describe()` = 대상 명사형.
- 파일 = 단위 (1:1 미러).

### 8.4 OpenAPI spec 자체 검증

`crud-jsonapi-spec.test.ts` 는 `@apidevtools/swagger-parser` 의 `validate()` 호출. **devDependency 1개** 추가. spec 거짓말 detection 의 핵심 가치.

### 8.5 Coverage 목표

기존 jest.config.ts thresholds (Tier 1+2 baseline) 유지. Spec A 신규 모듈 별도 threshold 추가 안 함. Phase 3 가 망라 추가하면 자연 상승.

### 8.6 실행 시 주의

- 모든 documentation 테스트는 `process.env.AUTO_DOCS = 'true'` + `NODE_ENV = 'development'` 강제 (env-fixture 의 `withEnv`).
- `DocumentationGenerator.reset()` 을 `beforeEach`.
- `crud-jsonapi-spec.test.ts` 는 `buildTestApp` + `applyPrismaManagerMock` 재사용.
- `exportOpenApi.test.ts` 는 child process 로 ts-node 실행 + 임시 디렉토리.

## 9. Migration plan (구현 phasing)

각 단계는 독립 PR/commit 가능.

**M1: 변환 layer (low risk, no behavior change)**
- `documentation/` 8개 모듈 신규 작성.
- `documentationGenerator.ts` 내부를 새 모듈 호출로 교체. Public API 유지.
- 기존 동작 그대로 (path 변환·content-type 수정은 M2).
- 테스트: smoke 단위 테스트 통과.

**M2: OpenAPI 표준 위반 수정 (small visible behavior change)**
- `pathConverter` 활성화 (`:id` → `{id}`).
- `contentTypeRule` 활성화: CRUD 라우트만 `application/vnd.api+json`.
- `openapi: '3.0.0'` → `'3.1.0'`.
- 테스트: `crud-jsonapi-spec.test.ts` 가 swagger-parser validate 통과.

**M3: Schema 통합 (B 영역)**
- `syncDocumentationSchemas` + Core.initialize wiring.
- `DocumentationGenerator.registerSchema` public 추가.
- `expressRouter` 의 CRUD 헬퍼 (`jsonApiBody/Response/ErrorResponse`) 추가.
- CRUD 메서드 28개 호출 site 의 inline 스키마 → 헬퍼 점진 치환. GET/POST/PUT/PATCH/DELETE 단위로 나눔.
- 테스트: `sync-schemas.test.ts`, `crud-jsonapi-spec.test.ts` 의 paths 가 `$ref` 사용.

**M4: 운영 (C 영역)**
- `infoSource`, `serversSource` 활성화.
- `devDocsIpGuard` + Core.ts wiring.
- `loadRoutes({ dryRun })`, `PrismaManager.initialize({ skipConnect })` 옵션 추가.
- `scripts/exportOpenApi.ts` + `package.json` 의 `docs:export` + `build` 통합.
- `webpack.config.js` 의 CopyWebpackPlugin 에 `package.json` 추가.
- `.env.template` 에 새 env 5개 추가.
- 테스트: `exportOpenApi.test.ts`, `devDocsIpGuard.test.ts`.

**M5: 정리**
- 기존 `documentationGenerator.ts` 의 dead branch 제거.
- 사용자 문서 (`docs/00-documentation-index.md` 등) 갱신.
- Commit 메시지에 마이그레이션 노트.

## 10. Backwards compatibility

**유지**:
- `DocumentationGenerator.registerRoute` / `generateOpenAPISpec` / `generateHTMLDocumentation` / `generateDevInfoPage` / `reset` / `getRoutes` / `getRouteCount` 시그니처.
- `RouteDocumentation` 인터페이스 (필드 추가만, 기존 필드 유지). `contentType?` 옵셔널 추가, default `'json'`.
- `/docs`, `/docs/openapi.json`, `/docs/dev` 경로.
- `AUTO_DOCS` / `NODE_ENV` 게이트 동작.
- 사용자 라우트 등록 흐름.

**바뀌는 것 (사용자 가시 — minor)**:
- `/docs/openapi.json` 응답의 `openapi` 필드: `'3.0.0'` → `'3.1.0'`.
- paths 키: `/users/:id` → `/users/{id}`.
- CRUD 라우트의 content key: `application/json` → `application/vnd.api+json`.
- info 의 title/version/description: 하드코딩 → package.json + env override.
- `/docs/dev` 외부 IP 접근: 200 → 404.

사용자 코드 변경 불필요.

## 11. 잔여 위험

### R1: package.json 런타임 로드 (webpack)
- `infoSource.ts` 의 `require('package.json')` 이 webpack bundling 시 inline 됨 → 파일 변경 시 rebuild 필요. 정상 동작.
- 대안 (env 주입) 은 복잡도 ↑ 가치 ↓ → 채택 안 함.

### R2: dryRun 옵션의 side-effect
- `loadRoutes({ dryRun: true })` 가 `router.<verb>(...)` 호출은 함 → registerRoute 누적은 됨. 하지만 `dependencyInjector` 가 일부 모듈 instantiate 시점이라면 부작용 발생 가능.
- 검증: M4 단계 테스트가 child process 실행 → 정상 종료 확인.
- mitigation: `dependencyInjector.initialize({ instantiate: false })` 같은 옵션도 함께 받게 해야 할 수도. 구현 plan 에서 결정.

### R3: PrismaManager.skipConnect 의 reachability
- 일부 Prisma 버전에서 client 인스턴스 생성 자체가 schema 검증을 위해 connection 시도 가능. 명세상 lazy 지만 버전별 다름.
- 검증: M4 단계에서 `docs:export` 실행 시 DB 미가용 (URL 잘못된 값) 환경에서도 통과해야 함. 통과 못 하면 fallback: DMMF 만 따로 로드 (Prisma client 인스턴스화 우회).

### R4: Cross-DB model 이름 충돌
- 같은 이름의 model 이 여러 DB 에 있으면 components.schemas 키 충돌. 4.3 에서 정의: 둘째부터 `${dbName}__${modelName}` + warn.
- CRUD 헬퍼 시그니처 (`jsonApiBody('User', ...)`) 가 어느 DB 의 User 인지 구분 안 됨 → 옵션:
  1. `jsonApiBody(databaseName: string, modelName: string, op)` 분리 인자.
  2. `jsonApiBody('default.User', op)` dotted.
- 충돌 없는 99% 케이스에서 깔끔한 (2) 채택, 충돌 시 dotted 사용. 구현 plan 에서 확정.

### R5: Swagger UI CDN 의존
- 현재 `https://unpkg.com/swagger-ui-dist@5.0.0/...` 외부 CDN. `/docs` 가 인터넷 없는 환경에서 broken. 본 spec 범위 밖. 향후 별도 spec 에서 self-host 검토.

## 12. 명시적 deferrals

본 spec 이 다루지 **않는** 것:

- **D 리팩터** (정적 클래스 → 인스턴스): 별도 spec. 본 spec 은 변환 함수만 export pure 로 만들고 정적 wrapper 유지.
- **A 잔여**: NOTFOUND / MIDDLE_PROXY_ROUTE / multipart file upload 라우트의 docs — 별도. CRUD 와 별 패턴.
- **E.19 commented-out content-negotiation 코드** (expressRouter.ts 3600–3618, 4074–4077): 별도. 본 spec 은 새 코드만.
- **E.20 모델 단위 tags**: deferred. Phase 3 또는 별도.
- **Redoc / Postman collection / yaml export**: 별도. JSON 만.
- **OpenAPI spec versioning** (API version 변경 시 별 export): 향후.

## 13. Phase 3 와의 인계

Spec B Phase 3 plan 작성 시 활용할 정보:

- **TC #21 표적**: `documentation/openApiBuilder.ts` 의 `buildOpenApiDocument`, `documentation/schemaConverter.ts` 의 `fieldToOpenApi`/`schemaToOpenApi`, `documentation/dmmfToOpenApi.ts` 의 `modelToOpenApi`, `documentation/jsonApiSchemas.ts` 의 3변형. 모두 export pure functions.
- **Test fixture 재사용**: Spec B 가 만든 `tests/_fixtures/test-schema.{sqlite,postgres}.prisma`, `tests/_setup/db-fixture.ts`, `applyPrismaManagerMock`.
- **TC #22 (Schema API)**: 본 spec 과 무관 — `crudSchemaRegistry.ts` 의 `checkEnvironment`, `schemaApiRouter.ts` 의 IP 제한. 본 spec 이 도입한 `devDocsIpGuard` 의 IP 매칭 로직을 별 모듈로 빼면 두 라우트가 공유 가능. 구현 plan 에서 검토.
- **TC #23 (PrismaSchemaAnalyzer DMMF)**: 변경 없음. 그대로 회귀 보호.

## 부록 A: 신규 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `OPENAPI_TITLE` | `package.json` 의 `name` | OpenAPI `info.title` override |
| `OPENAPI_VERSION` | `package.json` 의 `version` | OpenAPI `info.version` override |
| `OPENAPI_DESC` | `package.json` 의 `description` | OpenAPI `info.description` override |
| `OPENAPI_SERVERS` | `[{"url":"http://${HOST}:${PORT}","description":"Local"}]` | OpenAPI `servers` 배열 (JSON) |
| `DOCS_DEV_ALLOWED_IPS` | `127.0.0.1,::1` | `/docs/dev` 접근 허용 IP CSV (CIDR 가능) |

## 부록 B: 신규 npm scripts

```json
{
  "scripts": {
    "docs:export": "ts-node -r tsconfig-paths/register scripts/exportOpenApi.ts",
    "build": "... && npm run docs:export -- --out dist/openapi.json"
  }
}
```

## 부록 C: 신규 devDependencies

- `@apidevtools/swagger-parser` — OpenAPI 표준 검증, 통합 테스트에서 사용.

## 부록 D: 참고 자료

- [OpenAPI Specification v3.1.0](https://spec.openapis.org/oas/v3.1.0)
- [JSON:API specification](https://jsonapi.org/)
- [JSON:API Recommendations](https://jsonapi.org/recommendations/)
- [SSOT Codegen Pipeline with Prisma-backed DMMF templates](https://medium.com/@nick.rios/ssot-codegen-pipeline-with-prisma-backed-dmmf-templates-e0fc152d469f)
- [Server Variables in OpenAPI best practices (Speakeasy)](https://www.speakeasy.com/openapi/servers/server-variables)
- [Handling Environment Variables in OpenAPI Server URLs](https://hrekov.com/blog/openapi-env-vars-handling)
- [express-ip-filter-middleware (npm)](https://www.npmjs.com/package/express-ip-filter-middleware)
