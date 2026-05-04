# Documentation System Enhancement — Phase 2 (M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** OpenAPI 표준 위반 4가지를 수정. 본 phase 통과 시 spec 이 외부 도구 (Postman, Swagger Editor, code generators) 와 호환됨.

**Architecture:** M1 에서 비활성 상태로 만들어 둔 변환 모듈 (`pathConverter`, `contentTypeRule`) 을 `openApiBuilder` 에서 활성화. `RouteDocumentation` 에 `contentType?` 필드 추가. CRUD 가 등록하는 모든 라우트는 `'jsonapi'` 로 태깅. `openapi: '3.1.0'` 으로 업그레이드. `@apidevtools/swagger-parser` 로 spec validation 통합 테스트.

**Tech Stack:** TypeScript, Jest. devDependency 1개 추가: `@apidevtools/swagger-parser`.

**Spec 참조:** `docs/superpowers/specs/2026-05-04-documentation-system-enhancement-design.md` (섹션 9 M2).

**비포함**: M3 (DMMF sync + CRUD $ref), M4 (info/servers/IP 가드/export), M5 (정리).

---

## 변경 내역 요약

| 영역 | 변경 |
|---|---|
| `RouteDocumentation` 인터페이스 | `contentType?: ContentTypeMode` 옵셔널 필드 추가 |
| `openApiBuilder.ts` | 1) `OPENAPI_VERSION = '3.1.0'`, 2) `toOpenApiPath` 적용, 3) `mediaTypeFor` 적용 |
| `expressRouter.ts` | CRUD 의 private `this.registerDocumentation` 가 자동으로 `contentType: 'jsonapi'` 첨부 |
| `package.json` (devDeps) | `@apidevtools/swagger-parser` 추가 |
| 테스트 | `openApiBuilder.test.ts` 의 기대값 업데이트 + 신규 통합 테스트 `crud-jsonapi-spec.test.ts` |

---

## Task 1: RouteDocumentation 에 contentType 필드 추가

**Files:**
- Modify: `src/core/lib/documentationGenerator.ts` (interface RouteDocumentation 만)
- Modify: `src/core/lib/documentation/openApiBuilder.ts` (RouteDocumentationLike 인터페이스에 동일 필드 추가)

본 task 는 타입만 추가, 동작 변경 없음. 후속 task 가 사용.

- [ ] **Step 1: documentationGenerator.ts 의 RouteDocumentation 에 contentType 추가**

기존 `interface RouteDocumentation` 정의를 다음으로 교체:

```ts
import { ContentTypeMode } from './documentation';

export interface RouteDocumentation {
    method: string;
    path: string;
    summary?: string;
    description?: string;
    parameters?: {
        query?: Schema;
        params?: Schema;
        body?: Schema;
    };
    responses?: ResponseConfig;
    tags?: string[];
    contentType?: ContentTypeMode;
}
```

(기존 import 들 + `ContentTypeMode` 추가)

- [ ] **Step 2: openApiBuilder.ts 의 RouteDocumentationLike 에 contentType 추가**

기존 `interface RouteDocumentationLike` 정의를 다음으로 교체:

```ts
import { ContentTypeMode } from './openApiTypes';
// (기존 import 들 + ContentTypeMode 추가)

export interface RouteDocumentationLike {
    method: string;
    path: string;
    summary?: string;
    description?: string;
    parameters?: {
        query?: Schema;
        params?: Schema;
        body?: Schema;
    };
    responses?: Record<string | number, Schema>;
    tags?: string[];
    contentType?: ContentTypeMode;
}
```

- [ ] **Step 3: 컴파일 + 기존 테스트 통과 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx tsc --noEmit -p tsconfig.test.json 2>&1 | grep -E "documentation|expressRouter" | head -10
cd /e/Projects/express.js-kusto && npx jest 2>&1 | tail -5
```
Expected: 0 에러, 184/184 TC PASS (옵셔널 필드 추가는 호환됨).

- [ ] **Step 4: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/documentationGenerator.ts src/core/lib/documentation/openApiBuilder.ts && git commit -m "feat(docs): RouteDocumentation 에 contentType 옵셔널 필드 추가"
```

---

## Task 2: openApiBuilder 활성화 — path 변환 + content-type + 3.1.0

