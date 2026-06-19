# 라우터 응답 serializer 설계 (옵션 파라미터 방식)

- 상태: 승인됨 (설계 단계)
- 작성일: 2026-06-19
- 대상 버전: 0.1.47 (현재 개발 브랜치 `ver/0.1.47`)
- 영역: `src/core/` 프레임워크 코어 (프레임워크 기능 추가이므로 CLAUDE.md "core 수정 금지" 예외에 해당)

## 1. 배경 & 문제

`ExpressRouter`에는 응답 본문을 라우터 단위로 정제(민감/불필요 필드 제거, 형태 변형)하는 1급 기능이 없다. 현재 상태:

- **평범한 verb**(`GET/POST/PUT/PATCH/DELETE`): `wrapHandler`(`expressRouter.ts:222`)가 핸들러를 호출하지만 **반환값을 버린다**. 핸들러가 직접 `res.json()`/`res.send()`를 호출해야 한다.
- **`*_VALIDATED`**: 핸들러가 값을 `return`하면 자동 전송되고, `responseConfig`(인하우스 `Schema`)로 필드를 검증·필터링한다(`requestHandler.ts:124,166`). 단 이는 "선언적 화이트리스트/검증"이며 변형(리네임/포맷) 도구가 아니다.
- **타입**: 요청 데이터는 `InferValidatedData`로 추론되지만(`requestHandler.ts:37`), **응답 타입은 어디서도 추론되지 않는다**(핸들러 반환은 `Promise<any> | any`). 빌더는 제네릭 누적형이 아니라 모든 메서드가 그냥 `ExpressRouter`를 반환한다.
- **기존 직렬화**: `serializationMiddleware`가 모든 `res.json`을 감싸 BigInt→string, Date→ISO **저수준 변환만** 수행한다(`serializer.ts`). 필드 정제/리댁션 개념은 없다.

사용자 요구: GET/GET_VALIDATED 등 라우터 메서드에서 **응답을 정제**하되, **IDE 타입 추적을 최대한 살린** 형태로 "보이면 안 될 값/불필요한 값"을 제거할 수 있어야 한다.

## 2. 목표 / 비목표

### 목표
- 모든 verb + `*_VALIDATED` + `*_SLUG`/`*_VALIDATED_SLUG` 변형에 **선택적** `options.serialize` 도입.
- 핸들러 반환 타입 `R`을 serializer 입력으로 연결 → IDE가 정제 대상 필드를 자동완성하고, 정제 후 응답 타입을 추론.
- `serialize`를 **함수**(임의 재구성/리네임) 또는 **선언형 `{pick}`/`{omit}`**(타입은 `Pick`/`Omit`로 자동 추론) 둘 다로 받음.
- `serialize`가 없으면 기존 동작을 100% 그대로 유지(하위호환).

### 비목표 (이번 범위 제외)
- `serialize` 형태로부터 **OpenAPI/`/docs` 응답 스키마 자동 도출** — 후속 작업.
- 빌더 전체를 제네릭 누적형(`.SERIALIZE()` fluent 체인)으로 리팩터링 — 채택하지 않음(리스크 과다).
- 중첩 관계(relationship) 깊은 경로 선택자/리네임 DSL — 이번엔 최상위(또는 배열 원소) 키 단위 `pick`/`omit` + 임의 함수까지만.

## 3. 공개 API (호출부)

```ts
// 함수형 — 임의 재구성/리네임
router.GET(
  async (req, res, inj, repo, db) => repo.getRepository('user').findById(req.params.id),
  { serialize: (u) => ({ id: u.id, name: u.name }) }   // u: R 자동완성, 반환이 응답 타입
);

// 선언형 omit — 민감/불필요 필드 제거 (응답 타입 Omit<R,...> 자동)
router.GET(handler, { serialize: { omit: ['password', 'ssn'] } });

// 선언형 pick — 노출 필드 화이트리스트 (응답 타입 Pick<R,...> 자동)
router.GET(handler, { serialize: { pick: ['id', 'name'] } });

// VALIDATED — 4번째 옵션 인자
router.GET_VALIDATED(reqCfg, resCfg, handler, { serialize: { omit: ['password'] } });
```

`serialize`가 없으면: 평범한 verb는 기존처럼 핸들러가 직접 `res.json`(반환값 무시), VALIDATED는 기존처럼 반환값 자동 전송 + responseConfig 필터링. **시그니처/동작 무변경.**

## 4. 타입 설계

