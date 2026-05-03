# Documentation System Enhancement — Phase 1 (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec A (Documentation 강화) 의 변환 layer 8개 모듈 + OpenAPI 공통 타입 + `documentationGenerator.ts` 내부 refactor 를 완료. **외부 동작 변화 0** — 기존 `/docs/openapi.json` 응답이 byte-for-byte 동일해야 함 (path/content-type/3.1 업그레이드는 M2 에서).

**Architecture:** Pure functions 위주의 신규 모듈 8개 (`src/core/lib/documentation/`) 를 작성하고, 기존 `documentationGenerator.ts` 의 정적 메서드들이 새 모듈을 호출하도록 내부 교체. Public API 시그니처 유지. 모든 신규 모듈은 export pure functions 로 단위 테스트 가능.

**Tech Stack:** TypeScript, Jest (ts-jest), Prisma (DMMF read-only), Node.js 18+. 신규 외부 라이브러리 0.

**Spec 참조:** `docs/superpowers/specs/2026-05-04-documentation-system-enhancement-design.md` (섹션 5 Components, 9 M1).

**비포함 (다음 phase)**: M2 (path/content-type/3.1 활성화), M3 (DMMF sync · CRUD $ref), M4 (운영 — info/servers/IP 가드/export), M5 (정리). 본 plan 은 foundation 만.

---

## File Structure

### Create

| 경로 | 책임 |
|---|---|
| `src/core/lib/documentation/openApiTypes.ts` | OpenAPI 3.1 타입 (Schema/Info/Server/Document 등) — `any` 박멸 |
| `src/core/lib/documentation/pathConverter.ts` | Express path → OpenAPI path 변환 |
| `src/core/lib/documentation/contentTypeRule.ts` | json/jsonapi mode → media type 결정 |
| `src/core/lib/documentation/infoSource.ts` | OpenAPI info 빌드 (env + package.json fallback) |
| `src/core/lib/documentation/serversSource.ts` | OpenAPI servers 빌드 (env + fallback) |
| `src/core/lib/documentation/schemaConverter.ts` | validator FieldSchema → OpenAPI schema |
| `src/core/lib/documentation/dmmfToOpenApi.ts` | PrismaModelInfo → OpenAPI schema |
| `src/core/lib/documentation/jsonApiSchemas.ts` | JSON:API 3변형 + JsonApiError schema |
| `src/core/lib/documentation/openApiBuilder.ts` | 최종 OpenAPI document 빌더 (orchestrator) |
| `src/core/lib/documentation/index.ts` | Barrel export |
| `tests/unit/documentation/pathConverter.test.ts` | smoke |
| `tests/unit/documentation/contentTypeRule.test.ts` | smoke |
| `tests/unit/documentation/infoSource.test.ts` | smoke |
| `tests/unit/documentation/serversSource.test.ts` | smoke |
| `tests/unit/documentation/schemaConverter.test.ts` | smoke |
| `tests/unit/documentation/dmmfToOpenApi.test.ts` | smoke |
| `tests/unit/documentation/jsonApiSchemas.test.ts` | smoke |
| `tests/unit/documentation/openApiBuilder.test.ts` | smoke |

### Modify

| 경로 | 변경 |
|---|---|
| `src/core/lib/documentationGenerator.ts` | 내부 변환 메서드 (`convertSchemaToOpenAPI`, `convertFieldSchemaToOpenAPI`) 삭제 → 새 모듈 호출. Public 정적 API 시그니처 보존. `'3.0.0'` → 본 phase 에서는 그대로 유지 (M2 에서 변경) |

---

## Task 1: OpenAPI 3.1 공용 타입 모듈

**Files:**
- Create: `src/core/lib/documentation/openApiTypes.ts`

후속 모든 모듈이 이 타입을 사용. 기존 `documentationGenerator.ts` 의 `Record<string, any>` 도 점진적으로 이걸로 교체.

- [ ] **Step 1: 타입 모듈 생성 (TDD 면제 — 타입만 정의, 동작 없음)**

```ts
// src/core/lib/documentation/openApiTypes.ts

/**
 * OpenAPI 3.1.0 — JSON Schema 2020-12 정렬.
 * 본 프레임워크가 생성·소비하는 형태에 맞춘 부분 타입.
 * 전체 spec: https://spec.openapis.org/oas/v3.1.0
 */

export type OpenApiPrimitiveType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

export interface OpenApiSchema {
    type?: OpenApiPrimitiveType | OpenApiPrimitiveType[];
    format?: string;
    description?: string;
    enum?: unknown[];
    example?: unknown;
    examples?: unknown[];
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    properties?: Record<string, OpenApiSchema | OpenApiRef>;
    required?: string[];
    items?: OpenApiSchema | OpenApiRef;
    additionalProperties?: boolean | OpenApiSchema | OpenApiRef;
    nullable?: boolean;  // OpenAPI 3.0 호환 잔재 — 3.1 에서는 type union 권장
    $ref?: string;
    oneOf?: Array<OpenApiSchema | OpenApiRef>;
    allOf?: Array<OpenApiSchema | OpenApiRef>;
    anyOf?: Array<OpenApiSchema | OpenApiRef>;
}

export interface OpenApiRef {
    $ref: string;
}

export type OpenApiSchemaOrRef = OpenApiSchema | OpenApiRef;

export interface OpenApiObjectSchema extends OpenApiSchema {
    type: 'object';
    properties: Record<string, OpenApiSchemaOrRef>;
}

export interface OpenApiInfo {
    title: string;
    version: string;
    description?: string;
    termsOfService?: string;
    contact?: { name?: string; url?: string; email?: string };
    license?: { name: string; url?: string };
}

export interface OpenApiServer {
    url: string;
    description?: string;
    variables?: Record<string, { default: string; enum?: string[]; description?: string }>;
}

export interface OpenApiParameter {
    name: string;
    in: 'query' | 'path' | 'header' | 'cookie';
    description?: string;
    required?: boolean;
    schema?: OpenApiSchemaOrRef;
    example?: unknown;
}

export interface OpenApiMediaTypeObject {
    schema?: OpenApiSchemaOrRef;
    example?: unknown;
    examples?: Record<string, { value: unknown; summary?: string }>;
}

export interface OpenApiRequestBody {
    description?: string;
    required?: boolean;
    content: Record<string, OpenApiMediaTypeObject>;
}

export interface OpenApiResponse {
    description: string;
    content?: Record<string, OpenApiMediaTypeObject>;
    headers?: Record<string, OpenApiSchemaOrRef>;
}

export interface OpenApiOperation {
    summary?: string;
    description?: string;
    operationId?: string;
    tags?: string[];
    parameters?: OpenApiParameter[];
    requestBody?: OpenApiRequestBody;
    responses: Record<string, OpenApiResponse>;
    deprecated?: boolean;
}

export type OpenApiPathItem = Partial<Record<'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head', OpenApiOperation>> & {
    parameters?: OpenApiParameter[];
};

export interface OpenApiComponents {
    schemas?: Record<string, OpenApiSchemaOrRef>;
    parameters?: Record<string, OpenApiParameter>;
    responses?: Record<string, OpenApiResponse>;
    requestBodies?: Record<string, OpenApiRequestBody>;
}

export interface OpenApiDocument {
    openapi: string;
    info: OpenApiInfo;
    servers?: OpenApiServer[];
    paths: Record<string, OpenApiPathItem>;
    components?: OpenApiComponents;
}

/** 등록되는 path/method/스키마의 contentType 결정에 사용 */
export type ContentTypeMode = 'json' | 'jsonapi';
```

- [ ] **Step 2: 타입만 컴파일되는지 확인**

Run:
```bash
npx tsc --noEmit -p tsconfig.test.json 2>&1 | grep -E "openApiTypes|documentation/" | head -5
```
Expected: 0건 (타입 에러 없음, 다른 모듈에서 import 안 했으므로).

- [ ] **Step 3: 커밋**

```bash
git add src/core/lib/documentation/openApiTypes.ts
git commit -m "feat(docs): OpenAPI 3.1 공용 타입 모듈 추가"
```

---

## Task 2: pathConverter (Express path → OpenAPI path)

**Files:**
- Create: `src/core/lib/documentation/pathConverter.ts`
- Test: `tests/unit/documentation/pathConverter.test.ts`