**Files:**
- Modify: `src/core/lib/documentation/openApiBuilder.ts`
- Modify: `tests/unit/documentation/openApiBuilder.test.ts`

기존 비활성 모듈 (`pathConverter`, `contentTypeRule`) 을 호출하도록 빌더 변경. OpenAPI 버전 3.1.0 으로. **이게 가시 동작 변화의 핵심**.

- [ ] **Step 1: 실패하는 테스트 작성 (기존 테스트 수정)**

`tests/unit/documentation/openApiBuilder.test.ts` 의 `it('routes 가 비어 있을 때 ...')` 와 `it('routes 의 path 파라미터가 ...')` 의 기대값을 갱신, **추가로** content-type 테스트 + path 변환 테스트 신규.

전체 파일을 다음으로 교체:

```ts
import { buildOpenApiDocument } from '@lib/documentation/openApiBuilder';
import { snapshotEnv } from '../../_setup/env-fixture';

describe('openApiBuilder', () => {
    let restoreEnv: () => void;
    beforeEach(() => {
        restoreEnv = snapshotEnv();
        delete process.env.OPENAPI_TITLE;
        delete process.env.OPENAPI_VERSION;
        delete process.env.OPENAPI_DESC;
        delete process.env.OPENAPI_SERVERS;
    });
    afterEach(() => restoreEnv());

    describe('buildOpenApiDocument', () => {
        it('routes 가 비어 있을 때 openapi 3.1.0 의 빈 paths document 를 반환한다', () => {
            const doc = buildOpenApiDocument({
                routes: [],
                schemas: {},
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            expect(doc.openapi).toBe('3.1.0');
            expect(doc.info.title).toBe('test-api');
            expect(doc.paths).toEqual({});
            expect(doc.components?.schemas).toEqual({});
        });

        it('GET /users 라우트 1개일 때 paths 에 등록된다', () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/users',
                    summary: 'List users',
                    responses: { 200: { data: { type: 'array', required: true } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            expect(doc.paths['/users']).toBeDefined();
            expect(doc.paths['/users'].get?.summary).toBe('List users');
        });

        it('schemas 가 주어지면 components.schemas 로 그대로 옮겨진다', () => {
            const userSchema = { type: 'object' as const, properties: { id: { type: 'string' as const } } };
            const doc = buildOpenApiDocument({
                routes: [],
                schemas: { User: userSchema },
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            expect(doc.components?.schemas?.User).toEqual(userSchema);
        });

        it('routes 의 query 파라미터가 OpenAPI parameters 로 변환된다', () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/users',
                    parameters: { query: { page: { type: 'number', required: false, description: 'Page' } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            const op = doc.paths['/users'].get!;
            expect(op.parameters!.find(p => p.name === 'page' && p.in === 'query')).toBeDefined();
        });

        it(':id 형식의 path 가 OpenAPI 표준 {id} 로 변환된다', () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/users/:id',
                    parameters: { params: { id: { type: 'string', required: true } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            expect(doc.paths['/users/{id}']).toBeDefined();
            expect(doc.paths['/users/:id']).toBeUndefined();
            const op = doc.paths['/users/{id}'].get;
            expect(op?.parameters?.find(p => p.name === 'id' && p.in === 'path')).toBeDefined();
        });

        it("contentType 'json' 일 때 응답 content key 가 application/json 이다", () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/x',
                    contentType: 'json',
                    responses: { 200: { data: { type: 'object', required: true } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            const content = doc.paths['/x'].get?.responses['200']?.content;
            expect(content).toHaveProperty('application/json');
            expect(content).not.toHaveProperty('application/vnd.api+json');
        });

        it("contentType 'jsonapi' 일 때 응답 content key 가 application/vnd.api+json 이다", () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/x',
                    contentType: 'jsonapi',
                    responses: { 200: { data: { type: 'object', required: true } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            const content = doc.paths['/x'].get?.responses['200']?.content;
            expect(content).toHaveProperty('application/vnd.api+json');
            expect(content).not.toHaveProperty('application/json');
        });

        it("contentType 'jsonapi' 일 때 requestBody content key 도 application/vnd.api+json 이다", () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'POST',
                    path: '/x',
                    contentType: 'jsonapi',
                    parameters: { body: { name: { type: 'string', required: true } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            const content = doc.paths['/x'].post?.requestBody?.content;
            expect(content).toHaveProperty('application/vnd.api+json');
        });

        it('contentType 미지정일 때 application/json 이 기본값이다', () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/y',
                    responses: { 200: { ok: { type: 'boolean', required: true } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            expect(doc.paths['/y'].get?.responses['200']?.content).toHaveProperty('application/json');
        });

        it('responses 가 없을 때 기본 200 응답이 채워진다', () => {
            const doc = buildOpenApiDocument({
                routes: [{ method: 'POST', path: '/x' }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            expect(doc.paths['/x']?.post?.responses['200']).toBeDefined();
        });

        it('환경변수가 servers/info 를 override 한다', () => {
            process.env.OPENAPI_TITLE = 'Custom';
            process.env.OPENAPI_SERVERS = JSON.stringify([{ url: 'https://prod.example.com' }]);
            const doc = buildOpenApiDocument({
                routes: [],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            expect(doc.info.title).toBe('Custom');
            expect(doc.servers?.[0].url).toBe('https://prod.example.com');
        });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/unit/documentation/openApiBuilder.test.ts 2>&1 | tail -25
```
Expected: 일부 FAIL (3.1.0 기대 / `/users/{id}` 기대 / vnd.api+json 기대 등).