`serializer.ts`에 타입을 추가한다(런타임 헬퍼와 같은 파일).

```ts
import type { Request } from 'express';

// 배열이면 원소 타입, 아니면 그대로
type ArrEl<T> = T extends readonly (infer E)[] ? E : T;

export type ResponseSerializer<T> =
  | ((data: T, req: Request) => unknown | Promise<unknown>)
  | { pick: readonly (keyof ArrEl<T>)[] }
  | { omit: readonly (keyof ArrEl<T>)[] };

// 정제 후 응답(본문 data) 타입 계산 — IDE 추론/문서용
export type SerializedResult<T, Sz> =
  Sz extends (d: T, req: Request) => infer R ? Awaited<R> :
  Sz extends { pick: readonly (infer K extends keyof ArrEl<T>)[] }
    ? (T extends readonly any[] ? Pick<ArrEl<T>, K>[] : Pick<T, K>) :
  Sz extends { omit: readonly (infer K extends keyof ArrEl<T>)[] }
    ? (T extends readonly any[] ? Omit<ArrEl<T>, K>[] : Omit<T, K>) :
  never;
```

메서드는 **기존 시그니처를 그대로 두고 serialize 오버로드를 앞에 추가**한다. 예(`GET`):

```ts
// 새 오버로드: handler에서 R 추론 → serialize 입력/키를 R에 연결.
// const Sz 로 pick/omit 키 튜플을 리터럴 추론(Pick/Omit 산출에 필요).
GET<R, const Sz extends ResponseSerializer<Awaited<R>>>(
  handler: (req: Request, res: Response, injected: Injectable,
            repo: typeof repositoryManager, db: typeof prismaManager) => R,
  options: { serialize: Sz }
): ExpressRouter;
// 기존 오버로드(무변경)
GET(handler: HandlerFunction, options?: object): ExpressRouter;
```

`*_VALIDATED`는 `ValidatedHandlerFunction`에 반환 제네릭을 추가(`ValidatedHandlerFunction<TConfig, R = any>`, 반환 `R | Promise<R>`)하고, 같은 방식으로 serialize 오버로드를 추가한다:

```ts
GET_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
  requestConfig: TConfig,
  responseConfig: ResponseConfig,
  handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable,
            repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
  options: { serialize: Sz }
): ExpressRouter;
GET_VALIDATED<TConfig extends RequestConfig>( /* 기존 */ ): ExpressRouter;
```

TypeScript `^5.8.3` 이므로 `const` 타입 파라미터(5.0+)와 `infer ... extends`(4.7+)를 사용할 수 있다.

## 5. 런타임 설계

### 공통 헬퍼 (`serializer.ts`)
```ts
function pickKeys<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}
function omitKeys<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const set = new Set<PropertyKey>(keys);
  const out = {} as any;
  for (const k of Object.keys(obj)) if (!set.has(k)) out[k] = (obj as any)[k];
  return out as Omit<T, K>;
}

export async function applyResponseSerializer(
  data: unknown, sz: ResponseSerializer<any>, req: Request
): Promise<unknown> {
  if (typeof sz === 'function') return await sz(data as any, req);
  if (data == null) return data;                 // null/undefined 통과
  const apply = (item: any) =>
    'pick' in sz ? pickKeys(item, sz.pick) : omitKeys(item, sz.omit);
  return Array.isArray(data) ? data.map(apply) : apply(data);
}
```
규칙:
- **함수형**: 반환값 전체를 받아 그대로 변형. 배열을 원소별로 처리할지는 사용자 책임(`(arr) => arr.map(...)`).
- **`pick`/`omit`**: 데이터가 배열이면 **원소별** 적용, 아니면 객체 1개에 적용. `null`/`undefined`/원시값은 그대로 통과.

### 평범한 verb 경로
`wrapHandler(handler, serialize?)`로 확장. `serialize`가 주어진 경우에만:
```ts
const result = await handler(req, res, injected, repo, db);
if (serialize && !res.headersSent && result !== undefined) {
  res.json(await applyResponseSerializer(result, serialize, req));
  // 저수준 BigInt/Date 변환은 기존 serializationMiddleware가 처리
}
```
`serialize`가 없으면 기존 코드 경로(반환값 무시) 그대로. 상태코드는 핸들러가 `res.status()`로 이미 설정했으면 그것을 따른다(`res.json`이 현재 statusCode 사용).

