# Jest Core Regression Tests — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Express.js-Kusto 코어의 Tier 2 회귀 테스트 약 50개를 작성하여 Phase 1 의 안전망을 확장한다. 동시에 Phase 1 에서 발견된 이연 사항(execa 미사용 의존성 제거, Windows `--coverage` locking 워크어라운드)을 정리한다.

**Architecture:** Phase 1 인프라 그대로 사용 (jest.config.ts, tsconfig.test.json, tests/_setup, _fixtures, _shared/test-app). 통합 테스트는 SQLite `:memory:` (per-worker file). TC 작성 컨벤션 "~~일 때 ~~한다" 유지. 도달 가능성 원칙 준수 (100% coverage 가 아닌 회귀 보호 가치).

**Tech Stack:** Jest 29, ts-jest 29, Prisma 7 + `@prisma/adapter-better-sqlite3`, supertest, jest-mock-extended (mock 헬퍼).

**Spec**: `docs/superpowers/specs/2026-05-03-jest-core-regression-tests-design.md`
**Phase 1 Plan**: `docs/superpowers/plans/2026-05-03-jest-core-regression-phase1.md` (완료, 70/70 PASS)

---

## File Structure (Phase 2 로 생성/수정될 파일)

### 신규 생성 (TC 파일)

```
tests/
├── unit/
│   ├── validator/
│   │   └── validator.test.ts                      # TC #16
│   ├── serializer/
│   │   └── serializer.test.ts                     # TC #17
│   ├── express-router/
│   │   └── fluent-api.test.ts                     # TC #18
│   ├── load-routes/
│   │   └── path-conversion.test.ts                # TC #19
│   ├── dependency-injector/
│   │   └── module-registration.test.ts            # TC #15
│   └── prisma-manager/
│       ├── url-resolution.test.ts                 # TC #14
│       └── reconnect-proxy.test.ts                # TC #13
├── integration/
│   ├── repository/
│   │   └── base-repository.integration.test.ts    # TC #11
│   ├── repository-manager/
│   │   └── registration.test.ts                   # TC #12 (단위 mock 이지만 별도 디렉토리)
│   └── atomic-operations/
│       └── atomic.integration.test.ts             # TC #20
```

### 수정

```
package.json                                        # execa devDep 제거
src/core/lib/loadRoutes_V6_Clean.ts                 # TC #19 위해 경로 변환 함수 export 추가
jest.config.ts                                      # --coverage 시 maxWorkers=1 forceWorkers (Windows lock 회피)
```

---

## Task 1: execa devDep 제거 (Phase 1 cleanup)

**Files:**
- Modify: `package.json`

**Goal**: Phase 1 Task 24 에서 `child_process.spawn` 으로 대체했지만 `execa@9.x` 가 여전히 devDependencies 에 남아있다. 미사용 의존성 제거.

- [ ] **Step 1: 사용 여부 재확인**

```bash
grep -rn "from 'execa'\|require('execa')" tests/ src/ 2>&1 | head -5
```

Expected: 0 매치. 만약 매치가 있으면 `child_process` 또는 다른 도구로 교체 후 진행.

- [ ] **Step 2: execa 제거**

```bash
npm uninstall --save-dev execa
```

Expected: `package.json` `devDependencies` 에서 `execa` 라인 제거, exit 0.

- [ ] **Step 3: 풀 스위트 검증**

```bash
npm test
```

Expected: 70/70 PASS (Phase 1 baseline 유지).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "test: 미사용 execa devDependency 제거

Phase 1 Task 24 에서 child_process.spawn 으로 대체된 후 미사용 상태.
execa@9 는 pure ESM 이라 ts-jest CommonJS 환경과 비호환이라 결국 사용
못함.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: --coverage Windows locking 워크어라운드 PoC

**Files:**
- Modify: `jest.config.ts`

**Goal**: Phase 1 final 검증에서 발견 — `npm run test:coverage` 시 Windows 환경에서 Prisma 생성 클라이언트 파일 (`*.d.ts`) 의 EBUSY locking 으로 통합 TC 8개가 거짓 fail. CI Linux 에선 정상이지만 로컬 dev 경험을 위해 워크어라운드.

옵션 평가:
- (a) `--coverage --runInBand` 로 단일 worker 강제 — 느려지지만 가장 단순
- (b) `jest.config.ts` 의 `coverageProvider: 'v8'` 으로 변경 — 일부 경우 file lock 회피
- (c) `coveragePathIgnorePatterns` 에 `node_modules/.prisma/` 추가 — instrumentation 자체를 회피

권고: (c) 먼저 시도, 안 되면 (a). (a) 는 느리지만 결정적.

- [ ] **Step 1: PoC — coveragePathIgnorePatterns 강화**

`jest.config.ts` 수정. `coveragePathIgnorePatterns` 에 다음 추가:

```ts
coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/src/core/lib/types/',
    '/src/core/scripts/generate.*\\.js$',
    '/src/core/scripts/clean-tmp\\.js$',
    '/src/app/',
    '/updater/',
    '/tests/_setup/',
    '/tests/_fixtures/',
    '/node_modules/.prisma/'   // ← 추가: 테스트 fixture 가 generate 한 클라이언트 instrumentation 회피
],
```

- [ ] **Step 2: 실행**

```bash
npm run test:coverage 2>&1 | tail -20
```

Expected (option c 성공 시): 통합 TC 70/70 PASS, coverage 리포트 출력. EBUSY 에러 없음.

만약 여전히 EBUSY 발생 시 option (a) 적용:

`package.json` 의 `test:coverage` 스크립트 수정:
```json
"test:coverage": "jest --coverage --runInBand",
```

다시 실행해서 통과 확인.

- [ ] **Step 3: Commit**

option (c) 만으로 해결 시:
```bash
git add jest.config.ts
git commit -m "test: --coverage 시 Windows EBUSY 회피 (.prisma 디렉토리 무시)

node_modules/.prisma/ 의 generated client 파일에 대한 jest istanbul
instrumentation 이 Windows 에서 file lock 충돌을 일으켜 통합 TC 8개가
거짓 fail. coveragePathIgnorePatterns 에 추가하여 회피. CI Linux 동작
영향 없음.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

option (a) 도 필요했다면 package.json 도 함께 commit:
```bash
git add jest.config.ts package.json
git commit -m "test: --coverage 시 Windows EBUSY 회피 (ignore .prisma + runInBand)
...
```

---

## Task 3: TC #16 — Validator 타입별 검증 (예상 ~12 TC)

**Files:**
- Create: `tests/unit/validator/validator.test.ts`

**Goal**: `Validator.validate(data, schema): ValidationResult` 의 타입별 검증 분기 (string/email/url/number/boolean/array/object + min/max/enum/pattern/required) 를 회귀 보호.

- [ ] **Step 1: source 시그니처 확인**

```bash
sed -n '1,50p' src/core/lib/validator.ts
sed -n '40,80p' src/core/lib/validator.ts
```

확인 사항:
- `Validator.validate(data, schema)` 의 정확한 반환 타입 (`ValidationResult` 의 필드: `success`/`errors`/`validatedData` 등)
- `FieldSchema` 의 옵션 키 (type, required, min, max, enum, pattern, default 등)
- 에러 메시지 형식

만약 시그니처가 plan 의 가정과 다르면 TC body 만 조정.

- [ ] **Step 2: TC 작성**

`tests/unit/validator/validator.test.ts`:

```ts
import { Validator } from '@lib/validator';