- [ ] **Step 3: 구현 — openApiBuilder.ts 활성화**

Replace the `OPENAPI_VERSION` constant + `buildRequestBody`, `buildResponses`, and `buildOpenApiDocument` functions in `src/core/lib/documentation/openApiBuilder.ts`.

전체 파일을 다음으로 교체:

```ts
import { Schema } from '@lib/validator';
import {
    OpenApiDocument,
    OpenApiOperation,
    OpenApiParameter,
    OpenApiRequestBody,
    OpenApiResponse,
    OpenApiSchema,
    OpenApiSchemaOrRef,
    ContentTypeMode,
} from './openApiTypes';
import { schemaToOpenApi, fieldToOpenApi } from './schemaConverter';
import { buildInfo } from './infoSource';
import { buildServers } from './serversSource';
import { toOpenApiPath } from './pathConverter';
import { mediaTypeFor } from './contentTypeRule';

const OPENAPI_VERSION = '3.1.0';
const DEFAULT_CONTENT_TYPE_MODE: ContentTypeMode = 'json';

export interface RouteDocumentationLike {
    method: string;
    path: string;
    summary?: string;
    description?: string;
    parameters?: {
        query?: Schema;
        params?: Schema;
        body?: Schema;
    };
    responses?: Record<string | number, Schema>;
    tags?: string[];
    contentType?: ContentTypeMode;
}

export interface BuildOpenApiInput {
    routes: RouteDocumentationLike[];
    schemas: Record<string, OpenApiSchemaOrRef>;
    env: NodeJS.ProcessEnv;
    packageJson: { name?: string; version?: string; description?: string };
}

function buildParameters(route: RouteDocumentationLike): OpenApiParameter[] {
    const out: OpenApiParameter[] = [];
    if (route.parameters?.query) {
        for (const [name, field] of Object.entries(route.parameters.query)) {
            out.push({
                name,
                in: 'query',
                required: field.required ?? false,
                schema: fieldToOpenApi(field),
                ...(field.example !== undefined ? { example: field.example } : {}),
            });
        }
    }
    if (route.parameters?.params) {
        for (const [name, field] of Object.entries(route.parameters.params)) {
            out.push({
                name,
                in: 'path',
                required: true,
                schema: fieldToOpenApi(field),
            });
        }
    }
    return out;
}

function buildRequestBody(route: RouteDocumentationLike, mediaType: string): OpenApiRequestBody | undefined {
    if (!route.parameters?.body) return undefined;
    return {
        required: true,
        content: {
            [mediaType]: {
                schema: schemaToOpenApi(route.parameters.body),
            },
        },
    };
}

function buildResponses(route: RouteDocumentationLike, mediaType: string): Record<string, OpenApiResponse> {
    const out: Record<string, OpenApiResponse> = {};
    if (route.responses) {
        for (const [code, schema] of Object.entries(route.responses)) {
            out[code] = {
                description: `Response ${code}`,
                content: {
                    [mediaType]: {
                        schema: schemaToOpenApi(schema),
                    },
                },
            };
        }
    }
    if (Object.keys(out).length === 0) {
        out['200'] = {
            description: 'Success',
            content: {
                [mediaType]: {
                    schema: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean' },
                            data: { type: 'object' },
                            timestamp: { type: 'string', format: 'date-time' },
                        },
                    } as OpenApiSchema,
                },
            },
        };
    }
    return out;
}

function buildOperation(route: RouteDocumentationLike): OpenApiOperation {
    const mediaType = mediaTypeFor(route.contentType ?? DEFAULT_CONTENT_TYPE_MODE);
    const op: OpenApiOperation = {
        summary: route.summary ?? `${route.method.toUpperCase()} ${route.path}`,
        tags: route.tags ?? ['API'],
        responses: buildResponses(route, mediaType),
    };
    if (route.description !== undefined) op.description = route.description;
    const parameters = buildParameters(route);
    if (parameters.length > 0) op.parameters = parameters;
    const requestBody = buildRequestBody(route, mediaType);
    if (requestBody !== undefined) op.requestBody = requestBody;
    return op;
}

export function buildOpenApiDocument(input: BuildOpenApiInput): OpenApiDocument {
    const { routes, schemas, env, packageJson } = input;

    const paths: Record<string, Record<string, OpenApiOperation>> = {};
    for (const route of routes) {
        const { path: openApiPath } = toOpenApiPath(route.path);
        if (!paths[openApiPath]) paths[openApiPath] = {};
        paths[openApiPath][route.method.toLowerCase()] = buildOperation(route);
    }

    return {
        openapi: OPENAPI_VERSION,
        info: buildInfo(packageJson, env),
        servers: buildServers(env),
        paths: paths as OpenApiDocument['paths'],
        components: { schemas },
    };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/unit/documentation/openApiBuilder.test.ts 2>&1 | tail -20
```
Expected: PASS — 11 tests passed (기존 7 + 신규 4).