### VALIDATED 경로
`HandlerConfig`에 `serialize?: ResponseSerializer<any>` 추가 → `*_VALIDATED`가 `createHandler` config로 전달. `createHandler`의 핸들러 미들웨어에서 결과를 `sendSuccess` 직전에 변형:
```ts
let out = result;
if (config.serialize && out !== undefined) out = await applyResponseSerializer(out, config.serialize, req);
sendSuccess(res, out, statusCode, responseSchema, config.response);
```
**실행 순서: handler → serialize(변형) → responseConfig 검증/필터(`sendSuccess`) → `ApiResponse` envelope.**
즉 `responseConfig`는 "정제 후 형태"를 기술한다(serialize와 responseConfig를 함께 쓰면 합성됨).

## 6. 손대는 파일

- `src/core/lib/serializer.ts` — `ResponseSerializer`, `SerializedResult` 타입 + `applyResponseSerializer`/`pickKeys`/`omitKeys` 헬퍼.
- `src/core/lib/expressRouter.ts` — verb/SLUG 메서드 serialize 오버로드 + `wrapHandler` 확장 + 각 메서드가 `options?.serialize`를 `wrapHandler`/config로 전달.
- `src/core/lib/requestHandler.ts` — `HandlerConfig.serialize` 추가, `ValidatedHandlerFunction<TConfig, R>` 반환 제네릭, `createHandler` 변형 단계.
- 테스트:
  - `tests/unit/` — `applyResponseSerializer`(함수/pick/omit/배열/null/원시값) 런타임 단위 테스트.
  - 컴파일 타임 타입 단언(`tests/types/*.test-d.ts` 또는 `tsc --noEmit` 대상 픽스처) — `serialize` 입력 타입이 `R`로 좁혀지는지, pick/omit 결과 타입이 `Pick`/`Omit`인지.
  - `tests/integration/` — serialize 적용 라우트가 실제 응답 본문에서 필드를 제거/변형하는지(평범 verb + VALIDATED 각각, 배열 응답 포함).

## 7. 결정된 기본값 (승인됨)

1. 함수형 시그니처는 `(data, req) => S | Promise<S>` — `req`로 역할 기반 리댁션 가능(무시 가능).
2. `serialize`는 **async 허용**(`Promise<S>` 반환 await).
3. `pick`/`omit`은 **배열이면 원소별 자동 적용**, 함수형은 값 전체를 받음.
4. VALIDATED에서 **serialize가 responseConfig보다 먼저** 실행.
5. **OpenAPI/docs 자동 반영은 이번 범위 제외**.
6. 옵션 키 이름은 **`serialize`**.

## 8. 하위호환 & 리스크

- **하위호환**: 모든 변경은 새 오버로드/옵셔널 인자/옵셔널 config 필드로만 이루어지며, `serialize` 미지정 시 기존 경로를 타므로 기존 라우트 동작·타입 불변.
- **리스크 R1 (타입 추론)**: `<R, const Sz extends ResponseSerializer<Awaited<R>>>`에서 `R`(인자1)과 `Sz`(인자2) 동시 추론이 의도대로 동작하는지 **컴파일 타임 검증 필수**. 실패 시 대안: (a) serialize를 함수 단일 인자 헬퍼로 감싸 `R`을 먼저 고정, (b) 메서드를 2-인자 커링 형태 보조 오버로드로 분리. 타입 단언 테스트로 즉시 확인한다.
- **리스크 R2 (표면적)**: serialize 오버로드를 ~20+ 메서드에 반복 → 공통 타입 별칭과 단일 `applyResponseSerializer`로 중복 최소화. 오버로드 시그니처 자체는 메서드별로 필요(제네릭 위치가 달라).
- **리스크 R3 (이중 전송)**: serialize 지정 + 핸들러가 직접 `res.json` 호출 시 → `res.headersSent` 가드로 이중 전송 방지(기존 VALIDATED 패턴과 동일).

## 9. 검증 항목 (구현 중 확인)

- [x] R1: `R`+`const Sz` 동시 추론 정상 동작(타입 단언 통과).
- [x] pick/omit 키가 `keyof ArrEl<R>`로 제한되어 오타가 컴파일 에러가 되는지.
- [x] 배열 응답에서 pick/omit 원소별 적용 + 결과 타입 `...[]`.
- [x] VALIDATED: serialize 후 responseConfig 검증이 정제된 형태에 적용되는지.
- [x] 기존(미지정) 라우트의 타입·런타임 동작 불변(회귀 없음).
