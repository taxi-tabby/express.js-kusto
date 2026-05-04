# Documentation System Enhancement — Phase 3 (M3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prisma DMMF → OpenAPI `components.schemas` 자동 동기화. 외부 도구가 spec 에서 모델 정보 (User, Post 등) 을 볼 수 있게 됨. CRUD 인라인 스키마 → `$ref` 치환은 본 phase 에 포함하지 않음 (M3b 별 plan).

**Architecture:** M1 의 `dmmfToOpenApi` + `jsonApiSchemas` 모듈을 호출해 DMMF model 을 3변형 (`{Model}`, `{Model}Attributes`, `{Model}Relationships`) 으로 변환 + 공통 `JsonApiError` 까지 `DocumentationGenerator.registerSchema` 로 등록하는 helper 작성. 기존 `expressRouter.ts` 의 `initializeSchemaAnalyzer` 에 hook 으로 끼워넣어 wiring (race 위험 없음 — `/docs` 요청은 server boot 후라 sync 가 먼저 끝남).

**Tech Stack:** TypeScript, Jest. 신규 의존성 0.

**Spec 참조:** `docs/superpowers/specs/2026-05-04-documentation-system-enhancement-design.md` (섹션 5.2 syncDocumentationSchemas, 6.1 init-time, 9 M3).

**비포함 (M3b 별 plan)**: CRUD 메서드의 inline `data.attributes` → `$ref` 치환, `jsonApiBody/Response/ErrorResponse` 헬퍼의 실제 사용처 적용.

**M3 가 만드는 헬퍼는 본 phase 에서 단위 테스트로 검증되지만 production CRUD 코드에서 사용되지는 않음 — M3b 가 그 역할.**

---

## 변경 내역 요약

| 영역 | 변경 |
|---|---|
| `src/core/lib/documentation/syncSchemas.ts` | NEW — analyzer 1개 → 모든 model 의 3변형 + JsonApiError 등록 |
| `tests/unit/documentation/syncSchemas.test.ts` | NEW — mock analyzer 로 등록 검증 |
| `tests/integration/documentation/sync-schemas.test.ts` | NEW — 실제 PrismaSchemaAnalyzer 모킹 + DocumentationGenerator 통합 검증 |
| `src/core/lib/expressRouter.ts` | `initializeSchemaAnalyzer` 의 autoRegisterAllModels 호출 직후 sync 호출 |
| `src/core/lib/documentation/jsonApiHelpers.ts` | NEW — `jsonApiBody`, `jsonApiResponse`, `jsonApiErrorResponse` 헬퍼 (M3b 준비, 본 phase 에서는 미사용) |
| `tests/unit/documentation/jsonApiHelpers.test.ts` | NEW |
| `src/core/lib/documentation/index.ts` | barrel 에 신규 모듈 추가 |

---

## Task 1: syncSchemas helper 모듈

**Files:**
- Create: `E:\Projects\express.js-kusto\src\core\lib\documentation\syncSchemas.ts`
- Create: `E:\Projects\express.js-kusto\tests\unit\documentation\syncSchemas.test.ts`

`PrismaSchemaAnalyzer` 1개 → 모든 model 을 3변형으로 변환 + `DocumentationGenerator.registerSchema` 호출.

### Step 1: 실패하는 테스트 작성

Create `tests/unit/documentation/syncSchemas.test.ts`:

```ts
import { syncSchemasFromAnalyzer, registerJsonApiErrorSchema } from '@lib/documentation/syncSchemas';
import { DocumentationGenerator } from '@lib/documentationGenerator';
import { PrismaModelInfo } from '@lib/crudSchemaTypes';
import { snapshotEnv } from '../../_setup/env-fixture';

const sampleModel: PrismaModelInfo = {
    name: 'User',
    fields: [
        { name: 'id', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: true, isUnique: true, isReadOnly: false, isGenerated: true, isUpdatedAt: false },
        { name: 'email', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: true, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
        { name: 'role', type: 'Role', jsType: 'Role', isOptional: false, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
    ],
    relations: [],
    indexes: [],
    uniqueConstraints: [],
    primaryKey: { fields: ['id'] },
};

// Mock analyzer — 실제 PrismaSchemaAnalyzer 의 최소 인터페이스만 충족
function createMockAnalyzer(models: PrismaModelInfo[], enums: Record<string, string[]> = {}) {
    return {
        getDatabaseName: () => 'default',
        getAllModels: () => models,
        getEnumValues: (name: string) => enums[name],
        isEnumType: (name: string) => name in enums,
    } as any;
}

describe('syncSchemas', () => {
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

    describe('syncSchemasFromAnalyzer', () => {
        it('각 model 에 대해 3변형 스키마를 등록한다', () => {
            const analyzer = createMockAnalyzer([sampleModel]);

            syncSchemasFromAnalyzer(analyzer, 'default');

            const spec = DocumentationGenerator.generateOpenAPISpec();
            const schemas = spec.components?.schemas || {};
            expect(schemas).toHaveProperty('User');
            expect(schemas).toHaveProperty('UserAttributes');
            expect(schemas).toHaveProperty('UserRelationships');
        });

        it('enum 타입을 감지하고 별도 schema 로 등록한다', () => {
            const analyzer = createMockAnalyzer([sampleModel], { Role: ['ADMIN', 'USER'] });

            syncSchemasFromAnalyzer(analyzer, 'default');

            const spec = DocumentationGenerator.generateOpenAPISpec();
            const schemas = spec.components?.schemas || {};
            expect(schemas).toHaveProperty('Role');
            expect((schemas.Role as any).enum).toEqual(['ADMIN', 'USER']);
        });

        it('동일 model 이름이 두 번 등록되면 같은 키로 덮어쓴다 (충돌 없음)', () => {
            const analyzer1 = createMockAnalyzer([sampleModel]);
            const analyzer2 = createMockAnalyzer([sampleModel]);

            syncSchemasFromAnalyzer(analyzer1, 'default');
            syncSchemasFromAnalyzer(analyzer2, 'default');

            const spec = DocumentationGenerator.generateOpenAPISpec();
            const schemas = spec.components?.schemas || {};
            expect(schemas.User).toBeDefined();
        });

        it('AUTO_DOCS 가 비활성일 때 등록을 skip 한다', () => {
            process.env.AUTO_DOCS = 'false';
            const analyzer = createMockAnalyzer([sampleModel]);

            syncSchemasFromAnalyzer(analyzer, 'default');

            // generateOpenAPISpec 자체가 throw — AUTO_DOCS 가 꺼져 있어서.
            expect(() => DocumentationGenerator.generateOpenAPISpec()).toThrow(/Documentation is not enabled/);
        });

        it('빈 model 배열일 때 어떤 스키마도 등록하지 않는다', () => {
            const analyzer = createMockAnalyzer([]);

            syncSchemasFromAnalyzer(analyzer, 'default');

            const spec = DocumentationGenerator.generateOpenAPISpec();
            expect(Object.keys(spec.components?.schemas || {})).toEqual([]);
        });
    });

    describe('registerJsonApiErrorSchema', () => {
        it('JsonApiError 스키마를 한 번 등록한다', () => {
            registerJsonApiErrorSchema();

            const spec = DocumentationGenerator.generateOpenAPISpec();
            const schemas = spec.components?.schemas || {};
            expect(schemas).toHaveProperty('JsonApiError');
            expect((schemas.JsonApiError as any).properties.errors).toBeDefined();
        });

        it('두 번 호출해도 idempotent (같은 내용 덮어쓰기)', () => {
            registerJsonApiErrorSchema();
            registerJsonApiErrorSchema();

            const spec = DocumentationGenerator.generateOpenAPISpec();
            expect(spec.components?.schemas?.JsonApiError).toBeDefined();
        });
    });
});
```

### Step 2: 테스트 실패 확인

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/unit/documentation/syncSchemas.test.ts 2>&1 | tail -15
```
Expected: FAIL — `Cannot find module '@lib/documentation/syncSchemas'`.

### Step 3: 구현 작성

Create `src/core/lib/documentation/syncSchemas.ts`:

```ts
import { PrismaSchemaAnalyzer } from '@lib/prismaSchemaAnalyzer';
import { DocumentationGenerator } from '@lib/documentationGenerator';
import { jsonApiResource, jsonApiAttributes, jsonApiRelationships, jsonApiErrorObject } from './jsonApiSchemas';
import { enumToOpenApi } from './dmmfToOpenApi';
import { log } from '@ext/winston';