- [ ] **Step 5: 전체 테스트 회귀 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest 2>&1 | tail -5
```
Expected: 188/188 TC PASS (184 + 4 신규).

- [ ] **Step 6: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/documentation/openApiBuilder.ts tests/unit/documentation/openApiBuilder.test.ts && git commit -m "feat(docs): openApiBuilder 활성화 — path 변환 + content-type + OpenAPI 3.1.0"
```

---

## Task 3: CRUD 라우트가 자동으로 contentType='jsonapi' 등록

**Files:**
- Modify: `src/core/lib/expressRouter.ts` (private `registerDocumentation` 메서드만)

CRUD 메서드 6개 (setupIndexRoute / setupShowRoute / setupCreateRoute / setupUpdateRoute / setupDestroyRoute / setupRecoverRoute) 가 모두 이 private 메서드를 거침. 한 곳에 `contentType: 'jsonapi'` 추가하면 6개 호출 site 가 모두 태깅됨.

본 task 는 **CRUD 호출만** 영향 — 일반 verb 메서드 (`router.GET()`, `router.POST_VALIDATED()` 등) 는 직접 `DocumentationGenerator.registerRoute(...)` 호출하므로 contentType 미지정 → 기본 'json' 유지.

- [ ] **Step 1: expressRouter.ts 의 private registerDocumentation 메서드 위치 파악**

Run:
```bash
cd /e/Projects/express.js-kusto && grep -n "private registerDocumentation" src/core/lib/expressRouter.ts
```
Expected: 1 줄 (한 메서드만 존재).

- [ ] **Step 2: 메서드 본체 수정**

기존 메서드 (현재 line 4959 부근, 위치는 위 grep 결과 따름) 를 다음으로 교체:

```ts
    private registerDocumentation(method: string, path: string, config: any): void {
        if (this.basePath) {
            DocumentationGenerator.registerRoute({
                method,
                path: this.getFullPath(path),
                contentType: 'jsonapi',
                ...config
            });
        } else {
            this.pendingDocumentation.push({
                method,
                path,
                requestConfig: config.parameters ? {
                    query: config.parameters.query,
                    params: config.parameters.params,
                    body: config.parameters.body
                } : undefined,
                responseConfig: config.responses,
                contentType: 'jsonapi',
            });
        }
    }
```

**중요한 변경**:
1. `DocumentationGenerator.registerRoute({...})` 호출에 `contentType: 'jsonapi'` 추가 (`...config` 보다 앞 — config 가 명시적으로 contentType 을 지정하면 그것이 이김).
2. `this.pendingDocumentation.push({...})` 에도 `contentType: 'jsonapi'` 추가.

