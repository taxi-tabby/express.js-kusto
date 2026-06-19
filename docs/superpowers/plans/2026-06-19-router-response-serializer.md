# 라우터 응답 serializer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ExpressRouter의 verb/SLUG/VALIDATED 메서드에 선택적 `options.serialize`를 도입해, 핸들러 반환 타입을 IDE로 추론하면서 응답 본문에서 민감/불필요 필드를 제거·정제한다.

**Architecture:** 새 오버로드 + 옵셔널 옵션으로만 추가해 `serialize` 미지정 시 기존 경로/타입을 100% 유지(하위호환). 평범 verb는 `wrapHandler`가 핸들러 반환값을 받아 `serialize` 후 `res.json`; VALIDATED는 `HandlerConfig.serialize`를 `createHandler`로 전달해 `sendSuccess` 직전에 변형. `serialize`는 함수 `(data, req)=>S` 또는 선언형 `{pick}`/`{omit}`이며, `const` 제네릭으로 키 튜플을 리터럴 추론한다.

**Tech Stack:** TypeScript 5.8, Express 4, Jest 29 + ts-jest, supertest. 인하우스 Validator/Schema. 기존 `serializer.ts`/`serializationMiddleware`(BigInt/Date 저수준 변환).

## Global Constraints

- TypeScript `^5.8.3` — `const` 타입 파라미터(5.0+), `infer ... extends`(4.7+) 사용 가능.
- 수정 파일은 `src/core/lib/serializer.ts`, `src/core/lib/expressRouter.ts`, `src/core/lib/requestHandler.ts` 3개로 한정. (프레임워크 기능 추가이므로 CLAUDE.md "core 수정 금지" 예외.)
- **하위호환 필수**: `serialize` 미지정 시 동작·타입 불변. 기존 오버로드/시그니처는 그대로 두고 새 오버로드를 **앞에** 추가한다.
- **스코프 = 20개 메서드**: plain `GET/GET_SLUG/POST/POST_SLUG/PUT/PUT_SLUG/DELETE/DELETE_SLUG/PATCH/PATCH_SLUG` + validated `GET_VALIDATED/GET_SLUG_VALIDATED/POST_VALIDATED/POST_SLUG_VALIDATED/PUT_VALIDATED/PUT_SLUG_VALIDATED/DELETE_VALIDATED/DELETE_SLUG_VALIDATED/PATCH_VALIDATED/PATCH_SLUG_VALIDATED`. **제외(후속)**: `*_FILE`, `*_EXACT`, `*_WITH_VALIDATION`.
- jest `testMatch: tests/**/*.test.ts`. 타입 검증은 `npx tsc --noEmit -p tsconfig.test.json`(`tests/**/*.ts` 포함)로 수행 — 타입 픽스처는 `.test.ts`가 아닌 `.ts`로 둬 jest 대상에서 제외.
- 핸들러를 실제 실행하는 테스트는 `DependencyInjector.getInstance().getInjectedModules()`가 throw하지 않도록 `(DependencyInjector.getInstance() as any).initialized = true; (...).modules = {}`로 선초기화한다.
- `src/core/lib/serializer.ts` 커버리지 하한: statements 70 / branches 65 / functions 95 / lines 70 — 신규 함수는 반드시 테스트로 커버.
- 커밋 메시지는 한국어. 모든 커밋 trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- 설계 스펙: `docs/superpowers/specs/2026-06-19-router-response-serializer-design.md`

---

### Task 1: serializer.ts — 타입 + applyResponseSerializer 런타임

**Files:**
- Modify: `src/core/lib/serializer.ts` (파일 끝에 추가)
- Test: `tests/unit/serializer/response-serializer.test.ts` (신규)

**Interfaces:**
- Consumes: (없음)
- Produces:
  - `type ResponseSerializer<T> = ((data: T, req: import('express').Request) => unknown | Promise<unknown>) | { pick: readonly (keyof ArrEl<T>)[] } | { omit: readonly (keyof ArrEl<T>)[] }`
  - `type SerializedResult<T, Sz>` (조건부 타입 — pick/omit/함수 결과 추론)
  - `function applyResponseSerializer(data: unknown, sz: ResponseSerializer<any>, req: import('express').Request): Promise<unknown>`

- [ ] **Step 1: 실패 테스트 작성** — `tests/unit/serializer/response-serializer.test.ts`

```ts
import { applyResponseSerializer } from '@lib/serializer';

const fakeReq = {} as any; // serializer 함수는 req 를 사용하지 않는 케이스만 검증

describe('applyResponseSerializer', () => {
    it('함수형 serializer 는 데이터를 그대로 변형해 반환한다', async () => {
        const out = await applyResponseSerializer(
            { id: 1, password: 'x', name: 'a' },
            (u: any) => ({ id: u.id, name: u.name }),
            fakeReq
        );
        expect(out).toEqual({ id: 1, name: 'a' });
    });

    it('async 함수형 serializer 의 Promise 를 await 한다', async () => {
        const out = await applyResponseSerializer(
            { id: 1 },
            async (u: any) => ({ id: u.id, extra: true }),
            fakeReq
        );
        expect(out).toEqual({ id: 1, extra: true });
    });

    it('{omit} 는 지정 필드를 제거한다', async () => {
        const out = await applyResponseSerializer(
            { id: 1, password: 'x', ssn: '9' },
            { omit: ['password', 'ssn'] },
            fakeReq
        );
        expect(out).toEqual({ id: 1 });
    });

    it('{pick} 는 지정 필드만 남긴다', async () => {
        const out = await applyResponseSerializer(
            { id: 1, password: 'x', name: 'a' },
            { pick: ['id', 'name'] },
            fakeReq
        );
        expect(out).toEqual({ id: 1, name: 'a' });
    });

    it('{omit} 는 배열이면 원소별로 적용한다', async () => {
        const out = await applyResponseSerializer(
            [{ id: 1, password: 'x' }, { id: 2, password: 'y' }],
            { omit: ['password'] },
            fakeReq
        );
        expect(out).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('{pick} 는 배열이면 원소별로 적용한다', async () => {
        const out = await applyResponseSerializer(
            [{ id: 1, name: 'a', secret: 's' }],
            { pick: ['id', 'name'] },
            fakeReq
        );
        expect(out).toEqual([{ id: 1, name: 'a' }]);
    });

    it('null/undefined 는 그대로 통과한다 (pick/omit)', async () => {
        expect(await applyResponseSerializer(null, { omit: ['x'] }, fakeReq)).toBeNull();
        expect(await applyResponseSerializer(undefined, { pick: ['x'] }, fakeReq)).toBeUndefined();
    });

    it('존재하지 않는 키를 omit/pick 해도 안전하다', async () => {
        expect(await applyResponseSerializer({ id: 1 }, { omit: ['nope'] as any }, fakeReq)).toEqual({ id: 1 });
        expect(await applyResponseSerializer({ id: 1 }, { pick: ['nope'] as any }, fakeReq)).toEqual({});
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/unit/serializer/response-serializer.test.ts`
Expected: FAIL — `applyResponseSerializer` is not exported / not a function.