/**
 * 분석기 1개 → 모든 model 의 JSON:API 3변형 (Resource / Attributes / Relationships)
 * 와 enum 들을 DocumentationGenerator.registerSchema 로 등록.
 *
 * AUTO_DOCS off 또는 production 에서는 즉시 return — registerSchema 자체도 가드 있으나
 * 호출 비용도 절약하기 위해 진입에서 차단.
 */
export function syncSchemasFromAnalyzer(analyzer: PrismaSchemaAnalyzer, databaseName: string): void {
    if (!isEnabled()) return;

    const models = analyzer.getAllModels();
    const enumValuesByName = collectEnumValues(analyzer, models);

    for (const enumName of enumValuesByName.keys()) {
        const values = enumValuesByName.get(enumName)!;
        DocumentationGenerator.registerSchema(enumName, enumToOpenApi(enumName, values));
    }

    for (const model of models) {
        DocumentationGenerator.registerSchema(model.name, jsonApiResource(model, enumValuesByName));
        DocumentationGenerator.registerSchema(`${model.name}Attributes`, jsonApiAttributes(model, enumValuesByName));
        DocumentationGenerator.registerSchema(`${model.name}Relationships`, jsonApiRelationships(model));
    }

    log.Debug('Documentation schemas synced', {
        databaseName,
        modelCount: models.length,
        enumCount: enumValuesByName.size,
    });
}

/**
 * 공통 JSON:API errors[] 응답 본문 schema 등록.
 * 본 함수는 idempotent — 여러 번 호출해도 같은 내용 덮어쓰기.
 */
export function registerJsonApiErrorSchema(): void {
    if (!isEnabled()) return;
    DocumentationGenerator.registerSchema('JsonApiError', jsonApiErrorObject());
}

function isEnabled(): boolean {
    return process.env.NODE_ENV !== 'production' && process.env.AUTO_DOCS === 'true';
}

/**
 * 모델 필드들 중 enum 타입을 찾아 값과 함께 모음.
 * analyzer.isEnumType / getEnumValues 가 있으면 사용; 없으면 빈 Map.
 */