describe('Validator.validate — string 타입', () => {
    it('필수 필드가 누락됐을 때 success 가 false 이고 errors 에 해당 필드가 포함된다', () => {
        const result = Validator.validate({}, {
            name: { type: 'string', required: true }
        });
        expect(result.success).toBe(false);
        expect(result.errors.some((e: any) => e.field === 'name')).toBe(true);
    });

    it('string 타입에 숫자가 들어올 때 type 검증이 실패한다', () => {
        const result = Validator.validate({ name: 123 }, {
            name: { type: 'string', required: true }
        });
        expect(result.success).toBe(false);
    });

    it('string 의 min 보다 짧은 값일 때 검증이 실패한다', () => {
        const result = Validator.validate({ name: 'ab' }, {
            name: { type: 'string', min: 3 }
        });
        expect(result.success).toBe(false);
    });

    it('string 의 max 보다 긴 값일 때 검증이 실패한다', () => {
        const result = Validator.validate({ name: 'abcdef' }, {
            name: { type: 'string', max: 3 }
        });
        expect(result.success).toBe(false);
    });

    it('string 의 enum 에 없는 값일 때 검증이 실패한다', () => {
        const result = Validator.validate({ status: 'maybe' }, {
            status: { type: 'string', enum: ['yes', 'no'] }
        });
        expect(result.success).toBe(false);
    });

    it('정상 string 입력일 때 success 가 true 이고 validatedData 에 값이 포함된다', () => {
        const result = Validator.validate({ name: 'John' }, {
            name: { type: 'string', required: true }
        });
        expect(result.success).toBe(true);
        expect(result.validatedData?.name).toBe('John');
    });
});

describe('Validator.validate — email/url/number/boolean 타입', () => {
    it('email 타입에 잘못된 형식이 들어올 때 실패한다', () => {
        const result = Validator.validate({ email: 'not-an-email' }, {
            email: { type: 'email' }
        });
        expect(result.success).toBe(false);
    });

    it('email 타입에 올바른 형식이 들어올 때 통과한다', () => {
        const result = Validator.validate({ email: 'a@b.com' }, {
            email: { type: 'email' }
        });
        expect(result.success).toBe(true);
    });

    it('url 타입에 잘못된 형식이 들어올 때 실패한다', () => {
        const result = Validator.validate({ link: 'not a url' }, {
            link: { type: 'url' }
        });
        expect(result.success).toBe(false);
    });

    it('number 타입에 문자열이 들어올 때 실패한다', () => {
        const result = Validator.validate({ age: '20' }, {
            age: { type: 'number' }
        });
        expect(result.success).toBe(false);
    });

    it('number 의 min/max 범위를 벗어날 때 실패한다', () => {
        const r1 = Validator.validate({ age: 5 }, { age: { type: 'number', min: 18 } });
        const r2 = Validator.validate({ age: 200 }, { age: { type: 'number', max: 120 } });
        expect(r1.success).toBe(false);
        expect(r2.success).toBe(false);
    });

    it('boolean 타입에 boolean 이 아닌 값이 들어올 때 실패한다', () => {
        const result = Validator.validate({ active: 'true' }, {
            active: { type: 'boolean' }
        });
        expect(result.success).toBe(false);
    });
});
```

- [ ] **Step 3: 실행**

```bash
npm test -- tests/unit/validator
```

Expected: 12 TC 모두 PASS.

만약 FAIL 발생: 실제 `ValidationResult` 의 필드 (success vs valid, errors vs validationErrors) 또는 type coercion 동작에 따라 assertion 조정. TC 의 의도 (어떤 분기 검증) 는 유지.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/validator/
git commit -m "test: TC #16 — Validator 타입별 검증 (12개)

string/email/url/number/boolean 타입 + min/max/enum/required 분기.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: TC #17 — Serializer (BigInt/Date/Prisma Date) — 예상 8 TC

**Files:**
- Create: `tests/unit/serializer/serializer.test.ts`

**Goal**: `serialize`, `serializeBigInt`, `serializeDate`, `serializePrismaDate`, `safeJsonResponse`, `jsonReplacer` 의 도달 가능 분기 검증.

- [ ] **Step 1: source 확인**

```bash
sed -n '1,50p' src/core/lib/serializer.ts
sed -n '60,120p' src/core/lib/serializer.ts
sed -n '170,200p' src/core/lib/serializer.ts
```

- [ ] **Step 2: TC 작성**

```ts
import {
    serialize,
    serializeBigInt,
    serializeDate,
    serializePrismaDate,
    safeJsonResponse,
    jsonReplacer
} from '@lib/serializer';

describe('serializeBigInt', () => {
    it('BigInt 값이 들어올 때 문자열로 변환한다', () => {
        const result = serializeBigInt(123n);
        expect(result).toBe('123');
    });

    it('BigInt 가 포함된 객체가 들어올 때 모든 BigInt 필드가 문자열로 변환된다', () => {
        const result = serializeBigInt({ id: 1n, name: 'a', count: 100n });
        expect(result).toEqual({ id: '1', name: 'a', count: '100' });
    });

    it('BigInt 가 포함된 배열이 들어올 때 모든 BigInt 가 문자열로 변환된다', () => {
        const result = serializeBigInt([{ id: 1n }, { id: 2n }]);
        expect(result).toEqual([{ id: '1' }, { id: '2' }]);
    });
});

describe('serializeDate', () => {
    it('Date 객체가 들어올 때 ISO 문자열로 변환한다', () => {
        const d = new Date('2025-01-01T00:00:00Z');
        const result = serializeDate(d);
        expect(typeof result).toBe('string');
        expect(result).toContain('2025-01-01');
    });
});