`pendingDocumentation` 배열의 항목 타입에도 `contentType?` 가 필요할 수 있음. 만약 TypeScript 가 타입 에러를 내면, `pendingDocumentation` 의 타입 선언 (현재 같은 클래스 내부에 정의돼 있음) 에 `contentType?: 'json' | 'jsonapi'` 옵셔널 필드 추가.

- [ ] **Step 3: pendingDocumentation 의 flush 지점 확인**

`pendingDocumentation` 가 어디서 `DocumentationGenerator.registerRoute` 로 flush 되는지 grep:

```bash
cd /e/Projects/express.js-kusto && grep -n "pendingDocumentation" src/core/lib/expressRouter.ts
```

flush 지점 (보통 `setBasePath` 같은 메서드 안에 `for (const doc of this.pendingDocumentation) { DocumentationGenerator.registerRoute({...}) }` 형태) 에서 contentType 도 함께 전달해야 함. 해당 위치의 `DocumentationGenerator.registerRoute({...})` 호출에 `contentType: doc.contentType,` 줄 추가.

- [ ] **Step 4: 컴파일 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx tsc --noEmit -p tsconfig.test.json 2>&1 | grep -E "expressRouter" | head -10
```
Expected: 0 에러. 에러가 있으면 `pendingDocumentation` 의 타입 선언에 `contentType?` 필드 추가.

- [ ] **Step 5: 전체 테스트 회귀 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest 2>&1 | tail -5
```
Expected: 188/188 TC PASS.

- [ ] **Step 6: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/expressRouter.ts && git commit -m "feat(docs): CRUD 라우트가 자동으로 contentType=jsonapi 로 등록"
```

---

## Task 4: @apidevtools/swagger-parser devDependency 추가

**Files:**
- Modify: `package.json`

- [ ] **Step 1: devDependency 설치**

Run:
```bash
cd /e/Projects/express.js-kusto && npm install --save-dev @apidevtools/swagger-parser 2>&1 | tail -5
```
Expected: 패키지 추가 메시지 + lock 파일 갱신.

- [ ] **Step 2: package.json devDependencies 에 추가됐는지 확인**

```bash
cd /e/Projects/express.js-kusto && grep -A1 "@apidevtools" package.json
```
Expected: `@apidevtools/swagger-parser` 항목 존재.

- [ ] **Step 3: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add package.json package-lock.json && git commit -m "chore(deps): @apidevtools/swagger-parser devDependency 추가 (OpenAPI spec validation)"
```

---

## Task 5: 통합 테스트 — CRUD 가 등록한 spec 의 표준 준수 검증

**Files:**
- Create: `tests/integration/documentation/crud-jsonapi-spec.test.ts`

실제 `DocumentationGenerator.registerRoute` 를 거쳐 생성된 spec 이 OpenAPI 3.1 표준을 만족하는지 swagger-parser 로 검증.

- [ ] **Step 1: 테스트 작성**

Create `tests/integration/documentation/crud-jsonapi-spec.test.ts`:

```ts
import SwaggerParser from '@apidevtools/swagger-parser';
import { DocumentationGenerator } from '@lib/documentationGenerator';
import { snapshotEnv } from '../../_setup/env-fixture';

describe('CRUD 가 등록한 OpenAPI spec 의 표준 준수', () => {
    let restoreEnv: () => void;

    beforeEach(() => {
        restoreEnv = snapshotEnv();
        process.env.AUTO_DOCS = 'true';
        process.env.NODE_ENV = 'development';
        DocumentationGenerator.reset();
    });

    afterEach(() => {
        DocumentationGenerator.reset();
        restoreEnv();
    });

    it('CRUD 스타일 라우트 6개를 등록하고 spec 을 빌드했을 때 swagger-parser validate 를 통과한다', async () => {
        const routes = [
            { method: 'GET', path: '/users', contentType: 'jsonapi' as const,
                parameters: { query: { 'page[number]': { type: 'number' as const, required: false } } },
                responses: { 200: { data: { type: 'array' as const, required: true } } } },
            { method: 'GET', path: '/users/:id', contentType: 'jsonapi' as const,
                parameters: { params: { id: { type: 'string' as const, required: true } } },
                responses: { 200: { data: { type: 'object' as const, required: true } } } },
            { method: 'POST', path: '/users', contentType: 'jsonapi' as const,
                parameters: { body: { name: { type: 'string' as const, required: true } } },
                responses: { 201: { data: { type: 'object' as const, required: true } } } },
            { method: 'PUT', path: '/users/:id', contentType: 'jsonapi' as const,
                parameters: { params: { id: { type: 'string' as const, required: true } } },
                responses: { 200: { data: { type: 'object' as const, required: true } } } },
            { method: 'PATCH', path: '/users/:id', contentType: 'jsonapi' as const,
                parameters: { params: { id: { type: 'string' as const, required: true } } },
                responses: { 200: { data: { type: 'object' as const, required: true } } } },
            { method: 'DELETE', path: '/users/:id', contentType: 'jsonapi' as const,
                parameters: { params: { id: { type: 'string' as const, required: true } } },
                responses: { 204: {} } },
        ];

        for (const route of routes) {
            DocumentationGenerator.registerRoute(route);
        }

        const spec = DocumentationGenerator.generateOpenAPISpec();

        // swagger-parser 의 validate 는 비동기. spec 이 OpenAPI 3.1 표준 위반 시 throw.
        await expect(SwaggerParser.validate(spec as any)).resolves.toBeDefined();
    });

    it('생성된 spec 의 paths 키가 OpenAPI 표준 {param} 형식이다', () => {
        DocumentationGenerator.registerRoute({
            method: 'GET',
            path: '/users/:userId/posts/:postId',
            contentType: 'jsonapi',
            parameters: { params: { userId: { type: 'string', required: true }, postId: { type: 'string', required: true } } },
            responses: { 200: { data: { type: 'object', required: true } } },
        });

        const spec = DocumentationGenerator.generateOpenAPISpec();

        expect(spec.paths['/users/{userId}/posts/{postId}']).toBeDefined();
        expect(spec.paths['/users/:userId/posts/:postId']).toBeUndefined();
    });

    it('CRUD 라우트의 응답·요청 content key 가 application/vnd.api+json 이다', () => {
        DocumentationGenerator.registerRoute({
            method: 'POST',
            path: '/users',
            contentType: 'jsonapi',
            parameters: { body: { name: { type: 'string', required: true } } },
            responses: { 201: { data: { type: 'object', required: true } } },
        });

        const spec = DocumentationGenerator.generateOpenAPISpec();
        const op = spec.paths['/users']?.post;

        expect(op?.requestBody?.content).toHaveProperty('application/vnd.api+json');
        expect(op?.responses?.['201']?.content).toHaveProperty('application/vnd.api+json');
    });

    it('contentType 미지정 라우트는 application/json 을 사용한다', () => {
        DocumentationGenerator.registerRoute({
            method: 'GET',
            path: '/health',
            responses: { 200: { ok: { type: 'boolean', required: true } } },
        });

        const spec = DocumentationGenerator.generateOpenAPISpec();
        const op = spec.paths['/health']?.get;

        expect(op?.responses?.['200']?.content).toHaveProperty('application/json');
        expect(op?.responses?.['200']?.content).not.toHaveProperty('application/vnd.api+json');
    });

    it('OpenAPI 버전이 3.1.0 이다', () => {
        const spec = DocumentationGenerator.generateOpenAPISpec();
        expect(spec.openapi).toBe('3.1.0');
    });
});
```

- [ ] **Step 2: 테스트 실행**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/integration/documentation/crud-jsonapi-spec.test.ts 2>&1 | tail -20
```
Expected: PASS — 5 tests passed.

만약 swagger-parser validate 가 실패하면 출력의 에러 메시지를 보고 spec 의 어느 부분이 표준에 안 맞는지 확인. 가능한 원인:
- `info.title`/`version` 누락 — Task 2 의 buildInfo 가 제대로 채우는지 확인.
- `responses` 의 응답 코드 키가 string 이 아닌 number — JavaScript 객체의 numeric key 가 자동으로 string 으로 변환됨.
- `requestBody.content[mediaType].schema` 의 properties 가 빈 object — 표준 위반 아님 (object 빈 properties 는 허용).

원인 파악 후 openApiBuilder 또는 schemaToOpenApi 수정 필요할 수 있음. 그 경우 BLOCKED 보고하고 원인 적시.

- [ ] **Step 3: 전체 테스트 회귀 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest 2>&1 | tail -5
```
Expected: 193/193 TC PASS (188 + 5 신규).