function collectEnumValues(analyzer: PrismaSchemaAnalyzer, models: { fields: Array<{ type: string }> }[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (typeof (analyzer as any).isEnumType !== 'function') return map;

    for (const model of models) {
        for (const field of model.fields) {
            if ((analyzer as any).isEnumType(field.type) && !map.has(field.type)) {
                const values = (analyzer as any).getEnumValues?.(field.type);
                if (Array.isArray(values) && values.length > 0) {
                    map.set(field.type, values);
                }
            }
        }
    }
    return map;
}
```

### Step 4: 테스트 통과 확인

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/unit/documentation/syncSchemas.test.ts 2>&1 | tail -15
```
Expected: PASS — 7 tests passed.

### Step 5: index.ts barrel 에 추가

Edit `src/core/lib/documentation/index.ts` — 파일 내용 끝에 추가:

```ts
export * from './syncSchemas';
```

(기존 export 들 다음 줄에)

### Step 6: 컴파일 + 회귀 확인

Run:
```bash
cd /e/Projects/express.js-kusto && npx tsc --noEmit -p tsconfig.test.json 2>&1 | grep -E "documentation|syncSchemas" | head -5
cd /e/Projects/express.js-kusto && npx jest 2>&1 | tail -5
```
Expected: 0 컴파일 에러, 200/200 TC PASS (193 + 7).

### Step 7: 커밋

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/documentation/syncSchemas.ts src/core/lib/documentation/index.ts tests/unit/documentation/syncSchemas.test.ts && git commit -m "feat(docs): syncSchemas 헬퍼 — DMMF → components.schemas 동기화"
```

---

## Task 2: expressRouter 의 initializeSchemaAnalyzer 에 sync hook 추가

**Files:**
- Modify: `src/core/lib/expressRouter.ts` (initializeSchemaAnalyzer 메서드만)

기존 `crudSchemaRegistry.autoRegisterAllModels(analyzer, databaseName)` 호출 직후 `syncSchemasFromAnalyzer(analyzer, databaseName)` 추가. 한 번만 등록되는 `JsonApiError` 도 첫 DB init 시 함께 등록.

### Step 1: import 추가

`src/core/lib/expressRouter.ts` 상단의 import 영역에 추가:

```ts
import { syncSchemasFromAnalyzer, registerJsonApiErrorSchema } from './documentation';
```

(기존 다른 documentation 관련 import 와 함께)

### Step 2: initializeSchemaAnalyzer 안에 sync 호출 추가

기존 메서드 (line ~140) 의 for 루프 안 (`autoRegisterAllModels` 호출 직후) 에 두 줄 추가:

```ts
            // 각 데이터베이스별로 한 번씩만 초기화
            for (const databaseName of availableDatabases) {
                if (ExpressRouter.initializedDatabases.has(databaseName)) {
                    continue;
                }

                const prismaClient = await prismaManager.getClient(databaseName);
                if (prismaClient) {
                    const analyzer = PrismaSchemaAnalyzer.getInstance(prismaClient, databaseName);

                    // 모든 모델을 자동으로 등록 (기존)
                    this.schemaRegistry.autoRegisterAllModels(analyzer, databaseName);

                    // Documentation 시스템에도 sync (NEW)
                    syncSchemasFromAnalyzer(analyzer, databaseName);

                    ExpressRouter.initializedDatabases.add(databaseName);
                }
            }

            // JsonApiError 는 DB 와 무관 — 루프 밖에서 한 번만 (NEW)
            registerJsonApiErrorSchema();
```

### Step 3: 컴파일 + 기존 테스트 통과 확인

Run:
```bash
cd /e/Projects/express.js-kusto && npx tsc --noEmit -p tsconfig.test.json 2>&1 | grep -E "expressRouter" | head -10
cd /e/Projects/express.js-kusto && npx jest 2>&1 | tail -5
```
Expected: 0 에러, 200/200 TC PASS.

### Step 4: 커밋

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/expressRouter.ts && git commit -m "feat(docs): expressRouter init 에 documentation sync hook 추가"
```

---

## Task 3: 통합 테스트 — sync 가 실제 expressRouter init 흐름에서 동작

**Files:**
- Create: `tests/integration/documentation/sync-schemas.test.ts`

기존 `tests/integration/_shared/test-app.ts` 의 `buildTestApp` + `applyPrismaManagerMock` 인프라 (Spec B 가 만든 것) 를 재사용. 실제 ExpressRouter 가 mock PrismaManager 와 함께 초기화될 때 schemas 가 채워지는지 검증.

### Step 1: 기존 인프라 확인

Run:
```bash
cd /e/Projects/express.js-kusto && cat tests/integration/_shared/test-app.ts | head -50
cd /e/Projects/express.js-kusto && cat tests/_fixtures/test-schema.sqlite.prisma | head -20
```

확인 포인트:
- `buildTestApp` 시그니처
- `applyPrismaManagerMock` 시그니처 — analyzer 도 같이 mock 하는지
- test-schema 의 모델명 (User / Post 등)

이 정보로 테스트 작성. 만약 인프라가 analyzer mock 을 지원 안 하면 BLOCKED + 인프라 변경 필요 보고.

### Step 2: 테스트 작성

Create `tests/integration/documentation/sync-schemas.test.ts`. 작성 시 step 1 에서 파악한 인프라에 맞게 조정.

대략적인 형태:

```ts
import { DocumentationGenerator } from '@lib/documentationGenerator';
import { PrismaSchemaAnalyzer } from '@lib/prismaSchemaAnalyzer';
import { syncSchemasFromAnalyzer, registerJsonApiErrorSchema } from '@lib/documentation';
import { snapshotEnv } from '../../_setup/env-fixture';

// 실제 prisma client 인스턴스를 만드는 fixture (db-fixture 사용)
import { initializeSqliteFixture, teardownSqliteFixture } from '../../_setup/db-fixture';

describe('syncSchemasFromAnalyzer 통합', () => {
    let restoreEnv: () => void;
    let prismaClient: any;

    beforeAll(async () => {
        restoreEnv = snapshotEnv();
        process.env.AUTO_DOCS = 'true';
        process.env.NODE_ENV = 'development';
        prismaClient = await initializeSqliteFixture();
    });

    afterAll(async () => {
        await teardownSqliteFixture(prismaClient);
        restoreEnv();
    });

    beforeEach(() => {
        DocumentationGenerator.reset();
    });

    it('실제 PrismaSchemaAnalyzer 와 sync 후 components.schemas 가 채워진다', () => {
        const analyzer = PrismaSchemaAnalyzer.getInstance(prismaClient, 'default');

        syncSchemasFromAnalyzer(analyzer, 'default');
        registerJsonApiErrorSchema();

        const spec = DocumentationGenerator.generateOpenAPISpec();
        const schemas = spec.components?.schemas || {};

        expect(Object.keys(schemas).length).toBeGreaterThan(0);
        expect(schemas).toHaveProperty('JsonApiError');

        // 각 model 마다 3변형이 등록됐는지 확인
        const models = analyzer.getAllModels();
        for (const model of models) {
            expect(schemas).toHaveProperty(model.name);
            expect(schemas).toHaveProperty(`${model.name}Attributes`);
            expect(schemas).toHaveProperty(`${model.name}Relationships`);
        }
    });

    it('AUTO_DOCS off 일 때 schemas 가 비어 있다', async () => {
        const analyzer = PrismaSchemaAnalyzer.getInstance(prismaClient, 'default');

        // 임시로 환경변수 끄기
        const oldAutoDocs = process.env.AUTO_DOCS;
        process.env.AUTO_DOCS = 'false';
        try {
            syncSchemasFromAnalyzer(analyzer, 'default');
            // 이 시점에는 generateOpenAPISpec 자체가 throw
            expect(() => DocumentationGenerator.generateOpenAPISpec()).toThrow();
        } finally {
            process.env.AUTO_DOCS = oldAutoDocs;
        }
    });
});
```

**Step 1 의 fixture API 가 다르면** import path / 함수명 / 호출 방식을 그것에 맞게 조정. 실제 fixture 가 prismaClient 를 어떻게 노출하는지 확인 필수.

### Step 3: 테스트 실행

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/integration/documentation/sync-schemas.test.ts 2>&1 | tail -20
```
Expected: PASS — 2 tests passed.

만약 fixture 사용법이 잘못됐으면 step 1 결과를 다시 보고 수정. 한 번 시도해서 안 되면 BLOCKED 보고.

### Step 4: 전체 테스트 회귀 확인

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest 2>&1 | tail -5
```
Expected: 202/202 TC PASS (200 + 2).

### Step 5: 커밋

```bash
cd /e/Projects/express.js-kusto && git add tests/integration/documentation/sync-schemas.test.ts && git commit -m "test(docs): syncSchemas 통합 테스트 — 실제 PrismaSchemaAnalyzer 와 함께 검증"
```

---

## Task 4: jsonApiHelpers — CRUD 마이그레이션용 헬퍼 (M3b 준비)

**Files:**
- Create: `src/core/lib/documentation/jsonApiHelpers.ts`
- Create: `tests/unit/documentation/jsonApiHelpers.test.ts`

CRUD 메서드가 본 helper 를 호출해 inline 스키마 대신 `$ref` 로 작성하게 됨 (M3b 가 적용). 본 phase 에서는 헬퍼만 만들고 단위 테스트로 검증.

3 함수:
- `jsonApiBody(modelName, op)` → JSON:API request body 형식 (data.{type, id?, attributes(=$ref), relationships?})
- `jsonApiResponse(modelName, code)` → JSON:API single response 형식 (data: $ref)
- `jsonApiErrorResponse(code)` → errors: $ref to JsonApiError

이 함수들은 OpenAPI schema (JSON object) 를 반환. validator 의 `Schema` 타입과 호환되지 않을 수 있음 — 별 타입으로 반환.

### Step 1: 실패하는 테스트 작성

Create `tests/unit/documentation/jsonApiHelpers.test.ts`:

```ts
import {
    jsonApiBody,
    jsonApiResponse,
    jsonApiErrorResponse,
} from '@lib/documentation/jsonApiHelpers';

describe('jsonApiHelpers', () => {
    describe('jsonApiBody', () => {
        it("'create' op 일 때 data.type/attributes 를 가진 schema 를 만들고 attributes 는 {Model}Attributes 로 ref", () => {
            const body = jsonApiBody('User', 'create');
            expect(body.type).toBe('object');
            expect(body.required).toEqual(['data']);
            expect((body.properties as any).data.type).toBe('object');
            expect((body.properties as any).data.required).toEqual(expect.arrayContaining(['type', 'attributes']));
            expect((body.properties as any).data.properties.attributes).toEqual({ $ref: '#/components/schemas/UserAttributes' });
            expect((body.properties as any).data.properties.type).toBeDefined();
        });

        it("'update' op 일 때 data.id 도 required 다", () => {
            const body = jsonApiBody('User', 'update');
            expect((body.properties as any).data.required).toEqual(expect.arrayContaining(['type', 'id', 'attributes']));
        });
    });

    describe('jsonApiResponse', () => {
        it('단일 resource 응답 형식 (data: $ref) 을 만든다', () => {
            const resp = jsonApiResponse('User', 200);
            expect(resp.type).toBe('object');
            expect((resp.properties as any).data).toEqual({ $ref: '#/components/schemas/User' });
        });
    });

    describe('jsonApiErrorResponse', () => {
        it('errors: $ref to JsonApiError 형식의 schema 를 만든다', () => {
            const resp = jsonApiErrorResponse(404);
            expect(resp.type).toBe('object');
            expect(resp.required).toEqual(['errors']);
            expect((resp.properties as any).errors).toEqual({ $ref: '#/components/schemas/JsonApiError' });
        });
    });
});
```

### Step 2: 테스트 실패 확인

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/unit/documentation/jsonApiHelpers.test.ts 2>&1 | tail -15
```
Expected: FAIL — module not found.

### Step 3: 구현 작성

Create `src/core/lib/documentation/jsonApiHelpers.ts`:

```ts
import { OpenApiObjectSchema } from './openApiTypes';

/**
 * CRUD 라우트가 등록할 JSON:API request body schema 를 생성.
 * - 'create': data.type/attributes 만 required, id 옵셔널 (server-side 생성).
 * - 'update': data.type/id/attributes 모두 required.
 * attributes 는 {Model}Attributes 로 $ref (M3 의 syncSchemas 가 미리 등록).
 */
export function jsonApiBody(modelName: string, op: 'create' | 'update'): OpenApiObjectSchema {
    const dataRequired = op === 'update' ? ['type', 'id', 'attributes'] : ['type', 'attributes'];

    return {
        type: 'object',
        required: ['data'],
        properties: {
            data: {
                type: 'object',
                required: dataRequired,
                properties: {
                    type: { type: 'string' },
                    id: { type: 'string' },
                    attributes: { $ref: `#/components/schemas/${modelName}Attributes` },
                    relationships: { $ref: `#/components/schemas/${modelName}Relationships` },
                },
            } as any,
        },
    };
}

/**
 * 단일 resource 응답: data 가 {Model} resource object.
 */
export function jsonApiResponse(modelName: string, _statusCode: number): OpenApiObjectSchema {
    return {
        type: 'object',
        required: ['data'],
        properties: {
            data: { $ref: `#/components/schemas/${modelName}` },
        },
    };
}

/**
 * 4xx/5xx 응답: errors 배열이 JsonApiError 의 errors[] 와 동일.
 */
export function jsonApiErrorResponse(_statusCode: number): OpenApiObjectSchema {
    return {
        type: 'object',
        required: ['errors'],
        properties: {
            errors: { $ref: '#/components/schemas/JsonApiError' },
        },
    };
}
```

`jsonApiBody/Response/ErrorResponse` 모두 `_statusCode` 파라미터를 받지만 본 phase 에서는 사용 안 함 (M3b 에서 4xx 의 description, 적절한 응답 코드별 schema 분기 등으로 활용 예정). 시그니처 안정성 확보용.

### Step 4: 테스트 통과 확인

Run:
```bash
cd /e/Projects/express.js-kusto && npx jest tests/unit/documentation/jsonApiHelpers.test.ts 2>&1 | tail -15
```
Expected: PASS — 4 tests passed.

### Step 5: index.ts barrel 에 추가

`src/core/lib/documentation/index.ts` 에 추가:

```ts
export * from './jsonApiHelpers';
```

### Step 6: 컴파일 + 전체 회귀

Run:
```bash
cd /e/Projects/express.js-kusto && npx tsc --noEmit -p tsconfig.test.json 2>&1 | grep -E "documentation|jsonApiHelpers" | head -5
cd /e/Projects/express.js-kusto && npx jest 2>&1 | tail -5
```
Expected: 0 에러, 206/206 TC PASS (202 + 4).

### Step 7: 커밋

```bash
cd /e/Projects/express.js-kusto && git add src/core/lib/documentation/jsonApiHelpers.ts src/core/lib/documentation/index.ts tests/unit/documentation/jsonApiHelpers.test.ts && git commit -m "feat(docs): jsonApiHelpers — body/response/errorResponse \$ref 헬퍼 (M3b 준비)"
```

---

## Task 5: 동작 동일성 smoke 검증

**Files:** (수정 없음)

M3 의 가시 동작 변화 (components.schemas 가 채워짐) 가 dev mode 에서 실제로 동작하는지 마지막 확인.

### Step 1: smoke 스크립트 실행

Run:
```bash
cd /e/Projects/express.js-kusto && cat > smoke-m3.js << 'EOF'
process.env.NODE_ENV = 'development';
process.env.AUTO_DOCS = 'true';

require('module-alias/register');
require('ts-node/register/transpile-only');

const { DocumentationGenerator } = require('./src/core/lib/documentationGenerator');
const { syncSchemasFromAnalyzer, registerJsonApiErrorSchema } = require('./src/core/lib/documentation');

DocumentationGenerator.reset();

// Mock analyzer
const mockAnalyzer = {
    getDatabaseName: () => 'default',
    getAllModels: () => [
        {
            name: 'User',
            fields: [
                { name: 'id', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: true, isUnique: true, isReadOnly: false, isGenerated: true, isUpdatedAt: false },
                { name: 'email', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: true, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
            ],
            relations: [],
            indexes: [],
            uniqueConstraints: [],
            primaryKey: { fields: ['id'] },
        },
    ],
    isEnumType: () => false,
    getEnumValues: () => undefined,
};

syncSchemasFromAnalyzer(mockAnalyzer, 'default');
registerJsonApiErrorSchema();

DocumentationGenerator.registerRoute({
    method: 'GET',
    path: '/users/:id',
    contentType: 'jsonapi',
    summary: 'Get user',
    parameters: { params: { id: { type: 'string', required: true } } },
    responses: { 200: { data: { type: 'object', required: true } } },
});

const spec = DocumentationGenerator.generateOpenAPISpec();

console.log('openapi:', spec.openapi);
console.log('schemas:', JSON.stringify(Object.keys(spec.components.schemas).sort()));
console.log('paths:', JSON.stringify(Object.keys(spec.paths)));
EOF
node smoke-m3.js 2>&1 | grep -v "DEBUG\|tslib"
rm -f smoke-m3.js
```
Expected:
- `openapi: 3.1.0`
- `schemas: ["JsonApiError","User","UserAttributes","UserRelationships"]`
- `paths: ["/users/{id}"]`

### Step 2: TaskUpdate 만 (commit 없음)

```bash
cd /e/Projects/express.js-kusto && git status
```
Expected: working tree clean.

---

## 자기 점검 (Self-review)

- **Spec § 5.2 syncDocumentationSchemas**: Task 1, 2 가 구현 ✓
- **Spec § 5.2 registerSchema 신규 메서드**: M1 Task 11 에서 이미 추가됨 ✓
- **Spec § 5.4 jsonApiBody/Response/ErrorResponse 헬퍼**: Task 4 가 구현 ✓
- **Spec § 6.1 init-time 흐름**: Task 2 가 wiring (단계 5 가 단계 6 보다 앞) — 다만 lazy async 라 strict 순서는 아님. 실용상 race 없음 (server boot vs first /docs 요청 사이의 시간).
- **Spec § 8 테스트 **`sync-schemas.test.ts`**: Task 3 ✓
- **Spec § 9 M3 핵심 항목**: 4 항목 중 3 (sync wiring, registerSchema, helpers) — CRUD 28 site 마이그레이션은 **M3b 로 deferred** (명시).

**Placeholder scan**: 0건.

**Type 일관성**: `OpenApiObjectSchema` 가 헬퍼 반환 타입. 기존 `documentation/` 모듈 일관.

**Spec deviation 명시**:
- spec 의 design 은 syncDocumentationSchemas 를 Core.initialize 에서 직접 호출. 본 plan 은 expressRouter 의 기존 lazy init 에 hook. 이유: 기존 패턴 활용으로 변경 최소화. 실용상 동등.
- CRUD 인라인 → $ref 치환은 별도 plan (M3b). 명시적 deferral.

---

## 완료 기준 (Definition of Done)

- 모든 5 task 의 체크박스 체크.
- `npx jest` PASS — 206 TC (M2 의 193 + Task 1 의 +7 + Task 3 의 +2 + Task 4 의 +4 = 206).
- `npx tsc --noEmit -p tsconfig.test.json` 0 에러.
- smoke (Task 5) 가 components.schemas 에 `User`, `UserAttributes`, `UserRelationships`, `JsonApiError` 등록 확인.
- Git log 에 4개의 의미 단위 commit.
- working tree clean.
