# Documentation System Enhancement — Phase 3b (M3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** CRUD 6개 setup 메서드의 inline 스키마를 M3 의 `jsonApiBody / jsonApiResponse / jsonApiErrorResponse` 호출로 치환. `components.schemas` 의 `$ref` 가 실제 spec 에서 사용되도록. 부수로 `jsonApiAttributes` 의 `isId` fallback 수정 (Prisma 7 호환).

**Architecture:** (1) `jsonApiAttributes` 에 `primaryKey.fields` 기반 fallback 추가. (2) `openApiBuilder` 가 `Schema` (validator) 와 `OpenApiObjectSchema` 둘 다 처리하도록 detection 추가. (3) `jsonApiCollectionResponse` 헬퍼 추가 (index 응답용 배열 형식). (4) CRUD 메서드 6개를 verb 단위로 차례 마이그레이션. (5) `swagger-parser` 가 새 spec 도 통과 확인.

**Tech Stack:** TypeScript, Jest, `@apidevtools/swagger-parser` (이미 설치됨). 신규 의존성 0.

**Spec 참조:** `docs/superpowers/specs/2026-05-04-documentation-system-enhancement-design.md` (섹션 5.4 jsonApiBody/Response, 섹션 9 M3 의 "CRUD 메서드 28개 호출 site 의 inline 스키마 → 헬퍼 점진 치환").

**비포함**: M4 (info/servers/IP 가드/export), M5 (정리). Atomic Operations / Relationship 라우트는 별도 — 본 plan 은 6 핵심 setup 메서드만.

---

## 변경 내역 요약

| 영역 | 변경 |
|---|---|
| `documentation/jsonApiSchemas.ts` | `jsonApiAttributes` 가 `primaryKey.fields` 도 제외 (isId 무용 시 fallback) |
| `documentation/jsonApiHelpers.ts` | `jsonApiCollectionResponse(modelName)` 신규 추가 |
| `documentation/openApiBuilder.ts` | body/response 가 OpenAPI 형태일 때 schemaToOpenApi 우회 + `RouteDocumentationLike` 타입 widening |
| `documentationGenerator.ts` | `RouteDocumentation.parameters.body / responses[code]` 타입 widening (선언만) |
| `expressRouter.ts` | 6개 setup 메서드의 inline body/response → 헬퍼 호출 |
| `tests/integration/documentation/crud-jsonapi-spec.test.ts` | $ref 사용 검증 TC + swagger-parser validate (확장 모델 케이스) |

---

## Task 1: jsonApiAttributes 의 isId fallback (primaryKey.fields)

**Files:**
- Modify: `E:\Projects\express.js-kusto\src\core\lib\documentation\jsonApiSchemas.ts`
- Modify: `E:\Projects\express.js-kusto\tests\unit\documentation\jsonApiSchemas.test.ts`

Prisma 7 의 `_runtimeDataModel` 이 `isId` 메타데이터를 노출하지 않을 때, `primaryKey.fields` (`['id']` 또는 다른 이름) 기준으로 PK 필드를 attributes 에서 제외.

- [ ] **Step 1: 추가 테스트 작성 (TDD: 새 기대 추가)**

`tests/unit/documentation/jsonApiSchemas.test.ts` 에 `describe('jsonApiAttributes', ...)` 블록 안에 추가:

```ts
        it('isId 가 false 라도 primaryKey.fields 에 포함된 필드는 제외된다 (Prisma 7 호환)', () => {
            const noIsIdModel: PrismaModelInfo = {
                ...sampleModel,
                fields: [
                    // Prisma 7 _runtimeDataModel: isId false 로 노출되는 케이스 시뮬레이션
                    { name: 'id', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: true, isReadOnly: false, isGenerated: true, isUpdatedAt: false },
                    { name: 'title', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
                ],
                primaryKey: { fields: ['id'] },
            };
            const schema = jsonApiAttributes(noIsIdModel, new Map());
            expect((schema as any).properties).not.toHaveProperty('id');
            expect((schema as any).properties).toHaveProperty('title');
        });

        it('primaryKey.fields 가 복합키일 때 모든 PK 필드가 제외된다', () => {
            const composite: PrismaModelInfo = {
                ...sampleModel,
                fields: [
                    { name: 'tenantId', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
                    { name: 'userId', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
                    { name: 'role', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
                ],
                primaryKey: { fields: ['tenantId', 'userId'] },
            };
            const schema = jsonApiAttributes(composite, new Map());
            expect((schema as any).properties).not.toHaveProperty('tenantId');
            expect((schema as any).properties).not.toHaveProperty('userId');
            expect((schema as any).properties).toHaveProperty('role');
        });

        it('primaryKey 자체가 없을 때 isId 가 true 인 필드만 제외된다', () => {
            const onlyIsId: PrismaModelInfo = {
                ...sampleModel,
                fields: [
                    { name: 'id', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: true, isUnique: true, isReadOnly: false, isGenerated: true, isUpdatedAt: false },
                    { name: 'name', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
                ],
                primaryKey: undefined,
            };
            const schema = jsonApiAttributes(onlyIsId, new Map());
            expect((schema as any).properties).not.toHaveProperty('id');
            expect((schema as any).properties).toHaveProperty('name');
        });
```