- [ ] **Step 3: 최소 구현** — `src/core/lib/serializer.ts` 파일 **맨 끝**에 추가

```ts
import type { Request } from 'express';

/** 배열이면 원소 타입, 아니면 그대로 (pick/omit 키를 원소 키로 좁히기 위함) */
type ArrEl<T> = T extends readonly (infer E)[] ? E : T;

/**
 * 라우터 응답 serializer 형태. 함수(임의 재구성/리네임) 또는 선언형 pick/omit.
 * pick/omit 키는 (배열이면) 원소 타입의 키로 제한된다.
 */
export type ResponseSerializer<T> =
    | ((data: T, req: Request) => unknown | Promise<unknown>)
    | { pick: readonly (keyof ArrEl<T>)[] }
    | { omit: readonly (keyof ArrEl<T>)[] };

/** 정제 후 응답 본문(data) 타입 계산 — IDE 추론/문서용 */
export type SerializedResult<T, Sz> =
    Sz extends (d: T, req: Request) => infer R ? Awaited<R> :
    Sz extends { pick: readonly (infer K extends keyof ArrEl<T>)[] }
        ? (T extends readonly any[] ? Pick<ArrEl<T>, K>[] : Pick<T, K>) :
    Sz extends { omit: readonly (infer K extends keyof ArrEl<T>)[] }
        ? (T extends readonly any[] ? Omit<ArrEl<T>, K>[] : Omit<T, K>) :
    never;

function pickKeys<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
    const out = {} as Pick<T, K>;
    for (const k of keys) if (k in obj) out[k] = obj[k];
    return out;
}

function omitKeys<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
    const drop = new Set<PropertyKey>(keys as readonly PropertyKey[]);
    const out: any = {};
    for (const k of Object.keys(obj)) if (!drop.has(k)) out[k] = (obj as any)[k];
    return out as Omit<T, K>;
}

/**
 * 응답 데이터에 serializer 를 적용한다.
 * - 함수형: 값 전체를 받아 그대로 변형(배열 매핑은 사용자 책임). async 허용.
 * - pick/omit: 배열이면 원소별, 단일 객체면 그대로 적용. null/undefined/원시값은 통과.
 */
export async function applyResponseSerializer(
    data: unknown,
    sz: ResponseSerializer<any>,
    req: Request
): Promise<unknown> {
    if (typeof sz === 'function') {
        return await sz(data as any, req);
    }
    if (data === null || data === undefined || typeof data !== 'object') {
        return data;
    }
    const apply = (item: any) =>
        item && typeof item === 'object'
            ? ('pick' in sz ? pickKeys(item, sz.pick as any) : omitKeys(item, sz.omit as any))
            : item;
    return Array.isArray(data) ? data.map(apply) : apply(data);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/unit/serializer/response-serializer.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: serializer 커버리지 회귀 없음 확인**

Run: `npx jest tests/unit/serializer --coverage --collectCoverageFrom=src/core/lib/serializer.ts`
Expected: PASS, `serializer.ts` functions ≥ 95% (신규 함수 모두 커버).

- [ ] **Step 6: 커밋**

```bash
git add src/core/lib/serializer.ts tests/unit/serializer/response-serializer.test.ts
git commit -m "$(cat <<'EOF'
feat(serializer): 응답 serializer 타입 + applyResponseSerializer 추가

함수형 / 선언형 pick·omit 지원. 배열은 원소별 적용, null·원시값 통과.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: requestHandler.ts — HandlerConfig.serialize + createHandler 변형 단계

**Files:**
- Modify: `src/core/lib/requestHandler.ts` (import 추가, `HandlerConfig` 19-26, `createHandler` 348-353)
- Test: `tests/unit/request-handler/serialize-wiring.test.ts` (신규)

**Interfaces:**
- Consumes: `ResponseSerializer`, `applyResponseSerializer` (Task 1)
- Produces: `HandlerConfig.serialize?: ResponseSerializer<any>` — VALIDATED 메서드(Task 5/6)가 이 필드로 serializer 를 전달.

- [ ] **Step 1: 실패 테스트 작성** — `tests/unit/request-handler/serialize-wiring.test.ts`

