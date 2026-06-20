# serialization/ - 직렬화 (Response Serialization)

직렬화 불가능한 타입(BigInt · Date · Prisma `@db.Date`)을 안전하게 변환하고, 라우터 응답 serializer(`pick`/`omit`/함수형)를 적용하며, `res.json` 을 오버라이드해 모든 JSON 응답을 자동 직렬화하는 하위 티어.

## Structure

```
serialization/
├── serializer.ts             # 안전 직렬화 유틸 + 응답 serializer(pick/omit/함수형)
└── serializationMiddleware.ts # res.json 오버라이드 미들웨어 + 전역 BigInt 설정
```

## Files

### serializer.ts
BigInt → string, Date → ISO 문자열, Prisma `@db.Date`(빈 객체이나 내부 날짜) → `YYYY-MM-DD` 로 재귀 변환하는 안전 직렬화 함수들과, 라우터 응답에 선언형/함수형 정제를 적용하는 응답 serializer 를 제공한다.

- **주요 export**:
  - 직렬화 함수: `serializeBigInt(obj)`, `serializeDate(obj)`, `serialize(obj)`(통합 — BigInt/Date/Prisma-Date 모두 처리), `serializePrismaDate(obj)`, `jsonReplacer(key, value)`(JSON.stringify replacer), `safeJsonResponse(data)`
  - 응답 serializer: 타입 `ResponseSerializer<T>`(함수 `(data, req) => shaped` 또는 `{ pick: [...] }` / `{ omit: [...] }`), `SerializedResult<T, Sz>`(정제 후 타입 추론), `applyResponseSerializer(data, sz, req)`(배열이면 원소별, 단일 객체면 그대로 적용; null/원시값 통과; 함수형은 async 허용)
- **의존**: `@ext/winston`(Prisma-Date `valueOf()` 실패 시 Debug 흔적), `express`(`Request` 타입). 다른 http 하위 티어에 의존하지 않는 leaf 모듈.

### serializationMiddleware.ts
응답의 `res.json` 을 가로채 본문을 `serialize()` 로 자동 직렬화하는 Express 미들웨어. 직렬화 실패 시 원본으로 폴백한다. 추가로 전역 `BigInt.prototype.toJSON` 설정을 제공한다.

- **주요 export**:
  - `serializationMiddleware(req, res, next)` — `res.json` 오버라이드 미들웨어
  - `setupGlobalBigIntSerialization()` — `BigInt.prototype.toJSON` 1회 등록(앱 시작 시 호출)
  - 전역 선언: `BigInt.toJSON()` 보강
- **의존**: `@ext/winston`(직렬화 에러 로깅), `@lib/http/serialization/serializer`(`serialize`).

## Import 규약

- 정규 import 경로: `@lib/http/serialization/<file>` (예: `@lib/http/serialization/serializer`).
- **아웃바운드**: serializationMiddleware → `@lib/http/serialization/serializer`(같은 티어). serializer 자체는 `@ext/winston` 외 다른 코어 티어에 의존하지 않는다(가장 안쪽 leaf).
- **인바운드**: `@lib/http/validation/requestHandler` 가 `ResponseSerializer`/`applyResponseSerializer` 를, `@lib/http/routing/expressRouter` 가 `serialize`/`serializeBigInt`/`ResponseSerializer`/`applyResponseSerializer` 를 소비한다. `serializationMiddleware` 는 기본 글로벌 정책 스택(`defaultGlobalMiddleware()`)에 포함되지 않은 opt-in 미들웨어로, 필요 시 앱이 `src/app/routes/middleware.ts` 등에 직접 등록한다.