기존 sampleModel 의 `body` 필드는 isOptional 인데 `isId: false`. 그건 그대로 작동해야 함 (변경 없음).

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/unit/documentation/jsonApiSchemas.test.ts 2>&1 | tail -20
```
Expected: FAIL — 첫 번째 새 테스트 (Prisma 7 호환) 가 실패. id 가 properties 에 포함됨.

- [ ] **Step 3: 구현 수정**

`src/core/lib/documentation/jsonApiSchemas.ts` 의 `jsonApiAttributes` 를 다음으로 교체:

```ts
/**
 * JSON:API attributes schema — id 와 관계 필드를 제외한 모든 필드.
 * Prisma 7 의 _runtimeDataModel 은 isId 메타데이터를 일관되게 노출하지 않을 수 있어
 * model.primaryKey.fields 도 함께 제외 기준으로 사용한다.
 */
export function jsonApiAttributes(model: PrismaModelInfo, enumValuesByName: Map<string, string[]>): OpenApiObjectSchema {
    const properties: Record<string, OpenApiSchemaOrRef> = {};
    const required: string[] = [];

    const pkFields = new Set(model.primaryKey?.fields ?? []);

    for (const field of model.fields) {
        if (field.isId) continue;
        if (pkFields.has(field.name)) continue;
        if (field.relationName) continue;
        properties[field.name] = fieldToSchema(field, enumValuesByName);
        if (!field.isOptional && !field.isGenerated) required.push(field.name);
    }

    const result: OpenApiObjectSchema = { type: 'object', properties };
    if (required.length > 0) result.required = required;
    return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/unit/documentation/jsonApiSchemas.test.ts 2>&1 | tail -15
```
Expected: PASS — 8 tests passed (기존 5 + 신규 3).

- [ ] **Step 5: 전체 회귀**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest --runInBand 2>&1 | tail -5
```
Expected: 211/211 TC PASS (208 + 3).

- [ ] **Step 6: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/documentation/jsonApiSchemas.ts tests/unit/documentation/jsonApiSchemas.test.ts && git commit -m "fix(docs): jsonApiAttributes 가 primaryKey.fields 도 제외 (Prisma 7 호환)"
```

---

## Task 2: jsonApiCollectionResponse 헬퍼 추가

**Files:**
- Modify: `E:\Projects\express.js-kusto\src\core\lib\documentation\jsonApiHelpers.ts`
- Modify: `E:\Projects\express.js-kusto\tests\unit\documentation\jsonApiHelpers.test.ts`

GET / (index) 응답은 `data: [{ ...resource }]` 배열 형식. 기존 `jsonApiResponse` 는 단일 resource. 별 헬퍼 추가.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/unit/documentation/jsonApiHelpers.test.ts` 의 마지막 `describe` 블록 다음에 추가:

```ts
    describe('jsonApiCollectionResponse', () => {
        it('컬렉션 응답: data 가 {Model} 의 배열로 ref 된다', () => {
            const resp = jsonApiCollectionResponse('User');
            expect(resp.type).toBe('object');
            expect(resp.required).toEqual(['data']);
            const data = (resp.properties as any).data;
            expect(data.type).toBe('array');
            expect(data.items).toEqual({ $ref: '#/components/schemas/User' });
        });

        it('meta 필드는 옵셔널 (필수 아님)', () => {
            const resp = jsonApiCollectionResponse('User');
            expect(resp.required).not.toContain('meta');
            expect((resp.properties as any).meta).toBeDefined();
        });
    });
```

import 라인도 갱신:
```ts
import {
    jsonApiBody,
    jsonApiResponse,
    jsonApiErrorResponse,
    jsonApiCollectionResponse,
} from '@lib/documentation/jsonApiHelpers';
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/unit/documentation/jsonApiHelpers.test.ts 2>&1 | tail -15
```
Expected: FAIL — `jsonApiCollectionResponse is not exported`.

- [ ] **Step 3: 구현 추가**

`src/core/lib/documentation/jsonApiHelpers.ts` 마지막에 추가:

```ts
/**
 * JSON:API 컬렉션 응답: data 가 {Model} 의 배열, meta 옵셔널.
 * GET / (index) 라우트가 사용.
 */
export function jsonApiCollectionResponse(modelName: string): OpenApiObjectSchema {
    return {
        type: 'object',
        required: ['data'],
        properties: {
            data: {
                type: 'array',
                items: { $ref: `#/components/schemas/${modelName}` },
            } as any,
            meta: {
                type: 'object',
            } as any,
        },
    };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/unit/documentation/jsonApiHelpers.test.ts 2>&1 | tail -15
```
Expected: PASS — 6 tests passed (기존 4 + 신규 2).

- [ ] **Step 5: 전체 회귀**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest --runInBand 2>&1 | tail -5
```
Expected: 213/213 TC PASS (211 + 2).

- [ ] **Step 6: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/documentation/jsonApiHelpers.ts tests/unit/documentation/jsonApiHelpers.test.ts && git commit -m "feat(docs): jsonApiCollectionResponse 헬퍼 추가 (index 응답)"
```

---

## Task 3: openApiBuilder 의 body/response detection (Schema vs OpenAPI)

**Files:**
- Modify: `E:\Projects\express.js-kusto\src\core\lib\documentation\openApiBuilder.ts`
- Modify: `E:\Projects\express.js-kusto\src\core\lib\documentationGenerator.ts` (RouteDocumentation 타입 widening)
- Modify: `E:\Projects\express.js-kusto\tests\unit\documentation\openApiBuilder.test.ts`

CRUD 의 `parameters.body / responses[code]` 가 이미 OpenAPI 형식 (validator Schema 가 아닌) 일 때 schemaToOpenApi 우회. M3b 의 헬퍼들이 만든 객체가 그대로 spec 에 들어가도록.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/unit/documentation/openApiBuilder.test.ts` 의 마지막 `it()` 다음에 추가:

```ts
        it('parameters.body 가 이미 OpenAPI 객체 schema 일 때 그대로 사용된다 ($ref 보존)', () => {
            const body = {
                type: 'object',
                required: ['data'],
                properties: {
                    data: { $ref: '#/components/schemas/UserAttributes' },
                },
            };
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'POST',
                    path: '/x',
                    contentType: 'jsonapi',
                    parameters: { body: body as any },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            const reqSchema = doc.paths['/x']?.post?.requestBody?.content?.['application/vnd.api+json']?.schema as any;
            expect(reqSchema.required).toEqual(['data']);
            expect(reqSchema.properties.data).toEqual({ $ref: '#/components/schemas/UserAttributes' });
        });

        it('responses[code] 가 이미 OpenAPI 객체 schema 일 때 그대로 사용된다 ($ref 보존)', () => {
            const responseSchema = {
                type: 'object',
                required: ['data'],
                properties: {
                    data: { $ref: '#/components/schemas/User' },
                },
            };
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/x',
                    contentType: 'jsonapi',
                    responses: { 200: responseSchema as any },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            const resSchema = doc.paths['/x']?.get?.responses['200']?.content?.['application/vnd.api+json']?.schema as any;
            expect(resSchema.required).toEqual(['data']);
            expect(resSchema.properties.data).toEqual({ $ref: '#/components/schemas/User' });
        });

        it('직접 $ref 만 있는 schema 도 그대로 통과한다', () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/x',
                    contentType: 'jsonapi',
                    responses: { 200: { $ref: '#/components/schemas/User' } as any },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            const resSchema = doc.paths['/x']?.get?.responses['200']?.content?.['application/vnd.api+json']?.schema;
            expect(resSchema).toEqual({ $ref: '#/components/schemas/User' });
        });
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/unit/documentation/openApiBuilder.test.ts 2>&1 | tail -25
```
Expected: FAIL — schemaToOpenApi 가 OpenAPI 객체를 잘못 변환해서 $ref 가 사라짐 또는 throw.

- [ ] **Step 3: openApiBuilder.ts 수정**

`src/core/lib/documentation/openApiBuilder.ts` 의 `RouteDocumentationLike` 타입과 `buildRequestBody / buildResponses` 를 다음과 같이 수정.

먼저 import 영역에 detection 함수가 사용할 타입이 이미 있음 (`OpenApiSchemaOrRef`).

`RouteDocumentationLike` 인터페이스를 다음으로 교체:

```ts
export interface RouteDocumentationLike {
    method: string;
    path: string;
    summary?: string;
    description?: string;
    parameters?: {
        query?: Schema;
        params?: Schema;
        body?: Schema | OpenApiSchemaOrRef;
    };
    responses?: Record<string | number, Schema | OpenApiSchemaOrRef>;
    tags?: string[];
    contentType?: ContentTypeMode;
}
```

파일에 detection 함수 추가 (다른 함수들 위, `buildParameters` 위에):

```ts
/**
 * 입력이 이미 OpenAPI schema 형태인지 감지.
 * - $ref 가 있으면 ref 객체.
 * - 또는 type 이 OpenAPI primitive 문자열이고 properties/items/oneOf 등의 OpenAPI 키가 있으면 schema.
 * 반대로 validator Schema 는 top-level 키가 필드명이고 type 키 자체가 보통 없음 (있어도 그 값은 객체).
 */
function isOpenApiSchemaShape(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    if (typeof v.$ref === 'string') return true;
    if (typeof v.type === 'string') {
        const t = v.type;
        if (t === 'object' || t === 'array' || t === 'string' || t === 'number' ||
            t === 'integer' || t === 'boolean' || t === 'null') {
            return true;
        }
    }
    if (Array.isArray(v.oneOf) || Array.isArray(v.allOf) || Array.isArray(v.anyOf)) return true;
    return false;
}
```

`buildRequestBody` 를 다음으로 교체:

```ts
function buildRequestBody(route: RouteDocumentationLike, mediaType: string): OpenApiRequestBody | undefined {
    if (!route.parameters?.body) return undefined;
    const body = route.parameters.body;
    const schema: OpenApiSchemaOrRef = isOpenApiSchemaShape(body)
        ? (body as OpenApiSchemaOrRef)
        : schemaToOpenApi(body as Schema);
    return {
        required: true,
        content: {
            [mediaType]: { schema },
        },
    };
}
```

`buildResponses` 를 다음으로 교체:

```ts
function buildResponses(route: RouteDocumentationLike, mediaType: string): Record<string, OpenApiResponse> {
    const out: Record<string, OpenApiResponse> = {};
    if (route.responses) {
        for (const [code, schema] of Object.entries(route.responses)) {
            const resolved: OpenApiSchemaOrRef = isOpenApiSchemaShape(schema)
                ? (schema as OpenApiSchemaOrRef)
                : schemaToOpenApi(schema as Schema);
            out[code] = {
                description: `Response ${code}`,
                content: {
                    [mediaType]: { schema: resolved },
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
```

- [ ] **Step 4: documentationGenerator.ts 의 RouteDocumentation 타입 widening**

기존 `interface RouteDocumentation` 의 parameters.body 와 responses 타입 widening. `src/core/lib/documentationGenerator.ts` 의 import 추가:

```ts
import {
    buildOpenApiDocument,
    OpenApiSchemaOrRef,
    OpenApiDocument,
    ContentTypeMode,
} from './documentation';
```

(이미 `OpenApiSchemaOrRef` 가 import 되어 있음. 변화 없거나 확인만.)

`interface RouteDocumentation` 을 다음으로 교체:

```ts
export interface RouteDocumentation {
    method: string;
    path: string;
    summary?: string;
    description?: string;
    parameters?: {
        query?: Schema;
        params?: Schema;
        body?: Schema | OpenApiSchemaOrRef;
    };
    responses?: ResponseConfig | Record<string | number, OpenApiSchemaOrRef>;
    tags?: string[];
    contentType?: ContentTypeMode;
}
```

`ResponseConfig` 는 기존 validator-style. union 으로 widening 하여 후속 CRUD 호출이 둘 다 가능하게 함.

- [ ] **Step 5: 테스트 통과 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/unit/documentation/openApiBuilder.test.ts 2>&1 | tail -25
```
Expected: PASS — 14 tests passed (기존 11 + 신규 3).

- [ ] **Step 6: 컴파일 + 전체 회귀**

Run:
```bash
cd /e/Projects/express.js-kusto && npx tsc --noEmit -p tsconfig.test.json 2>&1 | grep -E "documentation|expressRouter|openApiBuilder" | head -10
cd /e/Projects/express.js-kusto && npx jest --runInBand 2>&1 | tail -5
```
Expected: 0 컴파일 에러, 216/216 TC PASS (213 + 3).

- [ ] **Step 7: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/documentation/openApiBuilder.ts src/core/lib/documentationGenerator.ts tests/unit/documentation/openApiBuilder.test.ts && git commit -m "feat(docs): openApiBuilder 가 OpenAPI 형태 body/response 자동 감지 (\$ref pass-through)"
```

---

## Task 4: setupIndexRoute (GET /) 마이그레이션

**Files:**
- Modify: `E:\Projects\express.js-kusto\src\core\lib\expressRouter.ts` (setupIndexRoute 의 registerDocumentation 호출만)

기존 inline `data: { type: 'array' }` 를 `jsonApiCollectionResponse(modelName)` 로, 400 응답을 `jsonApiErrorResponse(400)` 로 치환.

- [ ] **Step 1: import 추가**

`src/core/lib/expressRouter.ts` 의 documentation import 라인을 다음과 같이 확장 (기존 `syncSchemasFromAnalyzer, registerJsonApiErrorSchema` import 와 함께):

```ts
import {
    syncSchemasFromAnalyzer,
    registerJsonApiErrorSchema,
    jsonApiCollectionResponse,
    jsonApiResponse,
    jsonApiBody,
    jsonApiErrorResponse,
} from './documentation';
```

- [ ] **Step 2: setupIndexRoute 의 registerDocumentation 호출 교체**

기존 코드 (line ~2866):

```ts
        this.registerDocumentation('GET', '/', {
            summary: `Get ${modelName} list with required pagination, optional filtering and sorting`,
            parameters: {
                query: queryParams
            },
            responses: {
                200: {
                    data: { type: 'array', required: true, description: `Array of ${modelName} items` },
                    meta: { type: 'object', required: true, description: 'Pagination metadata' }
                },
                400: {
                    error: { type: 'object', required: true, description: 'Bad request - pagination parameters are required' }
                }
            }
        });
```

이걸 다음으로 교체:

```ts
        this.registerDocumentation('GET', '/', {
            summary: `Get ${modelName} list with required pagination, optional filtering and sorting`,
            parameters: {
                query: queryParams
            },
            responses: {
                200: jsonApiCollectionResponse(modelName),
                400: jsonApiErrorResponse(400),
            }
        });
```

- [ ] **Step 3: 컴파일 + 회귀 테스트**

Run:
```bash
cd /e/Projects/express.js-kusto && npx tsc --noEmit -p tsconfig.test.json 2>&1 | grep -E "expressRouter" | head -10
cd /e/Projects/express.js-kusto && npx jest --runInBand 2>&1 | tail -5
```
Expected: 0 에러, 216/216 TC PASS (변경 없음).