가장 단순한 모듈, 의존성 0. TDD 패턴 확립 목적도 겸함.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/documentation/pathConverter.test.ts
import { toOpenApiPath } from '@lib/documentation/pathConverter';

describe('pathConverter', () => {
    describe('toOpenApiPath', () => {
        it('파라미터가 없는 path 일 때 그대로 반환된다', () => {
            const result = toOpenApiPath('/users');
            expect(result).toEqual({ path: '/users', parameters: [] });
        });

        it(':id 형식의 단일 파라미터일 때 {id} 로 변환된다', () => {
            const result = toOpenApiPath('/users/:id');
            expect(result.path).toBe('/users/{id}');
            expect(result.parameters).toEqual([{ name: 'id' }]);
        });

        it('중첩된 :userId/:postId 일 때 둘 다 {} 로 변환된다', () => {
            const result = toOpenApiPath('/users/:userId/posts/:postId');
            expect(result.path).toBe('/users/{userId}/posts/{postId}');
            expect(result.parameters).toEqual([
                { name: 'userId' },
                { name: 'postId' },
            ]);
        });

        it('루트 / 일 때 그대로 반환된다', () => {
            const result = toOpenApiPath('/');
            expect(result).toEqual({ path: '/', parameters: [] });
        });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
npx jest tests/unit/documentation/pathConverter.test.ts -v 2>&1 | tail -20
```
Expected: FAIL — `Cannot find module '@lib/documentation/pathConverter'`.

- [ ] **Step 3: 구현 작성**

```ts
// src/core/lib/documentation/pathConverter.ts

export interface PathConversionResult {
    path: string;
    parameters: Array<{
        name: string;
        pattern?: string;
        isWildcard?: boolean;
    }>;
}

/**
 * Express 라우터 경로 표기를 OpenAPI 3.1 경로 표기로 변환한다.
 * - `:foo` → `{foo}`
 * - 추출된 파라미터들의 메타데이터도 함께 반환.
 *
 * 본 phase (M1) 에서는 단순 :name 만 처리. regex param (:^name) 과
 * wildcard (..[^name]) 는 후속 phase 에서 확장.
 */
export function toOpenApiPath(expressPath: string): PathConversionResult {
    const parameters: PathConversionResult['parameters'] = [];

    const path = expressPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
        parameters.push({ name });
        return `{${name}}`;
    });

    return { path, parameters };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
npx jest tests/unit/documentation/pathConverter.test.ts -v 2>&1 | tail -15
```
Expected: PASS — 4 tests passed.

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/documentation/pathConverter.ts tests/unit/documentation/pathConverter.test.ts
git commit -m "feat(docs): pathConverter 구현 (:foo → {foo})"
```

---

## Task 3: contentTypeRule (json/jsonapi → media type)

**Files:**
- Create: `src/core/lib/documentation/contentTypeRule.ts`
- Test: `tests/unit/documentation/contentTypeRule.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/documentation/contentTypeRule.test.ts
import { mediaTypeFor } from '@lib/documentation/contentTypeRule';

describe('contentTypeRule', () => {
    describe('mediaTypeFor', () => {
        it("'json' 일 때 application/json 을 반환한다", () => {
            expect(mediaTypeFor('json')).toBe('application/json');
        });

        it("'jsonapi' 일 때 application/vnd.api+json 을 반환한다", () => {
            expect(mediaTypeFor('jsonapi')).toBe('application/vnd.api+json');
        });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/unit/documentation/contentTypeRule.test.ts -v 2>&1 | tail -10`
Expected: FAIL — `Cannot find module ...`

- [ ] **Step 3: 구현**

```ts
// src/core/lib/documentation/contentTypeRule.ts
import { ContentTypeMode } from './openApiTypes';

/**
 * OpenAPI requestBody/response.content 의 media type 키를 결정한다.
 * - 'json'    → 'application/json'         (일반 라우트)
 * - 'jsonapi' → 'application/vnd.api+json' (CRUD 가 등록한 JSON:API 라우트)
 */
export function mediaTypeFor(mode: ContentTypeMode): string {
    return mode === 'jsonapi' ? 'application/vnd.api+json' : 'application/json';
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/unit/documentation/contentTypeRule.test.ts -v 2>&1 | tail -10`
Expected: PASS — 2 tests passed.

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/documentation/contentTypeRule.ts tests/unit/documentation/contentTypeRule.test.ts
git commit -m "feat(docs): contentTypeRule 구현"
```

---

## Task 4: infoSource (env + package.json → info)

**Files:**
- Create: `src/core/lib/documentation/infoSource.ts`
- Test: `tests/unit/documentation/infoSource.test.ts`

본 phase 에서는 함수 시그니처 + 동작만 정착. `package.json` 자동 로드 wiring (Core.ts 호출 측) 은 M4 에서.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/documentation/infoSource.test.ts
import { buildInfo } from '@lib/documentation/infoSource';
import { snapshotEnv } from '../../_setup/env-fixture';

describe('infoSource', () => {
    let restoreEnv: () => void;

    beforeEach(() => {
        restoreEnv = snapshotEnv();
        delete process.env.OPENAPI_TITLE;
        delete process.env.OPENAPI_VERSION;
        delete process.env.OPENAPI_DESC;
    });
    afterEach(() => restoreEnv());

    describe('buildInfo', () => {
        it('env 가 모두 비어 있을 때 package.json 값을 사용한다', () => {
            const info = buildInfo(
                { name: 'my-api', version: '1.2.3', description: 'My API' },
                process.env
            );
            expect(info).toEqual({ title: 'my-api', version: '1.2.3', description: 'My API' });
        });

        it('OPENAPI_TITLE 가 설정되었을 때 package.json name 보다 우선한다', () => {
            process.env.OPENAPI_TITLE = 'Override Title';
            const info = buildInfo(
                { name: 'my-api', version: '1.2.3' },
                process.env
            );
            expect(info.title).toBe('Override Title');
        });

        it('OPENAPI_VERSION 이 빈 문자열일 때 package.json version 으로 fallback 된다', () => {
            process.env.OPENAPI_VERSION = '';
            const info = buildInfo({ name: 'my-api', version: '1.2.3' }, process.env);
            expect(info.version).toBe('1.2.3');
        });

        it('package.json 과 env 모두 비어 있을 때 하드코딩 fallback 을 사용한다', () => {
            const info = buildInfo({}, process.env);
            expect(info.title).toBe('kusto-api');
            expect(info.version).toBe('0.0.0');
        });

        it('description 이 어디에도 없을 때 description 키를 생략한다', () => {
            const info = buildInfo({ name: 'a', version: '1' }, process.env);
            expect(info.description).toBeUndefined();
        });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/unit/documentation/infoSource.test.ts -v 2>&1 | tail -15`
Expected: FAIL — `Cannot find module ...`

- [ ] **Step 3: 구현**

```ts
// src/core/lib/documentation/infoSource.ts
import { OpenApiInfo } from './openApiTypes';

const FALLBACK_TITLE = 'kusto-api';
const FALLBACK_VERSION = '0.0.0';

interface PackageJsonLike {
    name?: string;
    version?: string;
    description?: string;
}

function pickNonEmpty(...candidates: Array<string | undefined>): string | undefined {
    for (const c of candidates) {
        if (typeof c === 'string' && c.length > 0) return c;
    }
    return undefined;
}

/**
 * OpenAPI info 객체를 빌드한다.
 * 우선순위: env (OPENAPI_TITLE/VERSION/DESC) > package.json > 하드코딩 fallback.
 */
export function buildInfo(packageJson: PackageJsonLike, env: NodeJS.ProcessEnv): OpenApiInfo {
    const title = pickNonEmpty(env.OPENAPI_TITLE, packageJson.name) ?? FALLBACK_TITLE;
    const version = pickNonEmpty(env.OPENAPI_VERSION, packageJson.version) ?? FALLBACK_VERSION;
    const description = pickNonEmpty(env.OPENAPI_DESC, packageJson.description);

    const info: OpenApiInfo = { title, version };
    if (description !== undefined) info.description = description;
    return info;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/unit/documentation/infoSource.test.ts -v 2>&1 | tail -15`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/documentation/infoSource.ts tests/unit/documentation/infoSource.test.ts
git commit -m "feat(docs): infoSource 구현 (env + package.json + fallback)"
```

---

## Task 5: serversSource (env → servers)

**Files:**
- Create: `src/core/lib/documentation/serversSource.ts`
- Test: `tests/unit/documentation/serversSource.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/documentation/serversSource.test.ts
import { buildServers } from '@lib/documentation/serversSource';
import { snapshotEnv } from '../../_setup/env-fixture';

describe('serversSource', () => {
    let restoreEnv: () => void;

    beforeEach(() => {
        restoreEnv = snapshotEnv();
        delete process.env.OPENAPI_SERVERS;
        delete process.env.HOST;
        delete process.env.PORT;
    });
    afterEach(() => restoreEnv());

    describe('buildServers', () => {
        it('OPENAPI_SERVERS 가 없을 때 HOST/PORT 기반 단일 server 를 반환한다', () => {
            process.env.HOST = 'localhost';
            process.env.PORT = '4000';
            const servers = buildServers(process.env);
            expect(servers).toEqual([{ url: 'http://localhost:4000', description: 'Local' }]);
        });

        it('HOST/PORT 둘 다 없을 때 기본값 (localhost:3000) 을 사용한다', () => {
            const servers = buildServers(process.env);
            expect(servers[0].url).toBe('http://localhost:3000');
        });

        it('OPENAPI_SERVERS JSON 배열이 유효할 때 그것을 사용한다', () => {
            process.env.OPENAPI_SERVERS = JSON.stringify([
                { url: 'https://api.example.com', description: 'Prod' },
                { url: 'https://staging.example.com', description: 'Staging' },
            ]);
            const servers = buildServers(process.env);
            expect(servers).toHaveLength(2);
            expect(servers[0].url).toBe('https://api.example.com');
            expect(servers[1].description).toBe('Staging');
        });

        it('OPENAPI_SERVERS JSON 파싱 실패 시 fallback 을 사용한다', () => {
            process.env.OPENAPI_SERVERS = 'not-json';
            const servers = buildServers(process.env);
            expect(servers[0].url).toMatch(/^http:\/\/localhost/);
        });

        it('OPENAPI_SERVERS 가 배열이 아닌 JSON 일 때 fallback 을 사용한다', () => {
            process.env.OPENAPI_SERVERS = JSON.stringify({ url: 'foo' });
            const servers = buildServers(process.env);
            expect(servers[0].url).toMatch(/^http:\/\/localhost/);
        });

        it('항목에 url 키가 없을 때 그 항목만 무시하고 나머지는 사용한다', () => {
            process.env.OPENAPI_SERVERS = JSON.stringify([
                { description: 'no url' },
                { url: 'https://ok.example.com' },
            ]);
            const servers = buildServers(process.env);
            expect(servers).toHaveLength(1);
            expect(servers[0].url).toBe('https://ok.example.com');
        });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/unit/documentation/serversSource.test.ts -v 2>&1 | tail -15`
Expected: FAIL.

- [ ] **Step 3: 구현**

```ts
// src/core/lib/documentation/serversSource.ts
import { OpenApiServer } from './openApiTypes';
import { log } from '@ext/winston';

function fallback(env: NodeJS.ProcessEnv): OpenApiServer[] {
    const host = env.HOST || 'localhost';
    const port = env.PORT || '3000';
    return [{ url: `http://${host}:${port}`, description: 'Local' }];
}

/**
 * OpenAPI servers 배열을 빌드한다.
 * - OPENAPI_SERVERS (JSON 배열) 가 유효하면 그것을 사용.
 * - 없거나 무효하면 HOST/PORT 기반 단일 서버 fallback.
 */
export function buildServers(env: NodeJS.ProcessEnv): OpenApiServer[] {
    const raw = env.OPENAPI_SERVERS;
    if (!raw) return fallback(env);

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        log.Warn('OPENAPI_SERVERS invalid JSON, using fallback', { reason: String(error) });
        return fallback(env);
    }

    if (!Array.isArray(parsed)) {
        log.Warn('OPENAPI_SERVERS is not an array, using fallback');
        return fallback(env);
    }

    const valid: OpenApiServer[] = [];
    for (const item of parsed) {
        if (item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string') {
            const entry = item as OpenApiServer;
            valid.push({
                url: entry.url,
                ...(entry.description !== undefined ? { description: entry.description } : {}),
                ...(entry.variables !== undefined ? { variables: entry.variables } : {}),
            });
        } else {
            log.Warn('OPENAPI_SERVERS entry missing url, skipped', { entry: item });
        }
    }

    if (valid.length === 0) {
        log.Warn('OPENAPI_SERVERS contained no valid entries, using fallback');
        return fallback(env);
    }
    return valid;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/unit/documentation/serversSource.test.ts -v 2>&1 | tail -15`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/documentation/serversSource.ts tests/unit/documentation/serversSource.test.ts
git commit -m "feat(docs): serversSource 구현 (OPENAPI_SERVERS env + fallback)"
```

---

## Task 6: schemaConverter (validator FieldSchema → OpenAPI schema)

**Files:**
- Create: `src/core/lib/documentation/schemaConverter.ts`
- Test: `tests/unit/documentation/schemaConverter.test.ts`

기존 `documentationGenerator.ts` 의 `convertSchemaToOpenAPI` / `convertFieldSchemaToOpenAPI` 와 동일 동작 + **누락된 type variant (file/binary/buffer) 추가** + **알 수 없는 type fail-fast**.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/documentation/schemaConverter.test.ts
import { fieldToOpenApi, schemaToOpenApi } from '@lib/documentation/schemaConverter';
import { FieldSchema } from '@lib/validator';

describe('schemaConverter', () => {
    describe('fieldToOpenApi', () => {
        it('type=string + min/max 일 때 type/minLength/maxLength 로 변환된다', () => {
            const field: FieldSchema = { type: 'string', min: 3, max: 50 };
            const result = fieldToOpenApi(field);
            expect(result).toEqual({ type: 'string', minLength: 3, maxLength: 50 });
        });

        it('type=number + min/max 일 때 minimum/maximum 으로 변환된다', () => {
            const field: FieldSchema = { type: 'number', min: 0, max: 100 };
            const result = fieldToOpenApi(field);
            expect(result).toEqual({ type: 'number', minimum: 0, maximum: 100 });
        });

        it('type=email 일 때 type=string + format=email 로 변환된다', () => {
            const field: FieldSchema = { type: 'email' };
            const result = fieldToOpenApi(field);
            expect(result).toEqual({ type: 'string', format: 'email' });
        });

        it('type=url 일 때 type=string + format=uri 로 변환된다', () => {
            const field: FieldSchema = { type: 'url' };
            const result = fieldToOpenApi(field);
            expect(result).toEqual({ type: 'string', format: 'uri' });
        });

        it('type=file 일 때 type=string + format=binary 로 변환된다', () => {
            const field: FieldSchema = { type: 'file' };
            const result = fieldToOpenApi(field);
            expect(result).toEqual({ type: 'string', format: 'binary' });
        });

        it('type=array 일 때 type=array 로 변환된다', () => {
            const field: FieldSchema = { type: 'array', min: 1, max: 10 };
            const result = fieldToOpenApi(field);
            expect(result.type).toBe('array');
            expect(result.minItems).toBe(1);
            expect(result.maxItems).toBe(10);
        });

        it('enum 이 있을 때 그대로 OpenAPI enum 으로 옮겨진다', () => {
            const field: FieldSchema = { type: 'string', enum: ['a', 'b', 'c'] };
            const result = fieldToOpenApi(field);
            expect(result.enum).toEqual(['a', 'b', 'c']);
        });

        it('pattern (RegExp) 이 있을 때 source 가 OpenAPI pattern 으로 옮겨진다', () => {
            const field: FieldSchema = { type: 'string', pattern: /^[A-Z]+$/ };
            const result = fieldToOpenApi(field);
            expect(result.pattern).toBe('^[A-Z]+$');
        });

        it('알 수 없는 type 일 때 throw 한다', () => {
            const field = { type: 'unknown' as any };
            expect(() => fieldToOpenApi(field)).toThrow(/Unknown FieldSchema type/);
        });
    });

    describe('schemaToOpenApi', () => {
        it('빈 schema 일 때 properties 가 빈 객체인 object schema 를 반환한다', () => {
            const result = schemaToOpenApi({});
            expect(result).toEqual({ type: 'object', properties: {} });
        });

        it('required: true 인 필드만 required 배열에 포함된다', () => {
            const result = schemaToOpenApi({
                name: { type: 'string', required: true },
                age: { type: 'number' },
            });
            expect(result.required).toEqual(['name']);
            expect(result.properties.name).toEqual({ type: 'string' });
            expect(result.properties.age).toEqual({ type: 'number' });
        });

        it('required 필드가 없을 때 required 키 자체를 생략한다', () => {
            const result = schemaToOpenApi({ x: { type: 'string' } });
            expect((result as any).required).toBeUndefined();
        });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/unit/documentation/schemaConverter.test.ts -v 2>&1 | tail -25`
Expected: FAIL.

- [ ] **Step 3: 구현**

```ts
// src/core/lib/documentation/schemaConverter.ts
import { FieldSchema, Schema, ValidatorType } from '@lib/validator';
import { OpenApiSchema, OpenApiObjectSchema } from './openApiTypes';

const KNOWN_TYPES: ReadonlySet<ValidatorType> = new Set([
    'string', 'number', 'boolean', 'array', 'object',
    'email', 'url', 'file', 'binary', 'buffer',
]);

/**
 * validator.ts 의 FieldSchema 한 개를 OpenAPI 3.1 schema 로 변환한다.
 * 알 수 없는 type 은 fail-fast (throw).
 */
export function fieldToOpenApi(field: FieldSchema): OpenApiSchema {
    if (!KNOWN_TYPES.has(field.type)) {
        throw new Error(`Unknown FieldSchema type: ${String(field.type)}`);
    }

    const result: OpenApiSchema = {};

    switch (field.type) {
        case 'string':
            result.type = 'string';
            break;
        case 'email':
            result.type = 'string';
            result.format = 'email';
            break;
        case 'url':
            result.type = 'string';
            result.format = 'uri';
            break;
        case 'file':
        case 'binary':
        case 'buffer':
            result.type = 'string';
            result.format = 'binary';
            break;
        case 'number':
            result.type = 'number';
            break;
        case 'boolean':
            result.type = 'boolean';
            break;
        case 'array':
            result.type = 'array';
            break;
        case 'object':
            result.type = 'object';
            break;
    }

    // min/max — type 별로 다른 키
    if (field.min !== undefined) {
        if (result.type === 'string') result.minLength = field.min;
        else if (result.type === 'array') result.minItems = field.min;
        else if (result.type === 'number') result.minimum = field.min;
    }
    if (field.max !== undefined) {
        if (result.type === 'string') result.maxLength = field.max;
        else if (result.type === 'array') result.maxItems = field.max;
        else if (result.type === 'number') result.maximum = field.max;
    }

    if (field.enum !== undefined) result.enum = field.enum;
    if (field.pattern !== undefined) result.pattern = field.pattern.source;
    if (field.example !== undefined) result.example = field.example;

    return result;
}

/**
 * validator.ts 의 Schema (필드명 → FieldSchema 매핑) 를 OpenAPI 3.1 object schema 로 변환한다.
 */
export function schemaToOpenApi(schema: Schema): OpenApiObjectSchema {
    const properties: Record<string, OpenApiSchema> = {};
    const required: string[] = [];

    for (const [name, field] of Object.entries(schema)) {
        properties[name] = fieldToOpenApi(field);
        if (field.required) required.push(name);
    }

    const result: OpenApiObjectSchema = { type: 'object', properties };
    if (required.length > 0) result.required = required;
    return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/unit/documentation/schemaConverter.test.ts -v 2>&1 | tail -25`
Expected: PASS — 12 tests passed.

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/documentation/schemaConverter.ts tests/unit/documentation/schemaConverter.test.ts
git commit -m "feat(docs): schemaConverter 구현 (validator → OpenAPI 3.1, file/binary/buffer 포함)"
```

---

## Task 7: dmmfToOpenApi (Prisma model → OpenAPI schema)

**Files:**
- Create: `src/core/lib/documentation/dmmfToOpenApi.ts`
- Test: `tests/unit/documentation/dmmfToOpenApi.test.ts`

PrismaSchemaAnalyzer 가 정규화한 `PrismaModelInfo` 를 입력받음 → OpenAPI schema 출력. 본 phase 에서는 **단일 model → 단일 schema** 만 (relations 는 단순 ref 문자열 placeholder, JSON:API 변형은 Task 8 의 책임).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/documentation/dmmfToOpenApi.test.ts
import { modelToOpenApi, enumToOpenApi } from '@lib/documentation/dmmfToOpenApi';
import { PrismaModelInfo } from '@lib/crudSchemaTypes';

const sampleUserModel: PrismaModelInfo = {
    name: 'User',
    fields: [
        {
            name: 'id', type: 'String', jsType: 'string',
            isOptional: false, isList: false, isId: true, isUnique: true,
            isReadOnly: false, isGenerated: true, isUpdatedAt: false,
        },
        {
            name: 'email', type: 'String', jsType: 'string',
            isOptional: false, isList: false, isId: false, isUnique: true,
            isReadOnly: false, isGenerated: false, isUpdatedAt: false,
        },
        {
            name: 'age', type: 'Int', jsType: 'number',
            isOptional: true, isList: false, isId: false, isUnique: false,
            isReadOnly: false, isGenerated: false, isUpdatedAt: false,
        },
        {
            name: 'createdAt', type: 'DateTime', jsType: 'Date',
            isOptional: false, isList: false, isId: false, isUnique: false,
            isReadOnly: false, isGenerated: false, isUpdatedAt: false,
        },
    ],
    relations: [],
    indexes: [],
    uniqueConstraints: [],
    primaryKey: { fields: ['id'] },
};

describe('dmmfToOpenApi', () => {
    describe('modelToOpenApi', () => {
        it('필드들이 OpenAPI properties 로 변환되고 required 필수 필드만 포함된다', () => {
            const schema = modelToOpenApi(sampleUserModel, new Map());
            expect(schema.type).toBe('object');
            expect(schema.properties).toHaveProperty('id');
            expect(schema.properties).toHaveProperty('email');
            expect(schema.properties).toHaveProperty('age');
            expect(schema.required).toEqual(expect.arrayContaining(['id', 'email', 'createdAt']));
            expect(schema.required).not.toContain('age');
        });

        it('Int 필드일 때 OpenAPI type=integer 로 매핑된다', () => {
            const schema = modelToOpenApi(sampleUserModel, new Map());
            expect((schema.properties.age as any).type).toEqual(['integer', 'null']);
        });

        it('DateTime 필드일 때 type=string + format=date-time 으로 매핑된다', () => {
            const schema = modelToOpenApi(sampleUserModel, new Map());
            expect(schema.properties.createdAt).toEqual({ type: 'string', format: 'date-time' });
        });

        it('isOptional 필드일 때 type 이 union (T | null) 으로 표현된다', () => {
            const schema = modelToOpenApi(sampleUserModel, new Map());
            expect((schema.properties.age as any).type).toEqual(['integer', 'null']);
        });

        it('관계 필드는 schema 의 properties 에서 제외된다', () => {
            const modelWithRel: PrismaModelInfo = {
                ...sampleUserModel,
                fields: [
                    ...sampleUserModel.fields,
                    {
                        name: 'posts', type: 'Post', jsType: 'Post',
                        isOptional: false, isList: true, isId: false, isUnique: false,
                        isReadOnly: false, isGenerated: false, isUpdatedAt: false,
                        relationName: 'UserPosts',
                    },
                ],
            };
            const schema = modelToOpenApi(modelWithRel, new Map());
            expect(schema.properties).not.toHaveProperty('posts');
        });
    });

    describe('enumToOpenApi', () => {
        it('enum 값들을 OpenAPI enum schema 로 변환한다', () => {
            const schema = enumToOpenApi('Role', ['ADMIN', 'USER', 'GUEST']);
            expect(schema).toEqual({ type: 'string', enum: ['ADMIN', 'USER', 'GUEST'] });
        });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/unit/documentation/dmmfToOpenApi.test.ts -v 2>&1 | tail -20`
Expected: FAIL.

- [ ] **Step 3: 구현**

```ts
// src/core/lib/documentation/dmmfToOpenApi.ts
import { PrismaModelInfo, PrismaFieldMetadata } from '@lib/crudSchemaTypes';
import { OpenApiSchema, OpenApiObjectSchema, OpenApiSchemaOrRef } from './openApiTypes';
import { log } from '@ext/winston';

/**
 * Prisma 스칼라 타입 → OpenAPI primitive type / format.
 */
function prismaTypeToOpenApi(prismaType: string): { type: 'string' | 'number' | 'integer' | 'boolean' | 'object'; format?: string } {
    switch (prismaType) {
        case 'String':   return { type: 'string' };
        case 'Int':      return { type: 'integer', format: 'int32' };
        case 'BigInt':   return { type: 'integer', format: 'int64' };
        case 'Float':    return { type: 'number', format: 'float' };
        case 'Decimal':  return { type: 'string', format: 'decimal' };
        case 'Boolean':  return { type: 'boolean' };
        case 'DateTime': return { type: 'string', format: 'date-time' };
        case 'Json':     return { type: 'object' };
        case 'Bytes':    return { type: 'string', format: 'byte' };
        default:
            // enum 또는 알 수 없는 타입 — 호출자가 enum 별도 등록을 가정
            return { type: 'string' };
    }
}

/**
 * 단일 필드 → OpenAPI schema. 관계 필드는 호출자가 미리 걸러야 함.
 * isOptional 시 type union (T | null) 으로 표현 (OpenAPI 3.1 / JSON Schema 2020-12).
 * isList 시 array wrapper.
 */
export function fieldToSchema(field: PrismaFieldMetadata, enumValuesByName: Map<string, string[]>): OpenApiSchemaOrRef {
    if (enumValuesByName.has(field.type)) {
        return { $ref: `#/components/schemas/${field.type}` };
    }

    const { type: baseType, format } = prismaTypeToOpenApi(field.type);
    let schema: OpenApiSchema = { type: baseType };
    if (format) schema.format = format;

    if (field.isList) {
        schema = { type: 'array', items: schema };
    }

    if (field.isOptional) {
        // type union 으로 nullable 표현
        const currentType = schema.type;
        if (Array.isArray(currentType)) {
            schema = { ...schema, type: [...currentType, 'null'] };
        } else if (typeof currentType === 'string') {
            schema = { ...schema, type: [currentType, 'null'] };
        }
    }

    if (field.documentation) schema.description = field.documentation;

    return schema;
}

/**
 * Prisma 모델 정보 → OpenAPI object schema.
 * 관계 필드 (relationName 가 있는) 는 attributes 에서 제외.
 */
export function modelToOpenApi(model: PrismaModelInfo, enumValuesByName: Map<string, string[]>): OpenApiObjectSchema {
    if (model.fields.length === 0) {
        log.Warn('Model has no fields', { modelName: model.name });
    }

    const properties: Record<string, OpenApiSchemaOrRef> = {};
    const required: string[] = [];

    for (const field of model.fields) {
        if (field.relationName) continue; // 관계는 jsonApiSchemas 에서 처리
        properties[field.name] = fieldToSchema(field, enumValuesByName);
        if (!field.isOptional && !field.isGenerated) required.push(field.name);
        // isGenerated (auto-id, default(now()) 등) 는 클라이언트가 보내지 않아도 됨 → not required
        // 하지만 응답에는 항상 존재 → 별도 변형이 필요할 수 있으나 본 phase 는 단일 schema 만
    }

    // 응답용 schema 에서는 generated 필드도 항상 존재. M3 에서 Attributes/Resource 변형 분리.
    // 본 phase 에서는 모든 non-optional 필드를 required 로 표시 (단순화).
    const allRequired: string[] = [];
    for (const field of model.fields) {
        if (field.relationName) continue;
        if (!field.isOptional) allRequired.push(field.name);
    }

    const result: OpenApiObjectSchema = { type: 'object', properties };
    if (allRequired.length > 0) result.required = allRequired;
    if (model.documentation) result.description = model.documentation;
    return result;
}

/**
 * Enum 값 배열 → OpenAPI string enum schema.
 */
export function enumToOpenApi(name: string, values: string[]): OpenApiSchema {
    if (values.length === 0) {
        log.Warn('Enum has no values', { enumName: name });
        return { type: 'string' };
    }
    return { type: 'string', enum: values };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/unit/documentation/dmmfToOpenApi.test.ts -v 2>&1 | tail -20`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/documentation/dmmfToOpenApi.ts tests/unit/documentation/dmmfToOpenApi.test.ts
git commit -m "feat(docs): dmmfToOpenApi 구현 (PrismaModelInfo → OpenAPI 3.1 schema)"
```

---

## Task 8: jsonApiSchemas (JSON:API 3변형 + JsonApiError)

**Files:**
- Create: `src/core/lib/documentation/jsonApiSchemas.ts`
- Test: `tests/unit/documentation/jsonApiSchemas.test.ts`

JSON:API spec 의 resource object 형식을 OpenAPI schema 로 표현. 한 model 당 3변형 + 공용 `JsonApiError`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/documentation/jsonApiSchemas.test.ts
import {
    jsonApiResource,
    jsonApiAttributes,
    jsonApiRelationships,
    jsonApiErrorObject,
} from '@lib/documentation/jsonApiSchemas';
import { PrismaModelInfo } from '@lib/crudSchemaTypes';

const sampleModel: PrismaModelInfo = {
    name: 'Post',
    fields: [
        { name: 'id', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: true, isUnique: true, isReadOnly: false, isGenerated: true, isUpdatedAt: false },
        { name: 'title', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
        { name: 'body', type: 'String', jsType: 'string', isOptional: true, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
        { name: 'author', type: 'User', jsType: 'User', isOptional: false, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false, relationName: 'PostAuthor', relationFromFields: ['authorId'], relationToFields: ['id'] },
    ],
    relations: [{ name: 'author', type: 'many-to-one', model: 'User', fields: ['authorId'], references: ['id'] }],
    indexes: [],
    uniqueConstraints: [],
    primaryKey: { fields: ['id'] },
};

describe('jsonApiSchemas', () => {
    describe('jsonApiAttributes', () => {
        it('관계 필드와 id 를 제외한 attributes schema 를 만든다', () => {
            const schema = jsonApiAttributes(sampleModel, new Map());
            expect(schema.type).toBe('object');
            expect((schema as any).properties).toHaveProperty('title');
            expect((schema as any).properties).toHaveProperty('body');
            expect((schema as any).properties).not.toHaveProperty('id');
            expect((schema as any).properties).not.toHaveProperty('author');
        });
    });

    describe('jsonApiRelationships', () => {
        it('관계만 모은 schema 를 만들고 각 관계는 JSON:API resource identifier 형식이다', () => {
            const schema = jsonApiRelationships(sampleModel);
            expect(schema.type).toBe('object');
            const props = (schema as any).properties;
            expect(props).toHaveProperty('author');
            expect(props.author.type).toBe('object');
            expect(props.author.properties.data.properties.type.type).toBe('string');
            expect(props.author.properties.data.properties.id.type).toBe('string');
        });

        it('관계가 없는 모델일 때 빈 properties 를 가진 object schema 를 반환한다', () => {
            const noRel: PrismaModelInfo = { ...sampleModel, fields: sampleModel.fields.filter(f => !f.relationName) };
            const schema = jsonApiRelationships(noRel);
            expect((schema as any).properties).toEqual({});
        });
    });

    describe('jsonApiResource', () => {
        it('id/type/attributes/relationships 4 키를 가진 schema 를 만든다', () => {
            const schema = jsonApiResource(sampleModel, new Map());
            expect((schema as any).properties).toHaveProperty('id');
            expect((schema as any).properties).toHaveProperty('type');
            expect((schema as any).properties).toHaveProperty('attributes');
            expect((schema as any).properties).toHaveProperty('relationships');
            expect((schema as any).properties.type.const).toBe('Post');
        });
    });

    describe('jsonApiErrorObject', () => {
        it('errors 배열을 가진 object schema 를 반환하고 각 error 는 status/code/title 을 required 로 한다', () => {
            const schema = jsonApiErrorObject();
            expect((schema as any).properties.errors.type).toBe('array');
            const errItem = (schema as any).properties.errors.items;
            expect(errItem.required).toEqual(expect.arrayContaining(['status', 'code', 'title']));
        });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/unit/documentation/jsonApiSchemas.test.ts -v 2>&1 | tail -20`
Expected: FAIL.

- [ ] **Step 3: 구현**

```ts
// src/core/lib/documentation/jsonApiSchemas.ts
import { PrismaModelInfo } from '@lib/crudSchemaTypes';
import { OpenApiSchema, OpenApiObjectSchema, OpenApiSchemaOrRef } from './openApiTypes';
import { fieldToSchema } from './dmmfToOpenApi';

/**
 * JSON:API attributes schema — id 와 관계 필드를 제외한 모든 필드.
 */
export function jsonApiAttributes(model: PrismaModelInfo, enumValuesByName: Map<string, string[]>): OpenApiObjectSchema {
    const properties: Record<string, OpenApiSchemaOrRef> = {};
    const required: string[] = [];

    for (const field of model.fields) {
        if (field.isId) continue;
        if (field.relationName) continue;
        properties[field.name] = fieldToSchema(field, enumValuesByName);
        if (!field.isOptional && !field.isGenerated) required.push(field.name);
    }

    const result: OpenApiObjectSchema = { type: 'object', properties };
    if (required.length > 0) result.required = required;
    return result;
}

/**
 * JSON:API relationships schema — 관계 필드만, 각 관계는 resource identifier 형식.
 * { data: { type: 'TargetModel', id: string } } (single)
 * 또는 { data: [{ type, id }, ...] } (list).
 */
export function jsonApiRelationships(model: PrismaModelInfo): OpenApiObjectSchema {
    const properties: Record<string, OpenApiSchemaOrRef> = {};

    for (const rel of model.relations) {
        const isList = rel.type === 'one-to-many' || rel.type === 'many-to-many';
        const identifier: OpenApiSchema = {
            type: 'object',
            required: ['type', 'id'],
            properties: {
                type: { type: 'string' },
                id: { type: 'string' },
            },
        };
        const dataSchema: OpenApiSchema = isList
            ? { type: 'array', items: identifier }
            : identifier;
        properties[rel.name] = {
            type: 'object',
            properties: { data: dataSchema },
        };
    }

    return { type: 'object', properties };
}

/**
 * JSON:API resource object schema — id/type/attributes/relationships 4 키.
 * type 은 const = 모델명 으로 고정 (3.1 / JSON Schema 2020-12).
 */
export function jsonApiResource(model: PrismaModelInfo, enumValuesByName: Map<string, string[]>): OpenApiObjectSchema {
    const attributes = jsonApiAttributes(model, enumValuesByName);
    const relationships = jsonApiRelationships(model);

    const properties: Record<string, OpenApiSchemaOrRef> = {
        id: { type: 'string' },
        type: { type: 'string', const: model.name } as OpenApiSchema & { const?: string },
        attributes,
    };
    if (Object.keys(relationships.properties).length > 0) {
        properties.relationships = relationships;
    }

    return {
        type: 'object',
        required: ['type', 'attributes'],
        properties,
    };
}

/**
 * JSON:API errors[] 응답 본문 schema — 모든 4xx/5xx 응답에 공통 사용.
 */
export function jsonApiErrorObject(): OpenApiObjectSchema {
    return {
        type: 'object',
        required: ['errors'],
        properties: {
            errors: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['status', 'code', 'title'],
                    properties: {
                        id: { type: 'string' },
                        status: { type: 'string' },
                        code: { type: 'string' },
                        title: { type: 'string' },
                        detail: { type: 'string' },
                        source: {
                            type: 'object',
                            properties: {
                                pointer: { type: 'string' },
                                parameter: { type: 'string' },
                                header: { type: 'string' },
                            },
                        },
                        meta: { type: 'object' },
                    },
                },
            },
        },
    };
}
```

`OpenApiSchema` 에 `const` 키는 정의 안 했지만 OpenAPI 3.1 / JSON Schema 2020-12 가 지원. 캐스팅으로 우회 — 이는 의도. `openApiTypes.ts` 에 `const?` 추가하지 않는 이유: 실제로 사용하는 한 곳뿐이라 좁게 캐스팅이 더 명확.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/unit/documentation/jsonApiSchemas.test.ts -v 2>&1 | tail -20`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/documentation/jsonApiSchemas.ts tests/unit/documentation/jsonApiSchemas.test.ts
git commit -m "feat(docs): jsonApiSchemas 구현 (Resource/Attributes/Relationships + JsonApiError)"
```

---

## Task 9: openApiBuilder (orchestrator)

**Files:**
- Create: `src/core/lib/documentation/openApiBuilder.ts`
- Test: `tests/unit/documentation/openApiBuilder.test.ts`

본 phase 의 핵심. 기존 `DocumentationGenerator.generateOpenAPISpec()` 의 동작을 그대로 재현 (외부 동작 0 변화 원칙). path 변환·content-type 강제·3.1 업그레이드는 M2 에서. **Phase 3 TC #21 의 핵심 표적**.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/documentation/openApiBuilder.test.ts
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
        it('routes 가 비어 있을 때 paths 가 빈 객체인 OpenAPI document 를 반환한다', () => {
            const doc = buildOpenApiDocument({
                routes: [],
                schemas: {},
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            expect(doc.openapi).toBe('3.0.0'); // M1 에서는 3.0.0 유지, M2 에서 3.1.0
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
            expect(doc.paths['/users'].get).toBeDefined();
            expect(doc.paths['/users'].get?.summary).toBe('List users');
            expect(doc.paths['/users'].get?.responses['200']).toBeDefined();
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
                    parameters: {
                        query: {
                            page: { type: 'number', required: false, description: 'Page number' },
                        },
                    },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            const op = doc.paths['/users'].get!;
            expect(op.parameters).toBeDefined();
            expect(op.parameters!.find(p => p.name === 'page' && p.in === 'query')).toBeDefined();
        });

        it('routes 의 path 파라미터가 OpenAPI parameters in=path 로 변환된다', () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/users/:id',
                    parameters: {
                        params: { id: { type: 'string', required: true } },
                    },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            // M1: path 변환은 아직 활성화 안 됨. /users/:id 그대로.
            const op = doc.paths['/users/:id']?.get;
            expect(op?.parameters?.find(p => p.name === 'id' && p.in === 'path')).toBeDefined();
        });

        it('responses 가 없을 때 기본 200 응답이 채워진다 (기존 동작 보존)', () => {
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

Run: `npx jest tests/unit/documentation/openApiBuilder.test.ts -v 2>&1 | tail -25`
Expected: FAIL.

- [ ] **Step 3: 구현**

```ts
// src/core/lib/documentation/openApiBuilder.ts
import { Schema } from '@lib/validator';
import {
    OpenApiDocument,
    OpenApiOperation,
    OpenApiParameter,
    OpenApiRequestBody,
    OpenApiResponse,
    OpenApiSchema,
    OpenApiSchemaOrRef,
} from './openApiTypes';
import { schemaToOpenApi, fieldToOpenApi } from './schemaConverter';
import { buildInfo } from './infoSource';
import { buildServers } from './serversSource';

/**
 * 본 phase (M1) 에서는 path/content-type/openapi 버전 변경 없음 — 기존 동작 보존.
 * M2 에서 toOpenApiPath, mediaTypeFor, '3.1.0' 활성화.
 */
const OPENAPI_VERSION = '3.0.0';
const DEFAULT_CONTENT_TYPE = 'application/json';

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

function buildRequestBody(route: RouteDocumentationLike): OpenApiRequestBody | undefined {
    if (!route.parameters?.body) return undefined;
    return {
        required: true,
        content: {
            [DEFAULT_CONTENT_TYPE]: {
                schema: schemaToOpenApi(route.parameters.body),
            },
        },
    };
}

function buildResponses(route: RouteDocumentationLike): Record<string, OpenApiResponse> {
    const out: Record<string, OpenApiResponse> = {};
    if (route.responses) {
        for (const [code, schema] of Object.entries(route.responses)) {
            out[code] = {
                description: `Response ${code}`,
                content: {
                    [DEFAULT_CONTENT_TYPE]: {
                        schema: schemaToOpenApi(schema),
                    },
                },
            };
        }
    }
    if (Object.keys(out).length === 0) {
        // 기존 generateOpenAPISpec 의 fallback 보존
        out['200'] = {
            description: 'Success',
            content: {
                [DEFAULT_CONTENT_TYPE]: {
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
    const op: OpenApiOperation = {
        summary: route.summary ?? `${route.method.toUpperCase()} ${route.path}`,
        tags: route.tags ?? ['API'],
        responses: buildResponses(route),
    };
    if (route.description !== undefined) op.description = route.description;
    const parameters = buildParameters(route);
    if (parameters.length > 0) op.parameters = parameters;
    const requestBody = buildRequestBody(route);
    if (requestBody !== undefined) op.requestBody = requestBody;
    return op;
}

/**
 * routes/schemas/env/packageJson 을 입력받아 최종 OpenAPI document 빌드.
 * 본 phase 에서는 기존 generateOpenAPISpec 동작과 byte-for-byte 동등.
 */
export function buildOpenApiDocument(input: BuildOpenApiInput): OpenApiDocument {
    const { routes, schemas, env, packageJson } = input;

    const paths: Record<string, Record<string, OpenApiOperation>> = {};
    for (const route of routes) {
        if (!paths[route.path]) paths[route.path] = {};
        paths[route.path][route.method.toLowerCase()] = buildOperation(route);
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

Run: `npx jest tests/unit/documentation/openApiBuilder.test.ts -v 2>&1 | tail -20`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/documentation/openApiBuilder.ts tests/unit/documentation/openApiBuilder.test.ts
git commit -m "feat(docs): openApiBuilder 구현 (orchestrator, 기존 동작 보존)"
```

---

## Task 10: index.ts barrel export

**Files:**
- Create: `src/core/lib/documentation/index.ts`

다른 파일에서 단일 import 로 모듈 사용 가능하게.

- [ ] **Step 1: barrel 작성**

```ts
// src/core/lib/documentation/index.ts
export * from './openApiTypes';
export * from './pathConverter';
export * from './contentTypeRule';
export * from './infoSource';
export * from './serversSource';
export * from './schemaConverter';
export * from './dmmfToOpenApi';
export * from './jsonApiSchemas';
export * from './openApiBuilder';
```

- [ ] **Step 2: 컴파일 통과 확인**

Run: `npx tsc --noEmit -p tsconfig.test.json 2>&1 | grep -E "documentation/" | head -5`
Expected: 0건 (이름 충돌 없음 — 각 모듈이 다른 함수 export).

- [ ] **Step 3: 커밋**

```bash
git add src/core/lib/documentation/index.ts
git commit -m "feat(docs): documentation/ 모듈 barrel export"
```

---

## Task 11: documentationGenerator.ts 내부 refactor

**Files:**
- Modify: `src/core/lib/documentationGenerator.ts`

내부 변환 메서드 (`convertSchemaToOpenAPI`, `convertFieldSchemaToOpenAPI`, `generateOpenAPISpec` 의 빌드 로직) 를 `documentation/` 모듈 호출로 교체. **Public 정적 API 시그니처는 보존**. 동작 byte-for-byte 동일해야 함.

본 task 는 동작 변경 0 이라 신규 unit test 추가 안 함. 대신 **기존 통합 테스트 또는 수동 검증** 으로 동작 동일성 확인.

- [ ] **Step 1: 기존 documentationGenerator.ts 의 export 와 동작 파악**

Read: `src/core/lib/documentationGenerator.ts` (1–441 줄, 이미 읽음)

확인 포인트:
- `static registerRoute(route)` — routes[].push, dev 모드 가드.
- `static updateRoutePaths(basePath, indices?)` — 경로 일괄 갱신.
- `static getRouteCount()`, `static getRoutes()`, `static reset()`.
- `static generateOpenAPISpec()` — paths 빌드, 200 fallback, OpenAPI document 반환.
- `static generateHTMLDocumentation()` — Swagger UI HTML.
- `static generateDevInfoPage()` — dev info HTML.
- `private static convertSchemaToOpenAPI` / `convertFieldSchemaToOpenAPI` — 삭제 대상.
- `private static isDocumentationEnabled()` — 유지.

- [ ] **Step 2: refactor 작성 (기존 파일 전체 교체, public API 보존)**

```ts
// src/core/lib/documentationGenerator.ts
import { Schema } from './validator';
import { ResponseConfig } from './requestHandler';
import { log } from '@ext/winston';
import {
    buildOpenApiDocument,
    OpenApiSchemaOrRef,
    OpenApiDocument,
} from './documentation';

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
}

/** 기존 ApiDocumentation 호환 alias */
export type ApiDocumentation = OpenApiDocument;

const FALLBACK_PACKAGE_JSON = { name: 'kusto-api', version: '0.0.0' };

function loadPackageJson(): { name?: string; version?: string; description?: string } {
    try {
        // webpack bundling 시 inline. dev 모드에서는 ts-node 가 require 해석.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('../../../package.json');
    } catch {
        log.Warn('package.json not found for OpenAPI info, using fallback');
        return FALLBACK_PACKAGE_JSON;
    }
}

export class DocumentationGenerator {
    private static routes: RouteDocumentation[] = [];
    private static schemas: Record<string, OpenApiSchemaOrRef> = {};

    /** 라우트 문서 등록 */
    static registerRoute(route: RouteDocumentation): void {
        if (!this.isDocumentationEnabled()) return;
        this.routes.push(route);
        log.Debug(`Documentation registered for ${route.method} ${route.path}`);
    }

    /** 등록된 라우트의 경로를 업데이트 (마운트 시 사용) */
    static updateRoutePaths(basePath: string, routeIndices?: number[]): void {
        if (!this.isDocumentationEnabled()) return;

        const normalizedBasePath = basePath === '/' ? '' : (basePath.endsWith('/') ? basePath.slice(0, -1) : basePath);
        const indicesToUpdate = routeIndices || [];
        if (indicesToUpdate.length === 0) return;

        for (const index of indicesToUpdate) {
            if (index >= 0 && index < this.routes.length) {
                const route = this.routes[index];
                if (!route.path.startsWith(normalizedBasePath)) {
                    const newPath = route.path === '/'
                        ? normalizedBasePath || '/'
                        : `${normalizedBasePath}${route.path}`;
                    log.Debug(`Updating route path: ${route.path} -> ${newPath}`);
                    route.path = newPath;
                }
            }
        }
    }

    static getRouteCount(): number {
        return this.routes.length;
    }

    /** 스키마 등록 (M3 의 syncDocumentationSchemas 가 사용 예정) */
    static registerSchema(name: string, schema: OpenApiSchemaOrRef): void {
        if (!this.isDocumentationEnabled()) return;
        this.schemas[name] = schema;
    }

    private static isDocumentationEnabled(): boolean {
        return process.env.NODE_ENV !== 'production' && process.env.AUTO_DOCS === 'true';
    }

    /** OpenAPI 문서 생성 */
    static generateOpenAPISpec(): ApiDocumentation {
        if (!this.isDocumentationEnabled()) {
            throw new Error('Documentation is not enabled');
        }
        return buildOpenApiDocument({
            routes: this.routes,
            schemas: this.schemas,
            env: process.env,
            packageJson: loadPackageJson(),
        });
    }

    /** HTML 문서 생성 (Swagger UI 5.x) */
    static generateHTMLDocumentation(): string {
        if (!this.isDocumentationEnabled()) {
            return '<h1>Documentation is not enabled</h1>';
        }
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Documentation</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.0.0/swagger-ui.css" />
    <style>
        body { margin: 0; padding: 0; }
        .swagger-ui .topbar { display: none; }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.0.0/swagger-ui-bundle.js"></script>
    <script>
        window.onload = function() {
            SwaggerUIBundle({
                url: '/docs/openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIBundle.presets.standalone
                ],
                plugins: [SwaggerUIBundle.plugins.DownloadUrl]
            });
        };
    </script>
</body>
</html>`;
    }

    static getRoutes(): RouteDocumentation[] {
        return [...this.routes];
    }

    static reset(): void {
        this.routes = [];
        this.schemas = {};
    }

    /** 개발 모드 정보 페이지 생성 (기존 동작 보존) */
    static generateDevInfoPage(): string {
        const totalRoutes = this.routes.length;
        const routesByMethod = this.routes.reduce((acc, route) => {
            acc[route.method] = (acc[route.method] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Development Info</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
        .stats { display: flex; gap: 20px; margin: 20px 0; }
        .stat-card { background: white; border: 1px solid #e9ecef; padding: 15px; border-radius: 8px; min-width: 120px; }
        .stat-number { font-size: 24px; font-weight: bold; color: #0d6efd; }
        .stat-label { color: #6c757d; font-size: 14px; }
        .route-list { margin-top: 20px; }
        .route-item { background: white; border: 1px solid #e9ecef; padding: 10px 15px; margin: 5px 0; border-radius: 4px; display: flex; align-items: center; }
        .method { font-weight: bold; margin-right: 15px; padding: 3px 8px; border-radius: 3px; font-size: 12px; }
        .method.GET { background: #d4edda; color: #155724; }
        .method.POST { background: #cce5ff; color: #004085; }
        .method.PUT { background: #fff3cd; color: #856404; }
        .method.DELETE { background: #f8d7da; color: #721c24; }
        .path { font-family: monospace; color: #495057; }
        .links { margin-top: 30px; }
        .link-button { display: inline-block; background: #0d6efd; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin-right: 10px; }
        .link-button:hover { background: #0b5ed7; }
    </style>
</head>
<body>
    <div class="header">
        <h1>API Development Dashboard</h1>
        <p>Auto-generated documentation for Express Kusto API</p>
        <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'} | <strong>Auto Docs:</strong> ${process.env.AUTO_DOCS}</p>
    </div>

    <div class="stats">
        <div class="stat-card">
            <div class="stat-number">${totalRoutes}</div>
            <div class="stat-label">Total Routes</div>
        </div>
        ${Object.entries(routesByMethod).map(([method, count]) => `
        <div class="stat-card">
            <div class="stat-number">${count}</div>
            <div class="stat-label">${method} Routes</div>
        </div>
        `).join('')}
    </div>

    <h2>Registered Routes</h2>
    <div class="route-list">
        ${this.routes.map(route => `
        <div class="route-item">
            <span class="method ${route.method}">${route.method}</span>
            <span class="path">${route.path}</span>
            ${route.summary ? `<span style="margin-left: auto; color: #6c757d; font-style: italic;">${route.summary}</span>` : ''}
        </div>
        `).join('')}
    </div>
    <div class="links">
        <a href="/docs/openapi.json" class="link-button">OpenAPI JSON</a>
    </div>

    <script>
        if (window.location.search.includes('refresh=true')) {
            setTimeout(() => window.location.reload(), 5000);
        }
    </script>
</body>
</html>`;
    }
}
```

`ResponseConfig` import 는 기존과 동일 (`./requestHandler`). `generateOpenAPISpec` 의 fallback 200 응답은 `openApiBuilder.ts` 가 담당 (Task 9 step 3 의 `buildResponses` 안).

- [ ] **Step 3: 컴파일 + 기존 unit/integration 테스트 통과 확인**

Run:
```bash
npx tsc --noEmit -p tsconfig.test.json 2>&1 | head -20
npx jest --listTests 2>&1 | head -5
npx jest 2>&1 | tail -20
```
Expected:
- 컴파일 0 에러
- 기존 137 TC + 신규 8 모듈 (~32 TC) 모두 PASS.

- [ ] **Step 4: 신규 unit 테스트만 빠른 확인**

Run: `npx jest tests/unit/documentation 2>&1 | tail -10`
Expected: PASS — 8 test suites passed.

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/documentationGenerator.ts
git commit -m "refactor(docs): documentationGenerator 내부를 documentation/ 모듈 호출로 교체

Public 정적 API 시그니처 보존. 외부 동작 byte-for-byte 동일.
Spec A M1 완료 — 변환 layer 정착."
```

---

## Task 12: 동작 동일성 수동 검증 (smoke)

**Files:** (수정 없음, 수동 검증만)

기존 통합 테스트가 `/docs/openapi.json` 응답을 검증하지 않을 수 있음 — 본 phase 의 외부 동작 0 변화 원칙을 마지막으로 확인.

- [ ] **Step 1: dev 서버 부팅 후 /docs/openapi.json 응답 캡처 (refactor 후)**

Run:
```bash
AUTO_DOCS=true NODE_ENV=development npm run dev &
DEV_PID=$!
sleep 8
curl -s http://localhost:${PORT:-3000}/docs/openapi.json > /tmp/openapi-after.json
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
```

Expected: `/tmp/openapi-after.json` 가 valid JSON 이고 `openapi: '3.0.0'`, `paths` 키 존재.

- [ ] **Step 2: 응답 포맷 sanity check**

Run:
```bash
node -e "const j=require('/tmp/openapi-after.json'); console.log('openapi:',j.openapi,'paths:',Object.keys(j.paths).length,'schemas:',Object.keys(j.components?.schemas||{}).length);"
```

Expected: `openapi: 3.0.0`, paths 수 > 0 (CRUD 라우트들 포함), schemas: 0 (M3 에서 채워질 예정).

- [ ] **Step 3: refactor 전 캡처본 (있다면) 과 diff**

git stash 또는 이전 commit checkout 으로 refactor 전 캡처 후 비교.

```bash
# 선택: 이전 commit 으로 비교
git stash
AUTO_DOCS=true NODE_ENV=development npm run dev &
DEV_PID=$!
sleep 8
curl -s http://localhost:${PORT:-3000}/docs/openapi.json > /tmp/openapi-before.json
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
git stash pop

diff <(node -e "console.log(JSON.stringify(require('/tmp/openapi-before.json'),null,2))") \
     <(node -e "console.log(JSON.stringify(require('/tmp/openapi-after.json'),null,2))")
```

Expected: diff 0 (또는 routes 등록 순서·timestamp 같은 비결정 요소만).

차이가 있다면 refactor 가 동작을 바꾼 것 — 원인 파악 후 수정. 차이 없으면 본 phase 완료.

- [ ] **Step 4: TaskUpdate (별 commit 없음 — 검증만)**

```bash
git status
```
Expected: working tree clean.

---

## 자기 점검 (Self-review 결과)

본 plan 작성 후 spec 과 대조:

- **Spec § 5.1 변환 layer**: schemaConverter (Task 6), dmmfToOpenApi (Task 7), jsonApiSchemas (Task 8), pathConverter (Task 2), contentTypeRule (Task 3), infoSource (Task 4), serversSource (Task 5) — 7개 모두 포함. ✓
- **Spec § 5.2 빌드 layer**: openApiBuilder (Task 9), documentationGenerator refactor (Task 11) — 2개 포함. ✓
- **Spec § 5.2 신규 메서드 `registerSchema`**: Task 11 step 2 에 포함. ✓
- **Spec § 4.1 디렉토리 구조**: `src/core/lib/documentation/` + 8 module + index.ts — Task 1–10 으로 모두 커버. ✓
- **Spec § 9 M1 항목**: "변환 layer 8 모듈 신규 작성, documentationGenerator 내부 교체, 기존 동작 그대로" — 본 plan 의 Task 1–12 가 정확히 이 범위. ✓
- **Spec § 8 테스트**: Task 별로 smoke 테스트 포함 (file 1개 / 모듈 1개). ✓
- **Spec § 7.3 fail-fast**: schemaConverter 의 알 수 없는 type → throw (Task 6 의 step 3 코드에 포함). ✓
- **OpenAPI 3.1 업그레이드**: 본 phase **에서는 의도적으로 3.0.0 유지** — Spec § 9 의 M1 가 "no behavior change", M2 가 3.1 활성화. plan 도 일관됨. ✓

**Placeholder scan**: TBD/TODO/"적절히" 등 0건.

**Type 일관성**: `OpenApiSchemaOrRef` (Task 1 정의) → Task 7/8/9/11 모두 같은 이름 사용. `RouteDocumentationLike` (Task 9) ↔ `RouteDocumentation` (Task 11) 의 형식이 호환됨 (둘 다 method/path/parameters/responses 키).

**경계 잠재 이슈**: Task 11 의 `loadPackageJson()` 의 require path `'../../../package.json'` — 실제 webpack bundling 시 경로 검증 필요 (M4 에서 `webpack.config.js` 의 CopyWebpackPlugin patterns 갱신과 연동). 본 phase 는 dev 모드 (ts-node) 기준으로만 동작 — 빌드 후 환경의 검증은 M4 에서.

---

## 완료 기준 (Definition of Done)

- 모든 12 task 의 체크박스 체크.
- `npx jest` 가 PASS (기존 137 TC + 신규 ~32 TC ≈ 169 TC).
- `npx tsc --noEmit -p tsconfig.test.json` 0 에러.
- `/docs/openapi.json` 응답이 refactor 전과 동일 (Task 12).
- Git log 에 12개의 의미 단위 커밋.
- branch `ver/0.1.47` 의 working tree clean.