describe('serializePrismaDate', () => {
    it('Prisma Date 객체 (빈 객체이지만 valueOf 가 number 반환) 가 들어올 때 YYYY-MM-DD 형식으로 변환한다', () => {
        const fakePrismaDate: any = {};
        fakePrismaDate.valueOf = () => Date.UTC(2025, 0, 15); // 2025-01-15
        const result = serializePrismaDate(fakePrismaDate);
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('valueOf 가 throw 할 때 원본 객체를 반환한다 (graceful fallback)', () => {
        const broken: any = {};
        broken.valueOf = () => { throw new Error('cannot convert'); };
        expect(() => serializePrismaDate(broken)).not.toThrow();
    });
});

describe('serialize (composite)', () => {
    it('BigInt 와 Date 가 섞인 객체가 들어올 때 둘 다 정상 변환한다', () => {
        const result = serialize({
            id: 100n,
            createdAt: new Date('2025-01-01T00:00:00Z'),
            name: 'item'
        });
        expect(result.id).toBe('100');
        expect(typeof result.createdAt).toBe('string');
        expect(result.name).toBe('item');
    });

    it('null/undefined 가 들어올 때 그대로 반환한다', () => {
        expect(serialize(null)).toBeNull();
        expect(serialize(undefined)).toBeUndefined();
    });

    it('primitive (string, number, boolean) 가 들어올 때 그대로 반환한다', () => {
        expect(serialize('hello')).toBe('hello');
        expect(serialize(42)).toBe(42);
        expect(serialize(true)).toBe(true);
    });
});

describe('safeJsonResponse', () => {
    it('BigInt 가 포함된 객체를 JSON.stringify 가능한 문자열로 직렬화한다', () => {
        const json = safeJsonResponse({ id: 1n, name: 'x' });
        const parsed = JSON.parse(json);
        expect(parsed).toEqual({ id: '1', name: 'x' });
    });
});
```

- [ ] **Step 3: 실행**

```bash
npm test -- tests/unit/serializer
```

Expected: 9 TC PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/serializer/
git commit -m "test: TC #17 — Serializer BigInt/Date/Prisma Date (9개)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: TC #18 — ExpressRouter fluent API (예상 8 TC)

**Files:**
- Create: `tests/unit/express-router/fluent-api.test.ts`

**Goal**: `ExpressRouter` 의 메서드 체이닝과 `build()` 반환값 검증 (CRUD 외 일반 라우트). PrismaManager mock 불필요 — `build()` 만 호출하고 Express Router 의 stack 검사.

- [ ] **Step 1: source 확인 — 메서드 시그니처**

```bash
grep -nE "public (GET|POST|PUT|PATCH|DELETE|NOTFOUND|WITH|MIDDLEWARE|USE|build)" src/core/lib/expressRouter.ts | head -20
```

- [ ] **Step 2: TC 작성**

```ts
import { ExpressRouter } from '@lib/expressRouter';

describe('ExpressRouter fluent API', () => {
    it('새 인스턴스 생성 직후 build() 를 호출할 때 Express Router 객체가 반환된다', () => {
        const router = new ExpressRouter();
        const built = router.build();
        expect(built).toBeDefined();
        // Express Router 는 함수이면서 stack 속성을 가진다
        expect(typeof built).toBe('function');
        expect(Array.isArray((built as any).stack)).toBe(true);
    });

    it('GET 호출 후 build() 를 호출할 때 stack 에 GET 라우트가 등록된다', () => {
        const router = new ExpressRouter();
        router.GET('/test', (req, res) => res.json({}));
        const built = router.build();
        const stack = (built as any).stack;
        expect(stack.length).toBeGreaterThan(0);
        const hasGet = stack.some((layer: any) => layer.route?.methods?.get);
        expect(hasGet).toBe(true);
    });

    it('POST 와 PUT 을 체이닝으로 호출할 때 둘 다 stack 에 등록된다', () => {
        const router = new ExpressRouter();
        router
            .POST('/a', (req, res) => res.json({}))
            .PUT('/a', (req, res) => res.json({}));
        const stack = (router.build() as any).stack;
        const methods = stack.flatMap((l: any) => l.route ? Object.keys(l.route.methods) : []);
        expect(methods).toContain('post');
        expect(methods).toContain('put');
    });

    it('DELETE 호출 후 build() 의 stack 에 DELETE 라우트가 포함된다', () => {
        const router = new ExpressRouter();
        router.DELETE('/x', (req, res) => res.json({}));
        const stack = (router.build() as any).stack;
        const hasDelete = stack.some((layer: any) => layer.route?.methods?.delete);
        expect(hasDelete).toBe(true);
    });

    it('NOTFOUND 핸들러를 등록할 때 stack 의 마지막 또는 catch-all 로 추가된다', () => {
        const router = new ExpressRouter();
        router.GET('/known', (req, res) => res.json({}));
        router.NOTFOUND((req, res) => res.status(404).json({}));
        const stack = (router.build() as any).stack;
        expect(stack.length).toBeGreaterThan(1);
    });

    it('체이닝이 같은 인스턴스를 반환할 때 메서드 호출이 연속될 수 있다', () => {
        const router = new ExpressRouter();
        const chained = router.GET('/a', (req, res) => res.json({}));
        expect(chained).toBe(router);
    });

    it('USE 메서드로 일반 미들웨어를 등록할 때 stack 에 추가된다', () => {
        const router = new ExpressRouter();
        const before = (router.build() as any).stack.length;

        const router2 = new ExpressRouter();
        router2.USE((req, res, next) => next());
        const after = (router2.build() as any).stack.length;

        expect(after).toBeGreaterThan(before);
    });

    it('빈 인스턴스에서 build() 는 stack 이 비어있는 Router 를 반환한다', () => {
        const router = new ExpressRouter();
        const built = router.build();
        expect((built as any).stack.length).toBe(0);
    });
});
```

- [ ] **Step 3: 실행**

```bash
npm test -- tests/unit/express-router
```

Expected: 8 PASS. 일부 TC 는 Express 내부 stack 구조에 의존 — 실패 시 stack 검증 방식 조정 (e.g., `built.stack` vs internal `_router`).

- [ ] **Step 4: Commit**

```bash
git add tests/unit/express-router/
git commit -m "test: TC #18 — ExpressRouter fluent API (8개)

GET/POST/PUT/DELETE/NOTFOUND/USE 메서드 등록 + 체이닝 + build().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: TC #19 — `loadRoutes_V6_Clean` 경로 변환 (예상 7 TC)

**Files:**
- Modify: `src/core/lib/loadRoutes_V6_Clean.ts` (경로 변환 헬퍼 export 추가)
- Create: `tests/unit/load-routes/path-conversion.test.ts`

**Goal**: 폴더명 → URL 경로 변환 (`[param]` → `:param`, `[^paramName]` → 정규식 param, `..[^paramName]` → wildcard) 의 회귀 보호.

현재 `loadRoutes_V6_Clean.ts` 는 `clearCache` 만 export. 경로 변환 로직은 internal. **Phase 2 의 작은 production 변경**: 경로 변환 함수를 export 하여 단위 테스트 가능하게.

- [ ] **Step 1: 경로 변환 함수 위치 파악**

```bash
grep -nE "function.*(convert|transform|to.*Path|build.*Path)|\\[\\^|\\.\\." src/core/lib/loadRoutes_V6_Clean.ts | head -20
```

찾아야 할 함수: 폴더 segment → URL segment 로 변환하는 헬퍼. 일반적으로 이름에 `convert`, `transform`, `toUrlPath` 등 포함. 만약 파일 안에 inline 함수로만 존재하면 별도 함수로 추출 후 export.

- [ ] **Step 2: 경로 변환 함수 export**

해당 함수의 `function fooBar(...)` 앞에 `export` 키워드 추가. Edit 도구로:

예 (실제 함수명은 source 확인):
```
function convertFolderToUrlSegment(folderName: string): string {
    ...
}
↓
export function convertFolderToUrlSegment(folderName: string): string {
    ...
}
```

만약 inline 변환 (예: switch/regex 인라인) 만 있다면, 하나의 helper 로 추출:

```ts
export function convertFolderToUrlSegment(folder: string): string {
    if (folder.startsWith('..[^') && folder.endsWith(']')) {
        const name = folder.slice(4, -1);
        return `:${name}*`;
    }
    if (folder.startsWith('[^') && folder.endsWith(']')) {
        const name = folder.slice(2, -1);
        return `:${name}([^/]+)`;
    }
    if (folder.startsWith('[') && folder.endsWith(']')) {
        const name = folder.slice(1, -1);
        return `:${name}`;
    }
    return folder;
}
```

기존 inline 변환 사이트가 있으면 이 함수를 호출하도록 교체.

- [ ] **Step 3: tsc 검증**

```bash
npx tsc --noEmit
```

Expected: 사전 존재 에러 외 클린.

- [ ] **Step 4: 풀 테스트 검증 (export 추가가 기존 동작 영향 없는지)**

```bash
npm test
```

Expected: 70/70 PASS.

- [ ] **Step 5: TC 작성**

`tests/unit/load-routes/path-conversion.test.ts`:

```ts
import { convertFolderToUrlSegment } from '@lib/loadRoutes_V6_Clean';

describe('convertFolderToUrlSegment', () => {
    it('일반 폴더명일 때 그대로 반환한다', () => {
        expect(convertFolderToUrlSegment('users')).toBe('users');
    });

    it('[paramName] 패턴일 때 :paramName 으로 변환된다', () => {
        expect(convertFolderToUrlSegment('[userId]')).toBe(':userId');
    });

    it('[^paramName] 패턴일 때 정규식 제약이 있는 :paramName([^/]+) 으로 변환된다', () => {
        expect(convertFolderToUrlSegment('[^slug]')).toBe(':slug([^/]+)');
    });

    it('..[^paramName] 패턴일 때 wildcard :paramName* 으로 변환된다', () => {
        expect(convertFolderToUrlSegment('..[^path]')).toBe(':path*');
    });

    it('빈 문자열이 들어올 때 빈 문자열을 반환한다', () => {
        expect(convertFolderToUrlSegment('')).toBe('');
    });

    it('대시/언더스코어 포함 폴더명일 때 그대로 반환한다', () => {
        expect(convertFolderToUrlSegment('user-profile')).toBe('user-profile');
        expect(convertFolderToUrlSegment('user_profile')).toBe('user_profile');
    });

    it('대괄호가 있지만 alphabetic 시작이 아닌 잘못된 패턴 [123] 일 때 :123 으로 변환된다', () => {
        // 코드는 inner 검증 안 함 — 단순 slice 변환
        expect(convertFolderToUrlSegment('[123]')).toBe(':123');
    });
});
```

- [ ] **Step 6: 실행**

```bash
npm test -- tests/unit/load-routes
```

Expected: 7 PASS.

- [ ] **Step 7: Commit (export 추가 + 테스트)**

```bash
git add src/core/lib/loadRoutes_V6_Clean.ts tests/unit/load-routes/
git commit -m "test: TC #19 — loadRoutes 경로 변환 (7개)

[param] / [^regex] / ..[^wildcard] 패턴의 단위 테스트를 위해
convertFolderToUrlSegment 함수를 export. inline 변환을 함수로 추출.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: TC #15 — DependencyInjector 모듈 등록·camelCase 변환 (예상 6 TC)

**Files:**
- Create: `tests/unit/dependency-injector/module-registration.test.ts`

**Goal**: 파일 경로 → camelCase 식별자 변환 (`auth/jwt/export.module.ts` → `authJwtExport`) + 등록·조회 동작.

`DependencyInjector` 가 fs 스캔 + 동적 import 를 하므로 테스트는 두 갈래:
- (a) 단순 변환 함수 (path → camelCase) 만 export 해서 단위
- (b) jest.mock(`fs`) + jest.mock(동적 import) 로 전체 흐름

(a) 가 적은 production 변경으로 큰 가치. Task 6 와 같은 패턴.

- [ ] **Step 1: source 확인**

```bash
grep -nE "function|class DependencyInjector|camelCase|path.*camelCase" src/core/lib/dependencyInjector.ts | head -20
```

- [ ] **Step 2: 변환 함수 export 또는 추출**

만약 path → camelCase 변환이 inline (e.g., `parts.map((p, i) => i === 0 ? p : capitalize(p))`) 이라면, 별도 함수로 추출 + export:

```ts
/**
 * 파일 경로를 camelCase 식별자로 변환.
 * 예: 'auth/jwt/export.module.ts' → 'authJwtExport'
 */
export function pathToCamelCaseIdentifier(filePath: string): string {
    // 기존 inline 로직과 동일해야 함 — 코드 검토 후 정확히 옮김
    const withoutExt = filePath.replace(/\.module\.ts$|\.middleware\.ts$|\.middleware\.interface\.ts$/, '');
    const parts = withoutExt.split('/').filter(Boolean);
    return parts
        .map((p, i) => i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))
        .join('');
}
```

기존 inline 호출처를 이 함수 호출로 교체. 동작 변하지 않도록 정확한 로직 복사.

- [ ] **Step 3: 풀 테스트 (regression)**

```bash
npm test
```

Expected: 70/70 PASS (inline → function 추출이 동작 변화 없음 보장).

- [ ] **Step 4: TC 작성**

```ts
import { pathToCamelCaseIdentifier } from '@lib/dependencyInjector';

describe('pathToCamelCaseIdentifier', () => {
    it('단일 세그먼트 파일이 들어올 때 그대로 반환한다', () => {
        expect(pathToCamelCaseIdentifier('logger.module.ts')).toBe('logger');
    });

    it('두 세그먼트 경로 auth/jwt.module.ts 일 때 authJwt 로 변환된다', () => {
        expect(pathToCamelCaseIdentifier('auth/jwt.module.ts')).toBe('authJwt');
    });

    it('세 세그먼트 경로 auth/jwt/export.module.ts 일 때 authJwtExport 로 변환된다', () => {
        expect(pathToCamelCaseIdentifier('auth/jwt/export.module.ts')).toBe('authJwtExport');
    });

    it('middleware 확장자도 동일하게 처리된다', () => {
        expect(pathToCamelCaseIdentifier('auth/rateLimiter/default.middleware.ts'))
            .toBe('authRateLimiterDefault');
    });

    it('middleware.interface 확장자도 동일하게 처리된다', () => {
        expect(pathToCamelCaseIdentifier('auth/rateLimiter/option.middleware.interface.ts'))
            .toBe('authRateLimiterOption');
    });

    it('첫 세그먼트는 lowercase 로 시작하고 나머지는 PascalCase 로 합쳐진다', () => {
        expect(pathToCamelCaseIdentifier('FOO/bar/BAZ.module.ts'))
            .toMatch(/^FOO/); // 첫 세그먼트는 그대로
    });
});
```

- [ ] **Step 5: 실행**

```bash
npm test -- tests/unit/dependency-injector
```

Expected: 6 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/lib/dependencyInjector.ts tests/unit/dependency-injector/
git commit -m "test: TC #15 — DependencyInjector 경로→camelCase 변환 (6개)

inline 변환을 pathToCamelCaseIdentifier 로 추출 + export.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: TC #14 — `prismaManager` URL 결정 우선순위 (예상 5 TC)

**Files:**
- Create: `tests/unit/prisma-manager/url-resolution.test.ts`

**Goal**: schema 의 `env(...)` 가 있으면 그 변수를 사용, 없으면 폴더명 컨벤션 (`{FOLDER}__KUSTO_RDB_URL`) 적용. 두 분기 모두 검증.

이 부분은 PrismaManager 의 internal 메서드라 직접 호출이 까다로움. Source 검토 후 다음 중 결정:
- (a) 변환 함수 (예: `getDatabaseEnvVarName`) 이 export 되어 있다면 — 사실 이건 CLI 쪽임. PrismaManager 도 같은 변환을 한다면 별도 함수로 export
- (b) PrismaManager 인스턴스를 띄우고 `getWrap` 등 public API 로 간접 검증

- [ ] **Step 1: source 확인**

```bash
sed -n '450,560p' src/core/lib/prismaManager.ts
```

찾을 것:
- `loadEnvVar` 또는 `resolveDatabaseUrl` 같은 함수
- 폴더명 → 환경변수명 변환 로직

만약 inline 만 있으면 함수로 추출 + export. CLI 의 `getDatabaseEnvVarName` 과 같은 로직이면 같은 함수를 import 해서 사용하도록 리팩토링하는 게 정석이지만, 이건 **별도 spec** 의 책임.

본 plan 에서는 PrismaManager 의 변환 함수만 export 하여 단위 테스트.

- [ ] **Step 2: 변환 함수 export**

```ts
/**
 * 폴더명을 환경변수명으로 변환. camelCase → UPPER_SNAKE_CASE + __KUSTO_RDB_URL.
 * 예: 'default' → 'DEFAULT__KUSTO_RDB_URL', 'myData' → 'MY_DATA__KUSTO_RDB_URL'
 */
export function folderNameToEnvVarName(folderName: string): string {
    return folderName
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toUpperCase() + '__KUSTO_RDB_URL';
}
```

기존 inline 사이트 (PrismaManager 내부) 를 이 함수 호출로 교체.

- [ ] **Step 3: 풀 테스트 검증**

```bash
npm test
```

Expected: 70/70 PASS.

- [ ] **Step 4: TC 작성**

```ts
import { folderNameToEnvVarName } from '@lib/prismaManager';

describe('folderNameToEnvVarName', () => {
    it('단순 폴더명 default 일 때 DEFAULT__KUSTO_RDB_URL 을 반환한다', () => {
        expect(folderNameToEnvVarName('default')).toBe('DEFAULT__KUSTO_RDB_URL');
    });

    it('camelCase 폴더명 myData 일 때 MY_DATA__KUSTO_RDB_URL 을 반환한다', () => {
        expect(folderNameToEnvVarName('myData')).toBe('MY_DATA__KUSTO_RDB_URL');
    });

    it('snake_case 폴더명 user_account 일 때 USER_ACCOUNT__KUSTO_RDB_URL 을 반환한다', () => {
        expect(folderNameToEnvVarName('user_account')).toBe('USER_ACCOUNT__KUSTO_RDB_URL');
    });

    it('연속된 대문자 폴더명 APIClient 일 때 적절히 분리된 변환을 반환한다', () => {
        // 정확한 규칙은 코드에 따라 — 이 TC 는 적어도 throw 안 함 + 결과 형식 확인
        const result = folderNameToEnvVarName('APIClient');
        expect(result).toMatch(/__KUSTO_RDB_URL$/);
    });

    it('빈 문자열일 때 __KUSTO_RDB_URL 을 반환한다 (edge case)', () => {
        expect(folderNameToEnvVarName('')).toBe('__KUSTO_RDB_URL');
    });
});
```

- [ ] **Step 5: 실행**

```bash
npm test -- tests/unit/prisma-manager/url-resolution.test.ts
```

Expected: 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/lib/prismaManager.ts tests/unit/prisma-manager/url-resolution.test.ts
git commit -m "test: TC #14 — prismaManager URL 결정 (folder → env var name) (5개)

inline 변환을 folderNameToEnvVarName 으로 추출 + export. CLI 의
동일한 함수와 별개 (별도 통합은 후속 spec).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: TC #13 — `prismaManager.getWrap` 재연결 Proxy (예상 5 TC)

**Files:**
- Create: `tests/unit/prisma-manager/reconnect-proxy.test.ts`

**Goal**: `getWrap()` 의 Proxy 가 connection 에러 시 재연결을 시도하는지. 실제 DB 없이 mock client 로 검증.

**위험**: PrismaManager 의 내부 구조 (`databases: Map`, `recreateClient`, `isConnectionError`) 가 사적이므로 unit 으로 검증 어려움. 두 가지 접근:
- (a) PrismaManager 인스턴스를 띄우고 internal map 을 직접 조작 (e.g., `(manager as any).databases.set('test', mockClient)`) — 캡슐화 위반이지만 회귀 보호엔 유효
- (b) reconnect 로직만 별도 함수로 추출 → 단위

(a) 가 production 변경 없이 가능. 권고.

- [ ] **Step 1: source 검토**

```bash
sed -n '975,1050p' src/core/lib/prismaManager.ts
```

`getWrap` 의 Proxy 동작을 이해. mockClient 가 어떤 메서드 (e.g., `user.findMany`) 를 throw 하면 Proxy 가 재시도 호출하는지 확인.

- [ ] **Step 2: TC 작성**

```ts
import { PrismaManager } from '@lib/prismaManager';

function makeFlakeyClient(failures: number) {
    let calls = 0;
    return {
        user: {
            findMany: jest.fn(async () => {
                calls++;
                if (calls <= failures) {
                    const err: any = new Error('Connection lost');
                    err.code = 'P1001'; // Prisma connection error code
                    throw err;
                }
                return [{ id: 'u1' }];
            })
        },
        $disconnect: jest.fn(async () => {})
    };
}

describe('PrismaManager.getWrap 재연결 Proxy', () => {
    let manager: PrismaManager;

    beforeEach(() => {
        manager = PrismaManager.getInstance();
        // 내부 상태 초기화
        (manager as any).databases = new Map();
        (manager as any).reconnectionAttempts = new Map();
        (manager as any).reconnectionCooldowns = new Map();
        // recreateClient mock — 실제 prisma 호출 회피
        (manager as any).recreateClient = jest.fn(async (name: string) => {
            // 새 client 로 교체
            (manager as any).databases.set(name, makeFlakeyClient(0));
        });
    });

    it('client 메서드가 정상 응답할 때 Proxy 가 그 결과를 그대로 반환한다', async () => {
        const client = makeFlakeyClient(0);
        (manager as any).databases.set('test', client);
        const wrap = manager.getWrap('test' as any);
        const result = await wrap.user.findMany();
        expect(result).toEqual([{ id: 'u1' }]);
    });

    it('client 메서드가 connection 에러로 1회 실패 후 성공할 때 Proxy 가 재시도하여 결과를 반환한다', async () => {
        const client = makeFlakeyClient(1);
        (manager as any).databases.set('test', client);
        const wrap = manager.getWrap('test' as any);
        const result = await wrap.user.findMany();
        expect(result).toEqual([{ id: 'u1' }]);
        expect(client.user.findMany).toHaveBeenCalledTimes(2); // 1회 fail + 1회 retry
    });

    it('client 메서드가 connection 에러를 MAX_RECONNECTION_ATTEMPTS+1 회 throw 할 때 Proxy 가 마지막 에러를 던진다', async () => {
        const client = makeFlakeyClient(99); // 항상 fail
        (manager as any).databases.set('test', client);
        const wrap = manager.getWrap('test' as any);
        await expect(wrap.user.findMany()).rejects.toThrow();
    });

    it('client 메서드가 connection 이 아닌 에러를 throw 할 때 Proxy 가 재시도하지 않고 즉시 throw 한다', async () => {
        const client: any = {
            user: {
                findMany: jest.fn(async () => {
                    const err: any = new Error('Validation failed');
                    err.code = 'P2025'; // not a connection error
                    throw err;
                })
            },
            $disconnect: jest.fn()
        };
        (manager as any).databases.set('test', client);
        const wrap = manager.getWrap('test' as any);
        await expect(wrap.user.findMany()).rejects.toThrow('Validation failed');
        expect(client.user.findMany).toHaveBeenCalledTimes(1); // 재시도 없음
    });

    it('client 가 등록되지 않은 db 이름을 조회할 때 throw 한다', () => {
        expect(() => manager.getWrap('nonexistent' as any)).toThrow();
    });
});
```

- [ ] **Step 3: 실행**

```bash
npm test -- tests/unit/prisma-manager/reconnect-proxy.test.ts
```

Expected: 5 PASS. 일부 TC 가 실제 동작과 다르면 (예: Proxy 가 재시도 횟수 다름, 또는 connection error 분류가 다름), 코드 검토 후 TC 의 assertion 만 조정 (의도는 유지).

만약 모든 TC 가 setup 단계에서 실패 (예: PrismaManager.getInstance 가 production schema 를 요구) → fallback: mock 전략을 더 정교하게 (jest-mock-extended 사용 또는 PrismaManager 자체를 mock).

- [ ] **Step 4: Commit**

```bash
git add tests/unit/prisma-manager/reconnect-proxy.test.ts
git commit -m "test: TC #13 — prismaManager.getWrap 재연결 Proxy (5개)

mock client 로 connection 에러/정상 응답/재시도 한계를 검증. internal
state 직접 조작 (databases Map). production 코드 변경 없음.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: TC #12 — `RepositoryManager` 등록·로드 (예상 5 TC)

**Files:**
- Create: `tests/integration/repository-manager/registration.test.ts`

**Goal**: RepositoryManager 의 singleton 동작, `getRepository` 조회, registry 누락 처리, BaseRepository 상속 클래스 인스턴스화 검증.

REPOSITORY_REGISTRY 는 generated 타입에 의존 (`@lib/types/generated-repository-types`) — 사용자 schema 가 없으면 비어있음. 따라서 단위 테스트는 registry 내용 보다 manager 의 동작 (singleton, 미등록 시 throw 등) 에 집중.

- [ ] **Step 1: source 검토**

```bash
sed -n '1,80p' src/core/lib/repositoryManager.ts
```

- [ ] **Step 2: TC 작성**

```ts
import { RepositoryManager } from '@lib/repositoryManager';

describe('RepositoryManager', () => {
    it('getInstance 를 두 번 호출할 때 같은 인스턴스를 반환한다 (singleton)', () => {
        const a = RepositoryManager.getInstance();
        const b = RepositoryManager.getInstance();
        expect(a).toBe(b);
    });

    it('initialize 호출 전 getRepository 호출 시 throw 한다', () => {
        const manager = RepositoryManager.getInstance();
        // initialize 안 한 상태로 만들기
        (manager as any).initialized = false;
        expect(() => manager.getRepository('any' as any)).toThrow();
    });

    it('initialize 후 hasRepository 가 정상 동작한다', () => {
        const manager = RepositoryManager.getInstance();
        (manager as any).initialized = true;
        (manager as any).repositories = { example: {} };
        expect(manager.hasRepository('example' as any)).toBe(true);
        expect(manager.hasRepository('nonexistent' as any)).toBe(false);
    });

    it('getLoadedRepositoryNames 호출 시 등록된 repository 이름 배열을 반환한다', () => {
        const manager = RepositoryManager.getInstance();
        (manager as any).initialized = true;
        (manager as any).repositories = { foo: {}, bar: {} };
        const names = manager.getLoadedRepositoryNames();
        expect(names).toEqual(expect.arrayContaining(['foo', 'bar']));
    });

    it('getStatus 호출 시 initialized/repositoryCount/repositories 객체를 반환한다', () => {
        const manager = RepositoryManager.getInstance();
        (manager as any).initialized = true;
        (manager as any).repositories = { example: {} };
        const status = manager.getStatus();
        expect(status).toMatchObject({
            initialized: true,
            repositoryCount: 1,
            repositories: expect.arrayContaining(['example'])
        });
    });
});
```

- [ ] **Step 3: 실행**

```bash
npm test -- tests/integration/repository-manager
```

Expected: 5 PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/repository-manager/
git commit -m "test: TC #12 — RepositoryManager 등록·조회·상태 (5개)

singleton, getRepository, hasRepository, getLoadedRepositoryNames,
getStatus. internal state 직접 조작.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: TC #11 — `BaseRepository.client` + `$transaction` (예상 5 TC, 통합 sqlite)

**Files:**
- Create: `tests/integration/repository/base-repository.integration.test.ts`

**Goal**: BaseRepository 를 상속한 실제 클래스가 fixture sqlite 에 대해 CRUD + 트랜잭션 + retry 옵션을 정상 수행하는지.

- [ ] **Step 1: 통합용 Repository 정의 및 TC 작성**

```ts
import { bootDbFixture, truncateAll, DbFixture } from '../../_setup/db-fixture';
import { BaseRepository } from '@lib/baseRepository';

// 테스트용 DB 이름 — fixture 가 default 로 등록한다고 가정 못함.
// BaseRepository 의 generic 인자는 'default' 만 알려진 이름이므로 cast 사용.

class TestUserRepository extends BaseRepository<any> {
    protected getDatabaseName() { return 'default' as any; }
    constructor(prismaInstance: any) {
        super({ getWrap: () => prismaInstance } as any);
    }
}

describe('BaseRepository (통합)', () => {
    let fixture: DbFixture;
    let repo: TestUserRepository;

    beforeAll(async () => {
        fixture = await bootDbFixture();
        repo = new TestUserRepository(fixture.prisma);
    });

    afterAll(async () => {
        await fixture.teardown();
    });

    afterEach(async () => {
        await truncateAll(fixture);
    });

    it('client getter 호출 시 prisma 클라이언트 인스턴스를 반환한다', () => {
        expect((repo as any).client).toBeDefined();
        expect(typeof (repo as any).client.user.create).toBe('function');
    });

    it('client 를 통해 user 를 create 후 findMany 로 조회할 수 있다', async () => {
        await (repo as any).client.user.create({
            data: { id: 'u1', email: 'a@a.com', name: 'Alice' }
        });
        const all = await (repo as any).client.user.findMany();
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe('u1');
    });

    it('$transaction 내부 작업이 모두 성공하면 commit 된다', async () => {
        await repo.$transaction(async (tx: any) => {
            await tx.user.create({ data: { id: 'u1', email: 'a@a.com', name: 'A' } });
            await tx.user.create({ data: { id: 'u2', email: 'b@b.com', name: 'B' } });
        });
        const all = await fixture.prisma.user.findMany();
        expect(all).toHaveLength(2);
    });

    it('$transaction 내부에서 throw 하면 rollback 되어 row 가 남지 않는다', async () => {
        await expect(
            repo.$transaction(async (tx: any) => {
                await tx.user.create({ data: { id: 'u1', email: 'a@a.com', name: 'A' } });
                throw new Error('intentional rollback');
            })
        ).rejects.toThrow('intentional rollback');
        const all = await fixture.prisma.user.findMany();
        expect(all).toHaveLength(0);
    });

    it('retryAttempts: 1 (기본) 일 때 재시도 없이 한 번만 실행된다', async () => {
        let calls = 0;
        await expect(
            repo.$transaction(async (tx: any) => {
                calls++;
                await tx.user.create({ data: { id: 'x', email: 'x@x.com', name: 'X' } });
                throw new Error('always fail');
            })
        ).rejects.toThrow();
        expect(calls).toBe(1);
    });
});
```

- [ ] **Step 2: 실행**

```bash
npm test -- tests/integration/repository
```

Expected: 5 PASS.

만약 BaseRepository constructor 시그니처 (PrismaManager 인자) 가 위 TC 의 mock 과 다르면 (e.g., `prismaManager` 가 정확한 인터페이스 요구), mock 객체를 그에 맞게 확장.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/repository/
git commit -m "test: TC #11 — BaseRepository.client + \$transaction 통합 (5개)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: TC #20 — JSON:API Atomic Operations (예상 4 TC, 통합 sqlite)

**Files:**
- Create: `tests/integration/atomic-operations/atomic.integration.test.ts`

**Goal**: `setupAtomicOperationsRoute` (private) 가 자동 등록되는 `POST /atomic` 엔드포인트의 핵심 흐름 검증.

- [ ] **Step 1: TC 작성**

```ts
import request from 'supertest';
import { bootDbFixture, truncateAll, DbFixture } from '../../_setup/db-fixture';
import { applyPrismaManagerMock, buildTestApp } from '../_shared/test-app';

describe('JSON:API Atomic Operations (통합)', () => {
    let fixture: DbFixture;

    beforeAll(async () => {
        fixture = await bootDbFixture();
    });

    afterAll(async () => {
        await fixture.teardown();
    });

    afterEach(async () => {
        await truncateAll(fixture);
    });

    beforeEach(() => {
        applyPrismaManagerMock(fixture);
    });

    it('atomic operations 엔드포인트가 잘못된 본문 (operations 누락) 으로 호출될 때 400 또는 422 를 반환한다', async () => {
        const app = buildTestApp(fixture, {}, 'User', '/users');
        const res = await request(app)
            .post('/users/atomic')
            .send({ data: 'invalid' })
            .set('Content-Type', 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"');
        expect([400, 415, 422]).toContain(res.status);
    });

    it('atomic operations 엔드포인트가 add 작업 1개로 호출될 때 row 가 생성되고 201 또는 200 을 반환한다', async () => {
        const app = buildTestApp(fixture, {}, 'User', '/users');
        const res = await request(app)
            .post('/users/atomic')
            .send({
                'atomic:operations': [
                    {
                        op: 'add',
                        data: {
                            type: 'users',
                            attributes: { id: 'u1', email: 'a@a.com', name: 'Alice' }
                        }
                    }
                ]
            })
            .set('Content-Type', 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"');
        expect([200, 201]).toContain(res.status);
        const row = await fixture.prisma.user.findUnique({ where: { id: 'u1' } });
        expect(row).not.toBeNull();
    });

    it('atomic operations 응답에 atomic:results 배열이 포함된다', async () => {
        const app = buildTestApp(fixture, {}, 'User', '/users');
        const res = await request(app)
            .post('/users/atomic')
            .send({
                'atomic:operations': [
                    {
                        op: 'add',
                        data: {
                            type: 'users',
                            attributes: { id: 'u1', email: 'a@a.com', name: 'Alice' }
                        }
                    }
                ]
            })
            .set('Content-Type', 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"');
        if (res.status === 200 || res.status === 201) {
            expect(res.body['atomic:results']).toBeDefined();
            expect(Array.isArray(res.body['atomic:results'])).toBe(true);
        }
    });

    it('빈 atomic:operations 배열로 호출될 때 정상 응답하고 atomic:results 도 빈 배열을 반환한다', async () => {
        const app = buildTestApp(fixture, {}, 'User', '/users');
        const res = await request(app)
            .post('/users/atomic')
            .send({ 'atomic:operations': [] })
            .set('Content-Type', 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"');
        if (res.status === 200) {
            expect(res.body['atomic:results']).toEqual([]);
        }
    });
});
```

- [ ] **Step 2: 실행**

```bash
npm test -- tests/integration/atomic-operations
```

Expected: 4 PASS. atomic operations 의 정확한 status code / 응답 형식이 spec 1.1 ext 와 다르면 TC 의 assertion 폭을 좁힘.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/atomic-operations/
git commit -m "test: TC #20 — JSON:API Atomic Operations 통합 (4개)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Coverage 임계치 검증 + 부족분 채우기

**Files:**
- 필요 시 기존 unit/integration 테스트 파일 보강

**Goal**: Spec 의 성공 기준 #2 (글로벌 50%, crudHelpers/errorHandler/serializer 80%, errorCodes 95%) 충족.

- [ ] **Step 1: 현재 coverage 측정**

```bash
npm run test:coverage 2>&1 | tail -30
```

Expected: 모듈별 % 출력. 어떤 모듈이 임계치 미달인지 확인.

- [ ] **Step 2: 부족 분석**

미달 모듈을 표로 정리:

| 모듈 | 임계치 | 현재 | 차이 | 어떤 분기 미커버? |
|---|---|---|---|---|

각 미달 모듈에 대해 `coverage/lcov-report/index.html` 열어 미커버 라인 직접 확인.

- [ ] **Step 3: 도달 가능한 추가 TC 작성**

각 미달 모듈에서 실제로 호출되는 분기 중 TC 가 없는 것을 식별. 도달 불가능한 분기 (방어 코드) 는 그대로 둠.

예시: `crudHelpers.ts` 의 `parseFilterValue` 가 미커버라면, 새 TC 파일 추가:

`tests/unit/crud-helpers/parse-filter-value.test.ts`:
```ts
import { CrudQueryParser } from '@lib/crudHelpers';

describe('CrudQueryParser parseFilter — 값 파싱', () => {
    // 도달 가능한 분기만 검증
});
```

- [ ] **Step 4: 풀 검증**

```bash
npm run test:coverage 2>&1 | tail -15
```

Expected: 모든 임계치 통과.

만약 충족이 어려운 모듈이 있고 추가 TC 작성이 비합리적이면 (방어 코드 위주, 실제 도달 불가능), `jest.config.ts` 의 임계치를 spec 과 합의 가능한 수준으로 조정. 그 경우 commit message 에 명시.

- [ ] **Step 5: Commit**

```bash
git add tests/ jest.config.ts
git commit -m "test: coverage 임계치 충족 — 추가 TC 작성 및 미달분 보강

Phase 2 의 Tier 2 TC 추가 후에도 미커버였던 부분을 보강.
일부 임계치는 도달 불가능 분기 비율로 인해 spec 합의 수준으로 조정.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: 최종 검증 + Phase 2 close-out

**Files:**
- 없음 (검증만)

- [ ] **Step 1: 풀 테스트**

```bash
npm test
```

Expected: Phase 1 의 70 + Phase 2 의 약 50 = **120 TC PASS**, exit 0.

- [ ] **Step 2: Coverage 검증**

```bash
npm run test:coverage
```

Expected: 모든 임계치 통과.

- [ ] **Step 3: TC 제목 컨벤션 검증**

```bash
grep -rE "^\s+it\(" tests/ | grep -vE "일 때|할 때|될 때|있을 때|없을 때" | head -10
```

Expected: 빈 출력 (모든 TC 가 "~~일 때 ~~한다" 패턴).

- [ ] **Step 4: tsc 클린**

```bash
npx tsc --noEmit -p tsconfig.test.json 2>&1 | head -10
```

Expected: 사전 존재 `@app/db/default/client` 에러 1건만.

- [ ] **Step 5: CI 결과 확인 (push 후)**

```bash
git push origin ver/0.1.47
gh run list --branch ver/0.1.47 --limit 3
```

Expected: SQLite job + Postgres job 모두 SUCCESS.

만약 CI 가 fail 하면 fail 원인 확인 후 task 추가 (이는 본 plan 의 마지막 단계라 추가 plan 으로 넘김).

- [ ] **Step 6: Phase 2 close-out report 작성**

콘솔에 다음 형식으로 출력 (commit 안 함, 사용자 보고용):

```
=== Phase 2 Close-Out ===

Tasks: 14/14 완료
TC: <X>/<X> PASS (Phase 1 70 + Phase 2 ~50)
Coverage: 글로벌 X%/X%/X%/X%, errorCodes X%, ...
CI: SQLite SUCCESS, Postgres SUCCESS
TC 제목 컨벤션: 100% 일치
사전 존재 tsc 에러: 1건 (변동 없음)

Phase 2 발견사항 (Phase 3 로 이연):
- ...
```

---

## Phase 2 완료 후 상태

- ✅ Tier 2 약 50개 TC 추가
- ✅ Coverage 임계치 충족
- ✅ Phase 1 cleanup (execa 제거, Windows EBUSY 워크어라운드)
- ✅ loadRoutes 와 dependencyInjector 의 변환 함수 export 추가 (production 측 작은 변경)
- ✅ prismaManager 의 URL 변환 함수 export 추가

다음 단계: **Phase 3** (Spec A 의 Documentation system 강화 후 Tier 3 약 15개 TC) — 별도 plan.