```ts
import { RequestHandler as CustomRequestHandler } from '@lib/requestHandler';
import { DependencyInjector } from '@lib/dependencyInjector';

beforeAll(() => {
    // 핸들러 실행 시 getInjectedModules() 가 throw 하지 않도록 DI 선초기화
    const di = DependencyInjector.getInstance() as any;
    di.initialized = true;
    di.modules = {};
});

function mockRes() {
    return {
        headersSent: false,
        statusCode: 200,
        status(c: number) { this.statusCode = c; return this; },
        json(b: any) { (this as any).body = b; this.headersSent = true; return this; },
        body: undefined as any
    };
}

describe('createHandler serialize 배선', () => {
    it('config.serialize 가 sendSuccess 이전에 적용되어 envelope.data 가 정제된다', async () => {
        const config = { serialize: { omit: ['secret'] } } as any; // response 없음 → 필터/strict 미적용
        const handler = async () => ({ id: 1, secret: 'x', name: 'a' });
        const mws = CustomRequestHandler.createHandler(config, handler);
        const last = mws[mws.length - 1];
        const res = mockRes();
        await last({} as any, res as any, (() => {}) as any);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({ id: 1, name: 'a' });
        expect(res.body.data.secret).toBeUndefined();
    });

    it('config.serialize 가 없으면 결과를 그대로 envelope 에 담는다 (회귀)', async () => {
        const config = {} as any;
        const handler = async () => ({ id: 1, secret: 'x' });
        const mws = CustomRequestHandler.createHandler(config, handler);
        const last = mws[mws.length - 1];
        const res = mockRes();
        await last({} as any, res as any, (() => {}) as any);
        expect(res.body.data).toEqual({ id: 1, secret: 'x' });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/unit/request-handler/serialize-wiring.test.ts`
Expected: FAIL — 첫 테스트에서 `data` 가 `{id,name,secret}` (serialize 미적용).

- [ ] **Step 3a: import 추가** — `src/core/lib/requestHandler.ts` 상단(2번째 import 다음 줄 등)

```ts
import { ResponseSerializer, applyResponseSerializer } from './serializer';
```

- [ ] **Step 3b: HandlerConfig 에 serialize 필드 추가** — 19-26번째 줄

기존:
```ts
export interface HandlerConfig {
    request?: RequestConfig;
    response?: ResponseConfig;
    sourceInfo?: {
        filePath: string;
        lineNumber?: number;
    };
}
```
변경:
```ts
export interface HandlerConfig {
    request?: RequestConfig;
    response?: ResponseConfig;
    serialize?: ResponseSerializer<any>;
    sourceInfo?: {
        filePath: string;
        lineNumber?: number;
    };
}
```

- [ ] **Step 3c: createHandler 의 결과 전송부에 serialize 적용** — 348-353번째 줄

기존:
```ts
                // 결과가 있으면 성공 응답 전송
                if (result !== undefined) {
                    const statusCode = res.statusCode || 200;
                    const responseSchema = config.response?.[statusCode];
                    this.sendSuccess(res, result, statusCode, responseSchema, config.response);
                }
```
변경:
```ts
                // 결과가 있으면 성공 응답 전송
                if (result !== undefined) {
                    const statusCode = res.statusCode || 200;
                    const responseSchema = config.response?.[statusCode];
                    // serialize 는 responseConfig 검증/필터(sendSuccess)보다 먼저 변형한다.
                    const out = config.serialize
                        ? await applyResponseSerializer(result, config.serialize, req)
                        : result;
                    this.sendSuccess(res, out, statusCode, responseSchema, config.response);
                }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/unit/request-handler/serialize-wiring.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/requestHandler.ts tests/unit/request-handler/serialize-wiring.test.ts
git commit -m "$(cat <<'EOF'
feat(request-handler): HandlerConfig.serialize + createHandler 변형 단계

VALIDATED 경로에서 핸들러 결과를 sendSuccess(responseConfig 검증) 이전에 정제.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: expressRouter.ts — wrapHandler 확장 + GET/GET_SLUG serialize 오버로드

**Files:**
- Modify: `src/core/lib/expressRouter.ts` (import 14, `wrapHandler` 222-232, `GET` 337-359, `GET_SLUG` 376-399)
- Test: `tests/integration/response-serializer/plain-get.integration.test.ts` (신규, supertest)

**Interfaces:**
- Consumes: `ResponseSerializer`, `applyResponseSerializer` (Task 1)
- Produces: `wrapHandler(handler, serialize?)` — Task 4의 나머지 plain verb 들이 동일 시그니처로 호출.

- [ ] **Step 1: 실패 테스트 작성** — `tests/integration/response-serializer/plain-get.integration.test.ts`

```ts
import express from 'express';
import request from 'supertest';
import { ExpressRouter } from '@lib/expressRouter';
import { DependencyInjector } from '@lib/dependencyInjector';

beforeAll(() => {
    const di = DependencyInjector.getInstance() as any;
    di.initialized = true;
    di.modules = {};
});

function appWith(build: (r: ExpressRouter) => void) {
    const router = new ExpressRouter();
    build(router);
    const app = express();
    app.use(router.build());
    return app;
}