- [ ] **Step 4: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add tests/integration/documentation/crud-jsonapi-spec.test.ts && git commit -m "test(docs): CRUD spec 의 OpenAPI 3.1 표준 준수 통합 테스트"
```

---

## Task 6: 동작 동일성 수동 검증 (smoke)

**Files:** (수정 없음)

M2 의 가시 동작 변화가 의도대로 작동하는지 마지막 확인.

- [ ] **Step 1: smoke 스크립트로 spec 출력 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && cat > smoke-m2.js << 'EOF'
process.env.NODE_ENV = 'development';
process.env.AUTO_DOCS = 'true';

require('module-alias/register');
require('ts-node/register/transpile-only');

const { DocumentationGenerator } = require('./src/core/lib/documentationGenerator');

DocumentationGenerator.reset();

DocumentationGenerator.registerRoute({
    method: 'GET',
    path: '/users/:id',
    contentType: 'jsonapi',
    summary: 'Get user',
    parameters: { params: { id: { type: 'string', required: true } } },
    responses: { 200: { data: { type: 'object', required: true } } },
});

DocumentationGenerator.registerRoute({
    method: 'GET',
    path: '/health',
    summary: 'Health check',
    responses: { 200: { ok: { type: 'boolean', required: true } } },
});

const spec = DocumentationGenerator.generateOpenAPISpec();

console.log('openapi:', spec.openapi);
console.log('paths:', Object.keys(spec.paths));
console.log('jsonapi route content:', Object.keys(spec.paths['/users/{id}']?.get?.responses['200']?.content || {}));
console.log('json route content:', Object.keys(spec.paths['/health']?.get?.responses['200']?.content || {}));
EOF
node smoke-m2.js 2>&1 | grep -v "DEBUG\|tslib"
rm -f smoke-m2.js
```
Expected:
- `openapi: 3.1.0`
- `paths: ['/users/{id}', '/health']`
- jsonapi content: `['application/vnd.api+json']`
- json content: `['application/json']`

이게 정상이면 M2 의 4가지 가시 동작 변화가 모두 활성화된 것.

- [ ] **Step 2: TaskUpdate (별 commit 없음)**

```bash
cd /e/Projects/express.js-kusto && git status
```
Expected: working tree clean.

---

## 자기 점검 (Self-review 결과)

- **Spec § 9 M2** 의 4가지 항목:
  1. pathConverter 활성화 — Task 2 ✓
  2. contentTypeRule 활성화 (CRUD = jsonapi) — Task 2 (활성화) + Task 3 (CRUD 태깅) ✓
  3. `'3.0.0'` → `'3.1.0'` — Task 2 ✓
  4. `crud-jsonapi-spec.test.ts` swagger-parser validate — Task 4 (devDep) + Task 5 (테스트) ✓

- **Placeholder scan**: TBD/TODO/"적절히" 0건.

- **Type 일관성**: `ContentTypeMode` (M1 의 openApiTypes.ts 에서 정의) → Task 1 의 두 인터페이스, Task 2 의 buildOperation, Task 3 의 expressRouter 모두 일관되게 사용.

- **Backwards compat**: 기존 라우트 (CRUD 외 GET/POST/PUT/DELETE/PATCH/file upload) 는 `contentType` 미지정 → 기본 'json' → 기존 동작 그대로.

- **타입 호환**: `pendingDocumentation` 의 항목 타입에 `contentType?` 옵셔널 추가가 Task 3 step 3 에서 발견될 가능성 있음. 발견 시 expressRouter 의 해당 타입 선언 수정 (옵셔널 필드 추가는 호환).

---

## 완료 기준 (Definition of Done)

- 모든 6 task 의 체크박스 체크.
- `npx jest` 가 PASS — 193 TC (M1 의 184 + Task 2 의 +4 + Task 5 의 +5).
- `npx tsc --noEmit -p tsconfig.test.json` 0 에러.
- `/docs/openapi.json` 응답이 `openapi: '3.1.0'` + paths 키 `{id}` 형식 + CRUD 라우트의 content `vnd.api+json`.
- Git log 에 6개의 의미 단위 commit.
- branch `ver/0.1.47` working tree clean.
