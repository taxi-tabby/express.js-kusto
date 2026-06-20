# validation/ - 요청/응답 검증 (Validation Engine)

`_VALIDATED` 라우트의 요청 검증 미들웨어와 응답 스키마 필터링을 담당하는 엔진, 그리고 필드 단위 스키마 검증기(타입/길이/패턴/enum/커스텀 + SQL·XSS·커맨드 인젝션 탐지)를 제공하는 하위 티어.

## Structure

```
validation/
├── requestHandler.ts   # *_VALIDATED 엔진 (RequestConfig/ResponseConfig/ValidatedRequest)
└── validator.ts        # 필드 스키마 검증기 + 보안 패턴 탐지
```

## Files

### validator.ts
스키마(`Schema`) 기준으로 데이터를 필드별 검증하고, 검증 통과 필드만 추린 결과를 반환하는 정적 검증기. 문자열 입력에 대해 SQL 인젝션 · XSS · 커맨드 인젝션 패턴을 탐지한다.

- **주요 export**:
  - 타입/인터페이스: `ValidationError`, `ValidationResult`, `ValidatorType`(`string`/`number`/`boolean`/`array`/`object`/`email`/`url`/`file`/`binary`/`buffer`), `FieldSchema`(`type`/`required`/`min`/`max`/`pattern`/`enum`/`custom`/`format`/`contentType`/`mediaType`/`properties`/`example`/`sensitive`/`confidential` 등), `Schema`
  - `class Validator` — `static validate(data, schema)`, `validateBody` / `validateQuery` / `validateParams`. 내부적으로 `detectSecurityThreats`(보안 패턴), 타입 강제 변환(number/boolean), 범위/길이/패턴/enum/custom 검증을 수행하고 스키마 밖 필드는 무시(dev 에서 Debug 로그).
- **의존**: `@ext/winston`(추가 필드 Debug 로깅). 외부 티어 의존 없음 — 순수 검증 유틸.

### requestHandler.ts
`_VALIDATED` 계열 라우트의 핵심 엔진. 요청 검증 미들웨어를 생성하고, 핸들러 실행 후 응답을 (serialize → 스키마 필터/검증 → 전송) 파이프라인으로 처리한다. 개발 모드에서는 핸들러 소스를 정적 분석해 `ResponseConfig` 에 선언됐지만 구현되지 않은 상태 코드를 경고/차단한다.

- **주요 export**:
  - 인터페이스: `RequestConfig`(`body`/`query`/`params`: `Schema`), `ResponseConfig`(`{ [statusCode]: Schema }`), `HandlerConfig`(`request`/`response`/`serialize`/`sourceInfo`), `ValidatedRequest<TConfig>`(`req.validatedData.{body,query,params}` 타입 추론), `ApiResponse`
  - 타입: `ExtractFieldType<T>`(필드 → TS 타입 추론)
  - `class RequestHandler` — `static validateRequest(config)`(422 검증 미들웨어), `validateAndFilterResponse(data, schema)`, `sendSuccess` / `sendError`, `validateHandlerImplementation`(정적 분석 휴리스틱, `__skipImplementationCheck` opt-out / `STRICT_STATUS_CODE_CHECK` 강제), `createHandler(config, handler)`(검증+DI+serialize+응답 래퍼), `withValidation` / `withFullValidation`
  - 바인딩 편의 함수: `createValidatedHandler`, `withValidation`, `withFullValidation`, `sendSuccess`, `sendError`
- **의존**: `@lib/http/validation/validator`(`Validator`/`Schema`/`FieldSchema`), `@lib/http/serialization/serializer`(`ResponseSerializer`/`applyResponseSerializer` — serialize 는 응답 스키마 검증보다 먼저 적용), `@lib/data/di/dependencyInjector`(DI 모듈 주입), `@lib/data/database/prismaManager` · `repositoryManager`, `@lib/types/generated-injectable-types`(`Injectable`), `@ext/winston`.

## Import 규약

- 정규 import 경로: `@lib/http/validation/<file>` (예: `@lib/http/validation/requestHandler`).
- **아웃바운드(레이어 방향)**: requestHandler → `@lib/http/validation/validator` → (순수), 그리고 requestHandler → `@lib/http/serialization/serializer`. validation 은 errors 티어를 직접 참조하지 않는다.
- **인바운드**: `@lib/http/routing/expressRouter` 가 `_VALIDATED` 메서드 구현에서 `RequestConfig`/`ResponseConfig`/`createHandler` 를 사용하고, `middlewareHelpers` 가 `ValidatedRequest` 타입을 참조한다.