- [ ] **Step 4: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/expressRouter.ts && git commit -m "refactor(docs): setupIndexRoute inline → \$ref (jsonApiCollectionResponse)"
```

---

## Task 5: setupShowRoute (GET /:id) 마이그레이션

**Files:**
- Modify: `E:\Projects\express.js-kusto\src\core\lib\expressRouter.ts` (setupShowRoute 의 registerDocumentation 호출만)

200 응답을 `jsonApiResponse(modelName, 200)` 로, 404 와 410 (soft delete) 을 `jsonApiErrorResponse` 로 치환.

- [ ] **Step 1: setupShowRoute 의 registerDocumentation 부분 교체**

기존 코드 (line ~3088 부근의 `responses` 객체):

```ts
        const responses: any = {
            200: {
                data: { type: 'object', required: true, description: `${modelName} object` }
            },
            404: {
                error: { type: 'object', required: true, description: 'Not found error' }
            }
        };
        
        // Soft delete가 설정된 경우 410 Gone 응답 추가
        if (isSoftDelete) {
            responses[410] = {
                error: { type: 'object', required: true, description: 'Resource has been soft deleted' }
            };
        }
        
        this.registerDocumentation('GET', routePath, {
            summary: `Get single ${modelName} by ${primaryKey}`,
            parameters: {
                params: {
                    [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                },
                query: queryParams
            },
            responses: responses
        });
```

이걸 다음으로 교체:

```ts
        const responses: any = {
            200: jsonApiResponse(modelName, 200),
            404: jsonApiErrorResponse(404),
        };
        
        // Soft delete가 설정된 경우 410 Gone 응답 추가
        if (isSoftDelete) {
            responses[410] = jsonApiErrorResponse(410);
        }
        
        this.registerDocumentation('GET', routePath, {
            summary: `Get single ${modelName} by ${primaryKey}`,
            parameters: {
                params: {
                    [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                },
                query: queryParams
            },
            responses: responses
        });
```

- [ ] **Step 2: 회귀 테스트**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest --runInBand 2>&1 | tail -5
```
Expected: 216/216 TC PASS.

- [ ] **Step 3: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/expressRouter.ts && git commit -m "refactor(docs): setupShowRoute inline → \$ref (jsonApiResponse + jsonApiErrorResponse)"
```

---

## Task 6: setupCreateRoute (POST /) 마이그레이션

**Files:**
- Modify: `E:\Projects\express.js-kusto\src\core\lib\expressRouter.ts` (setupCreateRoute 의 registerDocumentation 호출만)

body 를 `jsonApiBody(modelName, 'create')` 로, response 를 `jsonApiResponse(modelName, 201)` + 400/422 을 `jsonApiErrorResponse` 로.

- [ ] **Step 1: setupCreateRoute 의 registerDocumentation 부분 교체**

기존 코드 (line ~3316):

```ts
        // 문서화 등록
        this.registerDocumentation('POST', '/', {
            summary: `Create new ${modelName} (JSON:API)`,
            parameters: {
                body: {
                    type: 'object',
                    required: true,
                    description: 'JSON:API resource object with optional relationships',
                    properties: {
                        data: {
                            type: 'object',
                            required: true,
                            properties: {
                                type: { type: 'string', required: true, description: 'Resource type' },
                                id: { type: 'string', required: false, description: 'Client-generated ID (optional)' },
                                attributes: options?.validation?.create?.body || 
                                          { type: 'object', required: true, description: `${modelName} attributes` },
                                relationships: { 
                                    type: 'object', 
                                    required: false, 
                                    description: 'JSON:API relationships object with data containing resource identifiers' 
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                201: {
                    data: { type: 'object', required: true, description: `Created ${modelName} resource` }
                },
                400: {
                    errors: { type: 'array', required: true, description: 'JSON:API error objects' }
                },
                422: {
                    errors: { type: 'array', required: true, description: 'JSON:API validation errors including relationship errors' }
                }
            }
        });
```

이걸 다음으로 교체:

```ts
        // 문서화 등록 (JSON:API ref 사용)
        this.registerDocumentation('POST', '/', {
            summary: `Create new ${modelName} (JSON:API)`,
            parameters: {
                body: jsonApiBody(modelName, 'create'),
            },
            responses: {
                201: jsonApiResponse(modelName, 201),
                400: jsonApiErrorResponse(400),
                422: jsonApiErrorResponse(422),
            }
        });
```

`options?.validation?.create?.body` 가 사용자 정의 attribute 검증인 경우, 본 마이그레이션은 그것을 단순 무시. M3b 의 design 결정: 사용자 검증 schema 는 **runtime 검증** 에 사용되지만 spec 의 attributes 는 DMMF 가 SSOT. 사용자 검증과 DMMF 가 다르면 spec 이 DMMF 측 우선. M4 또는 별도에서 해결.

- [ ] **Step 2: 회귀 테스트**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest --runInBand 2>&1 | tail -5
```
Expected: 216/216 TC PASS.

- [ ] **Step 3: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/expressRouter.ts && git commit -m "refactor(docs): setupCreateRoute inline → \$ref (jsonApiBody + jsonApiResponse + jsonApiErrorResponse)"
```

---

## Task 7: setupUpdateRoute (PUT/PATCH /:id) 마이그레이션

**Files:**
- Modify: `E:\Projects\express.js-kusto\src\core\lib\expressRouter.ts` (setupUpdateRoute 의 registerDocumentation 호출만)

PUT 과 PATCH 둘 다 동일 등록. body 를 `jsonApiBody(modelName, 'update')` 로, 응답들을 헬퍼로.

- [ ] **Step 1: setupUpdateRoute 의 registerDocumentation 부분 교체**

기존 코드 (line ~4264):

```ts
        // 문서화 등록 (PUT/PATCH 동일) - JSON:API 형식
        ['PUT', 'PATCH'].forEach(method => {
            this.registerDocumentation(method, routePath, {
                summary: `Update ${modelName} by ${primaryKey} (JSON:API)`,
                parameters: {
                    params: {
                        [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                    },
                    body: {
                        type: 'object',
                        required: true,
                        description: 'JSON:API resource object with optional relationships',
                        properties: {
                            data: {
                                type: 'object',
                                required: true,
                                properties: {
                                    type: { type: 'string', required: true, description: 'Resource type' },
                                    id: { type: 'string', required: false, description: 'Resource ID (must match URL parameter)' },
                                    attributes: options?.validation?.update?.body || 
                                              { type: 'object', required: true, description: `${modelName} attributes to update` },
                                    relationships: { 
                                        type: 'object', 
                                        required: false, 
                                        description: 'JSON:API relationships object for updating related resources (set/connect/disconnect)' 
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        data: { type: 'object', required: true, description: `Updated ${modelName} resource` }
                    },
                    404: {
                        errors: { type: 'array', required: true, description: 'JSON:API error objects' }
                    },
                    400: {
                        errors: { type: 'array', required: true, description: 'JSON:API error objects' }
                    },
                    422: {
                        errors: { type: 'array', required: true, description: 'JSON:API validation errors including relationship errors' }
                    }
                }
            });
        });
```

이걸 다음으로 교체:

```ts
        // 문서화 등록 (PUT/PATCH 동일) - JSON:API ref
        ['PUT', 'PATCH'].forEach(method => {
            this.registerDocumentation(method, routePath, {
                summary: `Update ${modelName} by ${primaryKey} (JSON:API)`,
                parameters: {
                    params: {
                        [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                    },
                    body: jsonApiBody(modelName, 'update'),
                },
                responses: {
                    200: jsonApiResponse(modelName, 200),
                    400: jsonApiErrorResponse(400),
                    404: jsonApiErrorResponse(404),
                    422: jsonApiErrorResponse(422),
                }
            });
        });
```

- [ ] **Step 2: 회귀 테스트**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest --runInBand 2>&1 | tail -5
```
Expected: 216/216 TC PASS.

- [ ] **Step 3: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/expressRouter.ts && git commit -m "refactor(docs): setupUpdateRoute (PUT/PATCH) inline → \$ref"
```

---

## Task 8: setupDestroyRoute (DELETE /:id) 마이그레이션

**Files:**
- Modify: `E:\Projects\express.js-kusto\src\core\lib\expressRouter.ts` (setupDestroyRoute 의 registerDocumentation 호출만)

soft delete 의 200 응답 (meta 포함) 와 hard delete 의 204 응답은 그대로 두고 (둘 다 OpenAPI 표준 호환), 404 만 `jsonApiErrorResponse` 로.

204 응답에는 content 가 없는 것이 정확함 — 헬퍼 안 거침.

- [ ] **Step 1: setupDestroyRoute 의 registerDocumentation 부분 교체**

기존 코드 (line ~4447):

```ts
        const deleteResponses = isSoftDelete ? {
            200: {
                meta: { type: 'object', required: true, description: 'Soft delete metadata with timestamp' }
            },
            404: {
                errors: { type: 'array', required: true, description: 'JSON:API error objects' }
            }
        } : {
            204: {
                description: 'Successfully deleted (no content)'
            },
            404: {
                errors: { type: 'array', required: true, description: 'JSON:API error objects' }
            }
        };
        
        this.registerDocumentation('DELETE', routePath, {
            summary: deleteDescription,
            parameters: {
                params: {
                    [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                }
            },
            responses: deleteResponses
        });
```

이걸 다음으로 교체:

```ts
        const deleteResponses: any = isSoftDelete ? {
            200: {
                type: 'object',
                required: ['meta'],
                properties: {
                    meta: { type: 'object' },
                },
            },
            404: jsonApiErrorResponse(404),
        } : {
            204: {
                type: 'object',
                description: 'Successfully deleted (no content)',
            },
            404: jsonApiErrorResponse(404),
        };
        
        this.registerDocumentation('DELETE', routePath, {
            summary: deleteDescription,
            parameters: {
                params: {
                    [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                }
            },
            responses: deleteResponses
        });
```

200 (soft delete 응답) 는 OpenAPI 객체 형태로 인라인 — `data` 가 아니라 `meta` 만 있는 특수 케이스이므로 헬퍼 없이 직접. 204 도 마찬가지 (body 없음, type 만 있는 placeholder).

- [ ] **Step 2: 회귀 테스트**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest --runInBand 2>&1 | tail -5
```
Expected: 216/216 TC PASS.

- [ ] **Step 3: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/expressRouter.ts && git commit -m "refactor(docs): setupDestroyRoute 404 → jsonApiErrorResponse, 200/204 OpenAPI 형식 인라인"
```

---

## Task 9: setupRecoverRoute (POST /:id/recover) 마이그레이션

**Files:**
- Modify: `E:\Projects\express.js-kusto\src\core\lib\expressRouter.ts` (setupRecoverRoute 의 registerDocumentation 호출만)

200 응답을 `jsonApiResponse(modelName, 200)` 로 (data 만), 404/409 를 `jsonApiErrorResponse` 로. body 는 옵셔널이므로 사용자 검증 schema 가 있으면 그것을, 없으면 undefined.

- [ ] **Step 1: setupRecoverRoute 의 registerDocumentation 부분 교체**

기존 코드 (line ~4611):

```ts
        // 문서화 등록 - JSON:API 형식
        this.registerDocumentation('POST', routePath, {
            summary: `Recover soft-deleted ${modelName} by ${primaryKey} (JSON:API)`,
            parameters: {
                params: {
                    [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                },
                body: options?.validation?.recover?.body || undefined
            },
            responses: {
                200: {
                    data: { type: 'object', required: true, description: `Recovered ${modelName} resource` },
                    meta: { 
                        type: 'object', 
                        required: true, 
                        description: 'Recovery operation metadata' 
                    }
                },
                404: {
                    errors: { type: 'array', required: true, description: 'JSON:API error objects' }
                },
                409: {
                    errors: { type: 'array', required: true, description: 'JSON:API error objects' }
                }
            }
        });
```

이걸 다음으로 교체:

```ts
        // 문서화 등록 - JSON:API ref
        this.registerDocumentation('POST', routePath, {
            summary: `Recover soft-deleted ${modelName} by ${primaryKey} (JSON:API)`,
            parameters: {
                params: {
                    [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                },
                body: options?.validation?.recover?.body || undefined
            },
            responses: {
                200: jsonApiResponse(modelName, 200),
                404: jsonApiErrorResponse(404),
                409: jsonApiErrorResponse(409),
            }
        });
```

`meta` 필드는 `jsonApiResponse` 가 갖지 않음. recovery 메타데이터가 spec 에는 안 보이지만 actual 응답에는 포함됨 — 향후 jsonApiResponse 가 옵셔널 meta 를 받게 확장하거나 별도 helper. 본 phase 는 단순화.

- [ ] **Step 2: 회귀 테스트**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest --runInBand 2>&1 | tail -5
```
Expected: 216/216 TC PASS.

- [ ] **Step 3: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/expressRouter.ts && git commit -m "refactor(docs): setupRecoverRoute inline → \$ref"
```

---

## Task 10: 통합 테스트 확장 — $ref 사용 검증 + swagger-parser still passes

**Files:**
- Modify: `E:\Projects\express.js-kusto\tests\integration\documentation\crud-jsonapi-spec.test.ts`

새 통합 테스트: 실제 CRUD 라우트가 등록한 spec 에 `$ref` 가 사용되는지 + swagger-parser validate 가 schemas 가 등록된 상태에서도 통과하는지.

- [ ] **Step 1: 신규 TC 추가**

기존 `crud-jsonapi-spec.test.ts` 의 마지막 `it` 다음에 추가:

```ts
    it('CRUD setup 메서드의 등록 후 spec 의 paths 에 \$ref 가 등장한다', async () => {
        // Sync 가 component schemas 를 채움 시뮬레이션
        DocumentationGenerator.registerSchema('User', {
            type: 'object',
            properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                attributes: { type: 'object' },
            },
        });
        DocumentationGenerator.registerSchema('UserAttributes', {
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
        });
        DocumentationGenerator.registerSchema('UserRelationships', {
            type: 'object',
            properties: {},
        });
        DocumentationGenerator.registerSchema('JsonApiError', {
            type: 'object',
            required: ['errors'],
            properties: { errors: { type: 'array' } },
        });

        // Direct register simulating what CRUD setup methods now produce
        DocumentationGenerator.registerRoute({
            method: 'POST',
            path: '/users',
            contentType: 'jsonapi',
            parameters: {
                body: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                        data: {
                            type: 'object',
                            required: ['type', 'attributes'],
                            properties: {
                                type: { type: 'string' },
                                id: { type: 'string' },
                                attributes: { $ref: '#/components/schemas/UserAttributes' },
                                relationships: { $ref: '#/components/schemas/UserRelationships' },
                            },
                        },
                    },
                } as any,
            },
            responses: {
                201: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/User' } },
                } as any,
                422: {
                    type: 'object',
                    required: ['errors'],
                    properties: { errors: { $ref: '#/components/schemas/JsonApiError' } },
                } as any,
            },
        });

        const spec = DocumentationGenerator.generateOpenAPISpec();
        const op = spec.paths['/users']?.post;

        // body 의 attributes 가 \$ref 보존
        const reqSchema = op?.requestBody?.content?.['application/vnd.api+json']?.schema as any;
        expect(reqSchema.properties.data.properties.attributes).toEqual({
            $ref: '#/components/schemas/UserAttributes',
        });

        // 201 응답의 data 가 \$ref 보존
        const resSchema = op?.responses?.['201']?.content?.['application/vnd.api+json']?.schema as any;
        expect(resSchema.properties.data).toEqual({ $ref: '#/components/schemas/User' });

        // 422 응답의 errors 가 JsonApiError 로 \$ref 보존
        const errSchema = op?.responses?.['422']?.content?.['application/vnd.api+json']?.schema as any;
        expect(errSchema.properties.errors).toEqual({ $ref: '#/components/schemas/JsonApiError' });

        // swagger-parser validate 가 components.schemas 가 등록된 상태에서도 통과
        await expect(SwaggerParser.validate(spec as any)).resolves.toBeDefined();
    });
```

- [ ] **Step 2: 테스트 실행**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/integration/documentation/crud-jsonapi-spec.test.ts --runInBand 2>&1 | tail -20
```
Expected: PASS — 6 tests passed (기존 5 + 신규 1).

- [ ] **Step 3: 전체 회귀**

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest --runInBand 2>&1 | tail -5
```
Expected: 217/217 TC PASS (216 + 1).

- [ ] **Step 4: 커밋**

```bash
cd /e/Projects/express.js-kusto && git add tests/integration/documentation/crud-jsonapi-spec.test.ts && git commit -m "test(docs): CRUD spec 의 \$ref 사용 검증 + swagger-parser validate 통합"
```

---

## Task 11: smoke 검증 + 누적 push

**Files:** (수정 없음, 검증만)

- [ ] **Step 1: smoke 스크립트 — 실제 mock CRUD 등록 + spec 의 $ref 확인**

```bash
cd /e/Projects/express.js-kusto && cat > smoke-m3b.js << 'EOF'
process.env.NODE_ENV = 'development';
process.env.AUTO_DOCS = 'true';

require('module-alias/register');
require('ts-node/register/transpile-only');

const { DocumentationGenerator } = require('./src/core/lib/documentationGenerator');
const { syncSchemasFromAnalyzer, registerJsonApiErrorSchema } = require('./src/core/lib/documentation');

DocumentationGenerator.reset();

const mockAnalyzer = {
    getDatabaseName: () => 'default',
    getAllModels: () => [{
        name: 'User',
        fields: [
            { name: 'id', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: true, isReadOnly: false, isGenerated: true, isUpdatedAt: false },
            { name: 'email', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: true, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
        ],
        relations: [],
        indexes: [],
        uniqueConstraints: [],
        primaryKey: { fields: ['id'] },
    }],
    isEnumType: () => false,
    getEnumValues: () => undefined,
};

syncSchemasFromAnalyzer(mockAnalyzer, 'default');
registerJsonApiErrorSchema();

// CRUD 의 setupCreateRoute 호출 후 등록될 라우트 시뮬레이션
const { jsonApiBody, jsonApiResponse, jsonApiErrorResponse } = require('./src/core/lib/documentation');

DocumentationGenerator.registerRoute({
    method: 'POST',
    path: '/users',
    contentType: 'jsonapi',
    summary: 'Create new User (JSON:API)',
    parameters: {
        body: jsonApiBody('User', 'create'),
    },
    responses: {
        201: jsonApiResponse('User', 201),
        422: jsonApiErrorResponse(422),
    },
});

const spec = DocumentationGenerator.generateOpenAPISpec();
const op = spec.paths['/users'].post;

console.log('openapi:', spec.openapi);
console.log('schemas:', JSON.stringify(Object.keys(spec.components.schemas).sort()));
console.log('UserAttributes has id?', !!spec.components.schemas.UserAttributes.properties.id);
const body = op.requestBody.content['application/vnd.api+json'].schema;
console.log('body.data.attributes:', JSON.stringify(body.properties.data.properties.attributes));
const res = op.responses['201'].content['application/vnd.api+json'].schema;
console.log('201.data:', JSON.stringify(res.properties.data));
const err = op.responses['422'].content['application/vnd.api+json'].schema;
console.log('422.errors:', JSON.stringify(err.properties.errors));
EOF
node smoke-m3b.js 2>&1 | grep -v "DEBUG\|tslib"
rm -f smoke-m3b.js
```

Expected:
- `openapi: 3.1.0`
- `schemas: ["JsonApiError","User","UserAttributes","UserRelationships"]`
- `UserAttributes has id? false` (T1 의 fix 가 적용됨)
- `body.data.attributes: {"$ref":"#/components/schemas/UserAttributes"}`
- `201.data: {"$ref":"#/components/schemas/User"}`
- `422.errors: {"$ref":"#/components/schemas/JsonApiError"}`

- [ ] **Step 2: working tree 상태 확인**

Run:
```bash
cd /e/Projects/express.js-kusto && git status && git log --oneline ver/0.1.47 ^origin/ver/0.1.47 2>&1 | head -15
```
Expected: working tree clean, M3b 의 commit 들 (Task 1~10 = 10개) 이 origin 보다 앞.

- [ ] **Step 3: push**

```bash
cd /e/Projects/express.js-kusto && git push origin ver/0.1.47 2>&1 | tail -5
```
Expected: push 성공.

---

## 자기 점검 (Self-review)

- **Spec § 5.4 jsonApiBody/Response/ErrorResponse 헬퍼 사용**: Tasks 4–9 가 6개 setup 메서드에서 모두 사용 ✓
- **Spec § 9 M3 의 "CRUD 28개 호출 site 의 inline 스키마 → 헬퍼 점진 치환. GET/POST/PUT/PATCH/DELETE 단위로 나눔"**: Tasks 4 (GET/), 5 (GET/:id), 6 (POST/), 7 (PUT/PATCH), 8 (DELETE), 9 (POST recover) — 6개 task 로 분할 ✓
- **메모리에 적힌 isId fallback**: Task 1 ✓
- **Atomic Operations / Relationship 라우트**: 본 phase 에 비포함 (별도 plan). 명시 ✓

**Placeholder scan**: 0건.

**Type 일관성**: 
- `jsonApiCollectionResponse` (Task 2) ↔ Task 4 사용. ✓
- `OpenApiSchemaOrRef` (M1 정의) ↔ Tasks 3, 4, 6, 7 의 type widening. ✓
- detection 함수 `isOpenApiSchemaShape` (Task 3) ↔ buildRequestBody/buildResponses 둘 다 호출. ✓

**검증 chain**: Task 3 의 detection 이 Task 4–9 의 모든 새 인라인 ($ref 포함) 을 통과시켜야 함. Task 10 의 swagger-parser validate 가 chain 의 정확성을 최종 보증.

**비결정성**: 일부 라우트의 사용자 검증 schema (`options?.validation?.create?.body` 등) 는 본 phase 에서 무시됨. spec 은 DMMF 기반 SSOT — 사용자 검증과 다르면 spec 이 우선. M4 또는 별도 plan 에서 사용자 schema 와 spec 분리/통합 검토.

---

## 완료 기준 (Definition of Done)

- 모든 11 task 의 체크박스 체크.
- `npx jest --runInBand` PASS — 217 TC (M3 의 208 + 신규 9 = 217).
- `npx tsc --noEmit -p tsconfig.test.json` 0 에러.
- smoke (Task 11) 가 spec 의 `$ref` 사용 + UserAttributes 에서 id 제외 확인.
- swagger-parser validate 가 schemas 등록된 spec 에서도 통과 (Task 10).
- Git log 에 10개의 의미 단위 commit + 1 plan commit.
- branch `ver/0.1.47` push 완료.