describe('plain GET serialize (옵션 파라미터)', () => {
    it('{omit} 으로 민감 필드를 제거해 응답한다', async () => {
        const app = appWith(r =>
            r.GET(async () => ({ id: 1, password: 'secret', name: 'kim' }),
                  { serialize: { omit: ['password'] } }));
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ id: 1, name: 'kim' });
    });

    it('{pick} 으로 노출 필드만 응답한다', async () => {
        const app = appWith(r =>
            r.GET(async () => ({ id: 1, password: 'secret', name: 'kim' }),
                  { serialize: { pick: ['id', 'name'] } }));
        const res = await request(app).get('/');
        expect(res.body).toEqual({ id: 1, name: 'kim' });
    });

    it('함수형 serializer 로 재구성해 응답한다', async () => {
        const app = appWith(r =>
            r.GET(async () => ({ id: 1, first: 'a', last: 'b' }),
                  { serialize: (u) => ({ id: u.id, full: `${u.first} ${u.last}` }) }));
        const res = await request(app).get('/');
        expect(res.body).toEqual({ id: 1, full: 'a b' });
    });

    it('배열 응답에 {omit} 을 원소별 적용한다', async () => {
        const app = appWith(r =>
            r.GET(async () => [{ id: 1, password: 'x' }, { id: 2, password: 'y' }],
                  { serialize: { omit: ['password'] } }));
        const res = await request(app).get('/');
        expect(res.body).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('serialize 미지정 시 기존 동작(핸들러가 직접 res.json) 유지 (회귀)', async () => {
        const app = appWith(r =>
            r.GET((req, res) => { res.json({ id: 1, password: 'kept' }); }));
        const res = await request(app).get('/');
        expect(res.body).toEqual({ id: 1, password: 'kept' });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/integration/response-serializer/plain-get.integration.test.ts`
Expected: FAIL — `serialize` 오버로드가 없어 컴파일 에러 또는 omit 미적용(`password` 포함).

- [ ] **Step 3a: import 확장** — 14번째 줄

기존:
```ts
import { serializeBigInt, serialize } from './serializer';
```
변경:
```ts
import { serializeBigInt, serialize, ResponseSerializer, applyResponseSerializer } from './serializer';
```

- [ ] **Step 3b: wrapHandler 확장** — 222-232번째 줄 전체 교체

```ts
    private wrapHandler(
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => any,
        serialize?: ResponseSerializer<any>
    ): RequestHandler {
        return async (req: Request, res: Response, next: NextFunction) => {
            try {
                // Dependency injector에서 모든 injectable 모듈 가져오기
                const injected = DependencyInjector.getInstance().getInjectedModules();
                const result = await handler(req, res, injected, repositoryManager, prismaManager);
                // serialize 지정 시에만 반환값을 정제해 전송(미지정 시 기존 동작 유지).
                if (serialize && !res.headersSent && result !== undefined) {
                    res.json(await applyResponseSerializer(result, serialize, req));
                }
            } catch (error) {
                next(error);
            }
        };
    }
```

- [ ] **Step 3c: GET 오버로드 추가** — 337번째 줄 `public GET(...)` 시그니처 1줄을 아래로 교체 (본문은 `this.router.get` 줄만 수정)

기존 시그니처(337):
```ts
    public GET(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.get('/', this.wrapHandler(handler));
```
변경(오버로드 2개 + 구현 시그니처 + serialize 추출):
```ts
    public GET<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz }
    ): ExpressRouter;
    public GET(handler: HandlerFunction, options?: object): ExpressRouter;
    public GET(handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        this.router.get('/', this.wrapHandler(handler, serialize));
```
(338번째 줄 이하 문서 등록·`return this` 본문은 변경하지 않는다.)

- [ ] **Step 3d: GET_SLUG 오버로드 추가** — 376번째 줄

기존 시그니처(376) + 본문 시작:
```ts
    public GET_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter {
        const slugPath = this.convertSlugsToPath(slug);
        this.router.get(slugPath, this.wrapHandler(handler));
```
변경:
```ts
    public GET_SLUG<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz }
    ): ExpressRouter;
    public GET_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter;
    public GET_SLUG(slug: string[], handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        const slugPath = this.convertSlugsToPath(slug);
        this.router.get(slugPath, this.wrapHandler(handler, serialize));
```
(이하 문서 등록·`return this` 본문 변경 없음.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/integration/response-serializer/plain-get.integration.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: 기존 라우터 테스트 회귀 없음 확인**

Run: `npx jest tests/unit/express-router/fluent-api.test.ts`
Expected: PASS (기존 8 tests 그대로).

- [ ] **Step 6: 커밋**

```bash
git add src/core/lib/expressRouter.ts tests/integration/response-serializer/plain-get.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(router): wrapHandler serialize 지원 + GET/GET_SLUG 오버로드

serialize 지정 시 핸들러 반환값을 정제해 전송. 미지정 시 기존 동작 유지.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: expressRouter.ts — 나머지 plain verb serialize 오버로드

**Files:**
- Modify: `src/core/lib/expressRouter.ts` (`POST` 408, `POST_SLUG` 442, `PUT` 643, `PUT_SLUG` 852, `DELETE` 887, `DELETE_SLUG` 923, `PATCH` 958, `PATCH_SLUG` 995)
- Test: `tests/integration/response-serializer/plain-verbs.integration.test.ts` (신규)

**Interfaces:**
- Consumes: `wrapHandler(handler, serialize?)` (Task 3)
- Produces: 8개 plain verb 의 serialize 오버로드.

각 메서드는 **동일 패턴**이다: ① 기존 시그니처 1줄 → 오버로드 2개 + 구현 시그니처로 교체, ② 본문 첫 줄에 `const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;` 추가, ③ `this.wrapHandler(handler)` → `this.wrapHandler(handler, serialize)`. **나머지 본문(문서 등록 등)은 변경 금지.**

- [ ] **Step 1: 실패 테스트 작성** — `tests/integration/response-serializer/plain-verbs.integration.test.ts`

```ts
import express from 'express';
import request from 'supertest';
import { ExpressRouter } from '@lib/expressRouter';
import { DependencyInjector } from '@lib/dependencyInjector';

beforeAll(() => {
    const di = DependencyInjector.getInstance() as any;
    di.initialized = true;
    di.modules = {};
});

function appWith(build: (r: ExpressRouter) => void) {
    const router = new ExpressRouter();
    build(router);
    const app = express();
    app.use(express.json());
    app.use(router.build());
    return app;
}

describe('나머지 plain verb serialize', () => {
    it('POST {omit}', async () => {
        const app = appWith(r => r.POST(async () => ({ id: 1, password: 'x' }), { serialize: { omit: ['password'] } }));
        const res = await request(app).post('/');
        expect(res.body).toEqual({ id: 1 });
    });
    it('PUT {pick}', async () => {
        const app = appWith(r => r.PUT(async () => ({ id: 1, a: 1, b: 2 }), { serialize: { pick: ['id', 'a'] } }));
        const res = await request(app).put('/');
        expect(res.body).toEqual({ id: 1, a: 1 });
    });
    it('PATCH 함수형', async () => {
        const app = appWith(r => r.PATCH(async () => ({ id: 1, t: 'x' }), { serialize: (u) => ({ id: u.id }) }));
        const res = await request(app).patch('/');
        expect(res.body).toEqual({ id: 1 });
    });
    it('DELETE {omit}', async () => {
        const app = appWith(r => r.DELETE(async () => ({ id: 1, internal: true }), { serialize: { omit: ['internal'] } }));
        const res = await request(app).delete('/');
        expect(res.body).toEqual({ id: 1 });
    });
    it('GET_SLUG / POST_SLUG / PUT_SLUG / DELETE_SLUG / PATCH_SLUG {omit}', async () => {
        const app = appWith(r => {
            r.POST_SLUG(['id'], async () => ({ id: 1, password: 'x' }), { serialize: { omit: ['password'] } });
        });
        const res = await request(app).post('/1');
        expect(res.body).toEqual({ id: 1 });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/integration/response-serializer/plain-verbs.integration.test.ts`
Expected: FAIL — 해당 메서드들에 serialize 오버로드 없음(컴파일 에러).

- [ ] **Step 3: 8개 메서드 오버로드 적용**

각 메서드의 기존 시그니처 1줄을 아래 블록으로 교체하고, 본문에서 `this.wrapHandler(handler)`(또는 `this.wrapHandler(handler))` 형태)를 `this.wrapHandler(handler, serialize)`로 바꾼다. 본문 첫 줄에 serialize 추출을 추가한다.

**POST (408):**
```ts
    public POST<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz }
    ): ExpressRouter;
    public POST(handler: HandlerFunction, options?: object): ExpressRouter;
    public POST(handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        this.router.post('/', this.wrapHandler(handler, serialize));
```

**POST_SLUG (442):**
```ts
    public POST_SLUG<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz }
    ): ExpressRouter;
    public POST_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter;
    public POST_SLUG(slug: string[], handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        const slugPath = this.convertSlugsToPath(slug);
        this.router.post(slugPath, this.wrapHandler(handler, serialize));
```

**PUT (643):**
```ts
    public PUT<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz }
    ): ExpressRouter;
    public PUT(handler: HandlerFunction, options?: object): ExpressRouter;
    public PUT(handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        this.router.put('/', this.wrapHandler(handler, serialize));
```

**PUT_SLUG (852):**
```ts
    public PUT_SLUG<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz }
    ): ExpressRouter;
    public PUT_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter;
    public PUT_SLUG(slug: string[], handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        const slugPath = this.convertSlugsToPath(slug);
        this.router.put(slugPath, this.wrapHandler(handler, serialize));
```

**DELETE (887):**
```ts
    public DELETE<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz }
    ): ExpressRouter;
    public DELETE(handler: HandlerFunction, options?: object): ExpressRouter;
    public DELETE(handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        this.router.delete('/', this.wrapHandler(handler, serialize));
```

**DELETE_SLUG (923):**
```ts
    public DELETE_SLUG<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz }
    ): ExpressRouter;
    public DELETE_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter;
    public DELETE_SLUG(slug: string[], handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        const slugPath = this.convertSlugsToPath(slug);
        this.router.delete(slugPath, this.wrapHandler(handler, serialize));
```

**PATCH (958):**
```ts
    public PATCH<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz }
    ): ExpressRouter;
    public PATCH(handler: HandlerFunction, options?: object): ExpressRouter;
    public PATCH(handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        this.router.patch('/', this.wrapHandler(handler, serialize));
```

**PATCH_SLUG (995):**
```ts
    public PATCH_SLUG<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz }
    ): ExpressRouter;
    public PATCH_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter;
    public PATCH_SLUG(slug: string[], handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        const slugPath = this.convertSlugsToPath(slug);
        this.router.patch(slugPath, this.wrapHandler(handler, serialize));
```

> 주의: 각 메서드 본문에서 `this.router.<verb>(...)` 호출의 **세 번째 인자**가 `this.wrapHandler(handler)` 였던 부분만 `this.wrapHandler(handler, serialize)` 로 바뀌어야 한다. 본문의 `if (this.basePath) { DocumentationGenerator.registerRoute(...) } else { this.pendingDocumentation.push(...) }` 와 `return this;` 는 그대로 둔다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/integration/response-serializer/plain-verbs.integration.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/expressRouter.ts tests/integration/response-serializer/plain-verbs.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(router): 나머지 plain verb(POST/PUT/PATCH/DELETE +_SLUG) serialize 오버로드

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: expressRouter.ts — ValidatedHandlerFunction<R> + GET_VALIDATED/GET_SLUG_VALIDATED serialize

**Files:**
- Modify: `src/core/lib/expressRouter.ts` (`ValidatedHandlerFunction` 31, `GET_VALIDATED` 1297-1341, `GET_SLUG_VALIDATED` 1353-1417)
- Test: `tests/integration/response-serializer/validated.integration.test.ts` (신규)

**Interfaces:**
- Consumes: `HandlerConfig.serialize` (Task 2), `ResponseSerializer` (Task 1)
- Produces: `ValidatedHandlerFunction<TConfig, R = any>` (반환 제네릭 추가) — Task 6의 나머지 VALIDATED 메서드가 동일 패턴 사용.

- [ ] **Step 1: 실패 테스트 작성** — `tests/integration/response-serializer/validated.integration.test.ts`

```ts
import express from 'express';
import request from 'supertest';
import { ExpressRouter } from '@lib/expressRouter';
import { DependencyInjector } from '@lib/dependencyInjector';

beforeAll(() => {
    const di = DependencyInjector.getInstance() as any;
    di.initialized = true;
    di.modules = {};
});

function appWith(build: (r: ExpressRouter) => void) {
    const router = new ExpressRouter();
    build(router);
    const app = express();
    app.use(express.json());
    app.use(router.build());
    return app;
}

describe('VALIDATED serialize', () => {
    it('serialize 가 responseConfig 검증보다 먼저 적용되어 secret 이 제거된다', async () => {
        // responseConfig 스키마에는 secret 이 있어도(=responseConfig 만으로는 유지),
        // serialize 가 먼저 제거하므로 응답 data 에는 secret 이 없어야 한다.
        const app = appWith(r =>
            r.GET_VALIDATED(
                {},
                { 200: { id: { type: 'number' }, name: { type: 'string' }, secret: { type: 'string' } } },
                async () => ({ id: 1, name: 'a', secret: 'x' }),
                { serialize: { omit: ['secret'] } }
            ));
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({ id: 1, name: 'a' });
        expect(res.body.data.secret).toBeUndefined();
    });

    it('serialize 미지정 VALIDATED 는 기존대로 동작한다 (회귀)', async () => {
        const app = appWith(r =>
            r.GET_VALIDATED(
                {},
                { 200: { id: { type: 'number' } } },
                async () => ({ id: 1 })
            ));
        const res = await request(app).get('/');
        expect(res.body.data).toEqual({ id: 1 });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/integration/response-serializer/validated.integration.test.ts`
Expected: FAIL — `GET_VALIDATED` 에 4번째 options 인자가 없어 컴파일 에러.

- [ ] **Step 3a: ValidatedHandlerFunction 에 반환 제네릭 추가** — 31번째 줄

기존:
```ts
export type ValidatedHandlerFunction<TConfig extends RequestConfig = RequestConfig> = (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => Promise<any> | any;
```
변경:
```ts
export type ValidatedHandlerFunction<TConfig extends RequestConfig = RequestConfig, R = any> = (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => Promise<R> | R;
```

- [ ] **Step 3b: GET_VALIDATED 오버로드 + serialize 전달** — 1297-1312번째 줄

기존:
```ts
    public GET_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter {
        // 현재 위치 정보를 얻기 위해 Error 스택 추적
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );
        this.router.get('/', ...middlewares);
```
변경:
```ts
    public GET_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { serialize: Sz }
    ): ExpressRouter;
    public GET_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter;
    public GET_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: ResponseSerializer<any> }
    ): ExpressRouter {
        // 현재 위치 정보를 얻기 위해 Error 스택 추적
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                serialize: options?.serialize,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );
        this.router.get('/', ...middlewares);
```
(이하 문서 등록 본문·`return this` 변경 없음.)

- [ ] **Step 3c: GET_SLUG_VALIDATED 오버로드 + serialize 전달** — 1353-1370번째 줄

기존:
```ts
    public GET_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean }
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );
```
변경:
```ts
    public GET_SLUG_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { exact?: boolean; serialize: Sz }
    ): ExpressRouter;
    public GET_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean }
    ): ExpressRouter;
    public GET_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean; serialize?: ResponseSerializer<any> }
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                serialize: options?.serialize,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );
```
(이하 `slugPath`/문서 등록/`options?.exact` 분기/`return this` 본문 변경 없음.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/integration/response-serializer/validated.integration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/expressRouter.ts tests/integration/response-serializer/validated.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(router): VALIDATED 반환 제네릭 + GET_VALIDATED/GET_SLUG_VALIDATED serialize

serialize 는 responseConfig 검증보다 먼저 적용.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: expressRouter.ts — 나머지 VALIDATED serialize 오버로드

**Files:**
- Modify: `src/core/lib/expressRouter.ts` (`POST_VALIDATED` 1428, `POST_SLUG_VALIDATED` 1481, `PUT_VALIDATED` 1554, `DELETE_VALIDATED` 1608, `PATCH_VALIDATED` 1660, `PATCH_SLUG_VALIDATED` 1711, `PUT_SLUG_VALIDATED` 2010, `DELETE_SLUG_VALIDATED` 2126)
- Test: `tests/integration/response-serializer/validated-rest.integration.test.ts` (신규)

**Interfaces:**
- Consumes: `HandlerConfig.serialize` (Task 2), `ResponseSerializer` (Task 1), Task 5 패턴
- Produces: 8개 VALIDATED 메서드의 serialize 오버로드.

**패턴 — non-slug VALIDATED** (`POST_VALIDATED/PUT_VALIDATED/DELETE_VALIDATED/PATCH_VALIDATED`): 기존 단일 시그니처 `(requestConfig, responseConfig, handler)` 를 아래 3블록(serialize 오버로드 + 기존 오버로드 + 구현 시그니처)으로 교체하고, 본문의 `createHandler({ request, response, sourceInfo })` 에 `serialize: options?.serialize` 를 추가한다.

**패턴 — slug VALIDATED** (`POST_SLUG_VALIDATED/PATCH_SLUG_VALIDATED/PUT_SLUG_VALIDATED/DELETE_SLUG_VALIDATED`): 기존 시그니처가 `(slug, requestConfig, responseConfig, handler, options?: { exact?: boolean })` 이므로, serialize 오버로드의 options 는 `{ exact?: boolean; serialize: Sz }`, 구현 시그니처 options 는 `{ exact?: boolean; serialize?: ResponseSerializer<any> }` 로 하고 본문 `createHandler` 에 `serialize: options?.serialize` 추가.

- [ ] **Step 1: 실패 테스트 작성** — `tests/integration/response-serializer/validated-rest.integration.test.ts`

```ts
import express from 'express';
import request from 'supertest';
import { ExpressRouter } from '@lib/expressRouter';
import { DependencyInjector } from '@lib/dependencyInjector';

beforeAll(() => {
    const di = DependencyInjector.getInstance() as any;
    di.initialized = true;
    di.modules = {};
});

function appWith(build: (r: ExpressRouter) => void) {
    const router = new ExpressRouter();
    build(router);
    const app = express();
    app.use(express.json());
    app.use(router.build());
    return app;
}

describe('나머지 VALIDATED serialize', () => {
    it('POST_VALIDATED {omit}', async () => {
        const app = appWith(r => r.POST_VALIDATED(
            {}, { 200: { id: { type: 'number' }, secret: { type: 'string' } } },
            async () => ({ id: 1, secret: 'x' }), { serialize: { omit: ['secret'] } }));
        const res = await request(app).post('/');
        expect(res.body.data).toEqual({ id: 1 });
    });
    it('PUT_VALIDATED {pick}', async () => {
        const app = appWith(r => r.PUT_VALIDATED(
            {}, { 200: { id: { type: 'number' }, a: { type: 'number' } } },
            async () => ({ id: 1, a: 2 }), { serialize: { pick: ['id'] } }));
        const res = await request(app).put('/');
        expect(res.body.data).toEqual({ id: 1 });
    });
    it('PATCH_VALIDATED 함수형', async () => {
        const app = appWith(r => r.PATCH_VALIDATED(
            {}, { 200: { id: { type: 'number' } } },
            async () => ({ id: 1, t: 'x' }), { serialize: (u) => ({ id: u.id }) }));
        const res = await request(app).patch('/');
        expect(res.body.data).toEqual({ id: 1 });
    });
    it('DELETE_VALIDATED {omit}', async () => {
        const app = appWith(r => r.DELETE_VALIDATED(
            {}, { 200: { id: { type: 'number' }, internal: { type: 'boolean' } } },
            async () => ({ id: 1, internal: true }), { serialize: { omit: ['internal'] } }));
        const res = await request(app).delete('/');
        expect(res.body.data).toEqual({ id: 1 });
    });
    it('POST_SLUG_VALIDATED {omit}', async () => {
        const app = appWith(r => r.POST_SLUG_VALIDATED(
            ['id'], {}, { 200: { id: { type: 'number' }, secret: { type: 'string' } } },
            async () => ({ id: 1, secret: 'x' }), { serialize: { omit: ['secret'] } }));
        const res = await request(app).post('/1');
        expect(res.body.data).toEqual({ id: 1 });
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/integration/response-serializer/validated-rest.integration.test.ts`
Expected: FAIL — 해당 메서드들에 serialize 오버로드 없음(컴파일 에러).

- [ ] **Step 3: 8개 메서드 적용**

각 메서드의 기존 시그니처 블록을 아래로 교체하고, **본문의 `createHandler(...)` 첫 인자 객체에 `serialize: options?.serialize,` 한 줄을 추가**한다(`sourceInfo` 위 또는 옆). 본문의 나머지(문서 등록, slug 경로 처리, exact 분기, `return this`)는 변경하지 않는다.

**POST_VALIDATED (1428):**
```ts
    public POST_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { serialize: Sz }
    ): ExpressRouter;
    public POST_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter;
    public POST_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: ResponseSerializer<any> }
    ): ExpressRouter {
```

**PUT_VALIDATED (1554):** POST_VALIDATED 와 동일하되 메서드명만 `PUT_VALIDATED`.
```ts
    public PUT_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { serialize: Sz }
    ): ExpressRouter;
    public PUT_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter;
    public PUT_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: ResponseSerializer<any> }
    ): ExpressRouter {
```

**DELETE_VALIDATED (1608):** 메서드명만 `DELETE_VALIDATED`.
```ts
    public DELETE_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { serialize: Sz }
    ): ExpressRouter;
    public DELETE_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter;
    public DELETE_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: ResponseSerializer<any> }
    ): ExpressRouter {
```

**PATCH_VALIDATED (1660):** 메서드명만 `PATCH_VALIDATED`.
```ts
    public PATCH_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { serialize: Sz }
    ): ExpressRouter;
    public PATCH_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter;
    public PATCH_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: ResponseSerializer<any> }
    ): ExpressRouter {
```

**POST_SLUG_VALIDATED (1481):**
```ts
    public POST_SLUG_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { exact?: boolean; serialize: Sz }
    ): ExpressRouter;
    public POST_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean }
    ): ExpressRouter;
    public POST_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean; serialize?: ResponseSerializer<any> }
    ): ExpressRouter {
```

**PATCH_SLUG_VALIDATED (1711):** POST_SLUG_VALIDATED 패턴, 메서드명만 `PATCH_SLUG_VALIDATED`.
```ts
    public PATCH_SLUG_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { exact?: boolean; serialize: Sz }
    ): ExpressRouter;
    public PATCH_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean }
    ): ExpressRouter;
    public PATCH_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean; serialize?: ResponseSerializer<any> }
    ): ExpressRouter {
```

**PUT_SLUG_VALIDATED (2010):** POST_SLUG_VALIDATED 패턴, 메서드명만 `PUT_SLUG_VALIDATED`.
```ts
    public PUT_SLUG_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { exact?: boolean; serialize: Sz }
    ): ExpressRouter;
    public PUT_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean }
    ): ExpressRouter;
    public PUT_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean; serialize?: ResponseSerializer<any> }
    ): ExpressRouter {
```

**DELETE_SLUG_VALIDATED (2126):** POST_SLUG_VALIDATED 패턴, 메서드명만 `DELETE_SLUG_VALIDATED`.
```ts
    public DELETE_SLUG_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { exact?: boolean; serialize: Sz }
    ): ExpressRouter;
    public DELETE_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean }
    ): ExpressRouter;
    public DELETE_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean; serialize?: ResponseSerializer<any> }
    ): ExpressRouter {
```

> 각 메서드 본문에서 `CustomRequestHandler.createHandler({ request: requestConfig, response: responseConfig, sourceInfo: { filePath, lineNumber } }, handler)` 의 첫 인자 객체에 `serialize: options?.serialize,` 를 추가한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/integration/response-serializer/validated-rest.integration.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/expressRouter.ts tests/integration/response-serializer/validated-rest.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(router): 나머지 VALIDATED(POST/PUT/PATCH/DELETE +_SLUG) serialize 오버로드

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 타입 추론 컴파일 타임 단언 (R1 리스크 검증)

**Files:**
- Create: `tests/types/response-serializer-types.ts` (`.test.ts` 아님 → jest 미대상, tsc 만 컴파일)

**Interfaces:**
- Consumes: `ExpressRouter` 의 serialize 오버로드(Task 3-6), `SerializedResult` (Task 1)
- Produces: (없음 — 타입 회귀 가드)

- [ ] **Step 1: 타입 단언 파일 작성**

```ts
import { ExpressRouter } from '@lib/expressRouter';
import type { SerializedResult } from '@lib/serializer';

// 타입 동등성 헬퍼
type Equal<X, Y> =
    (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// SerializedResult: omit/pick/함수/배열
type _Omit = Expect<Equal<SerializedResult<{ id: number; p: string }, { omit: ['p'] }>, { id: number }>>;
type _Pick = Expect<Equal<SerializedResult<{ id: number; p: string }, { pick: ['id'] }>, { id: number }>>;
type _Fn = Expect<Equal<SerializedResult<{ id: number }, (d: { id: number }) => { x: 1 }>, { x: 1 }>>;
type _ArrOmit = Expect<Equal<SerializedResult<{ id: number; p: string }[], { omit: ['p'] }>, { id: number }[]>>;

// 호출부 추론 (런타임 실행 안 함 — 타입 검증 전용)
function _callSiteTypeChecks() {
    const r = new ExpressRouter();

    // 함수형: data 가 핸들러 반환 타입으로 좁혀진다
    r.GET(async () => ({ id: 1, password: 'x' }), {
        serialize: (u) => {
            type _ = Expect<Equal<typeof u, { id: number; password: string }>>;
            return { id: u.id };
        }
    });

    // pick/omit 키는 반환 타입의 키로 제한 — 잘못된 키는 컴파일 에러
    // @ts-expect-error 'nope' 는 반환 타입의 키가 아니다
    r.GET(async () => ({ id: 1 }), { serialize: { pick: ['nope'] } });

    // VALIDATED 도 동일하게 추론
    r.GET_VALIDATED({}, { 200: {} }, async () => ({ id: 1, secret: 's' }), {
        serialize: (u) => {
            type _ = Expect<Equal<typeof u, { id: number; secret: string }>>;
            return { id: u.id };
        }
    });

    // 회귀: serialize 없이 기존 시그니처(직접 res.json) 그대로 컴파일된다
    r.GET((req, res) => { res.json({ ok: true }); });
}

void _callSiteTypeChecks;
```

- [ ] **Step 2: 타입 검증 실행 (PASS 기대)**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: 에러 0건. (만약 `@ts-expect-error` 줄에서 "Unused '@ts-expect-error'" 가 나면 → 키 제한이 동작하지 않는 것이므로 R1 실패. 오버로드의 `const Sz extends ResponseSerializer<Awaited<R>>` 구조를 재점검한다.)

- [ ] **Step 3: 커밋**

```bash
git add tests/types/response-serializer-types.ts
git commit -m "$(cat <<'EOF'
test(types): 응답 serializer 타입 추론 컴파일 타임 단언

R→Sz 동시 추론, pick/omit 키 제한, 배열 결과 타입, VALIDATED 추론 가드.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 문서 갱신 + 전체 검증

**Files:**
- Modify: `CLAUDE.md` (ExpressRouter Fluent API 섹션 — serialize 옵션 한 줄 추가)
- Modify: `docs/superpowers/specs/2026-06-19-router-response-serializer-design.md` (§9 검증 체크박스 체크)

- [ ] **Step 1: CLAUDE.md 에 serialize 설명 추가** — "ExpressRouter Fluent API" 의 "HTTP verbs" 항목 아래에 추가

```markdown
- Response serializer (optional): pass `{ serialize }` as the last options arg to verb/`*_VALIDATED`/`*_SLUG` methods to refine the response. `serialize` is a function `(data, req) => shaped` or a declarative `{ pick: [...] }` / `{ omit: [...] }` (typed via `Pick`/`Omit`, arrays applied per-element). When omitted, behavior is unchanged. For `*_VALIDATED`, serialize runs before `responseConfig` validation.
```

- [ ] **Step 2: 스펙 §9 검증 항목 체크** — `docs/superpowers/specs/2026-06-19-router-response-serializer-design.md` 의 `## 9. 검증 항목` 의 `- [ ]` 들을 실제 통과 결과에 맞춰 `- [x]` 로 갱신.

- [ ] **Step 3: 전체 테스트 실행**

Run: `npx jest`
Expected: 전 스위트 PASS (신규 serializer/request-handler/integration 테스트 포함), 커버리지 임계치 충족.

- [ ] **Step 4: 전체 타입 검증**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: 에러 0건.

- [ ] **Step 5: 커밋**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-19-router-response-serializer-design.md
git commit -m "$(cat <<'EOF'
docs: 응답 serializer 사용법(CLAUDE.md) + 스펙 검증 항목 체크

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- §3 공개 API(함수/pick/omit, plain+VALIDATED) → Task 3-6. ✓
- §4 타입 설계(`ResponseSerializer`/`SerializedResult`/`const Sz` 오버로드) → Task 1, 3-6, 검증 Task 7. ✓
- §5 런타임(공통 헬퍼, plain `wrapHandler`, VALIDATED `createHandler`, 순서) → Task 1, 2, 3, 5. ✓
- §6 손대는 파일(serializer/expressRouter/requestHandler + 테스트) → Task 1-7. ✓
- §7 기본값(req 2번째 인자/async/배열 원소별/순서/옵션 키 `serialize`) → Task 1(헬퍼), 2/5(순서). ✓
- §8 하위호환·R1/R2/R3 → 각 Task의 회귀 테스트 + Task 7 타입 단언 + `res.headersSent` 가드(Task 3). ✓
- §9 검증 항목 → Task 8 Step 2. ✓
- 비목표(docs 자동화/fluent 리팩터/`_FILE`·`_EXACT`·`_WITH_VALIDATION`) → 계획에서 제외. ✓

**2. Placeholder scan:** "TBD/TODO/적절히 처리" 없음. 모든 코드 스텝에 실제 코드 포함. ✓

**3. Type consistency:** `ResponseSerializer`/`SerializedResult`/`applyResponseSerializer`/`HandlerConfig.serialize`/`ValidatedHandlerFunction<TConfig, R>` 명칭이 Task 1·2·3·5·7 전반에서 일치. 오버로드의 `const Sz extends ResponseSerializer<Awaited<R>>` 형태도 plain/VALIDATED 동일. ✓
