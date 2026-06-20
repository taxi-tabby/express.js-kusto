# errors/ - 에러 코드 · 포매팅 (Error Codes & Formatting)

애플리케이션 전역 에러 코드의 단일 진실 공급원(SSOT)과 HTTP 상태 매핑, Prisma 에러 매핑, 그리고 임의 에러를 정규화·새니타이즈하여 CRUD/JSON:API 응답으로 포맷하는 하위 티어.

## Structure

```
errors/
├── errorCodes.ts     # 에러 코드 상수 SSOT + 상태 매핑 + Prisma 정규 매핑
├── errorFormatter.ts # Prisma 에러 → { code, status }
└── errorHandler.ts   # 에러 정규화 + 새니타이즈 + CRUD/JSON:API 포맷
```

## Files

### errorCodes.ts
모든 에러 코드 상수를 중앙에서 정의하는 SSOT. 카테고리별 상수 묶음과 통합 맵, 코드→HTTP 상태 매핑, Prisma 코드→내부 에러 코드 정규 매핑을 제공한다.

- **주요 export**:
  - 카테고리 상수: `JSON_API_ERROR_CODES`, `CRUD_ERROR_CODES`, `PRISMA_ERROR_CODES`, `HTTP_ERROR_CODES`, `MIDDLEWARE_ERROR_CODES`, `BUSINESS_ERROR_CODES`
  - 통합: `ERROR_CODES`(모든 카테고리 스프레드)
  - 타입: `ErrorCode`, `JsonApiErrorCode`, `CrudErrorCode`, `PrismaErrorCode`, `HttpErrorCode`, `MiddlewareErrorCode`, `BusinessErrorCode`
  - 매핑: `ERROR_STATUS_MAP`(코드 → HTTP 상태, 기본 500), `getHttpStatusForErrorCode(code)`, `PRISMA_CANONICAL_ERROR_MAP`(Prisma `P2xxx` → `{ errorCode, httpStatus }` 정규 맵 — errorHandler/crudHelpers 의 중복 맵을 통합. P2030/P2031 은 의도적으로 제외하고 소비자별 override)
- **의존**: 없음 — 순수 상수/매핑 모듈. errors 티어의 가장 안쪽 leaf.

### errorFormatter.ts
Prisma 에러를 JSON:API 응답에 사용할 `{ code, status }` 로 매핑하는 얇은 어댑터. 현재 사용되는 표면은 `mapPrismaError` 하나뿐이다.

- **주요 export**:
  - `class ErrorFormatter` — `static mapPrismaError(error): { code; status }`. `PrismaClientValidationError` → 400, `PrismaClientKnownRequestError` 의 P2001/P2015/P2018/P2025 → 404, P2002 → 409(DUPLICATE_ENTRY), P2003/P2004 → 400, 그 외 → DATABASE_ERROR/500. `Invalid UUID` 메시지는 INVALID_UUID/400, 미지 에러는 INTERNAL_ERROR/500 폴백.
- **의존**: `@lib/http/errors/errorCodes`(`ERROR_CODES`).

### errorHandler.ts
모든 에러 처리의 진입점. 임의 에러를 `NormalizedError` 로 정규화하고, 환경별로 민감 정보(연결 문자열/자격증명/파일경로/스택/네트워크)를 새니타이즈한 뒤 CRUD 또는 JSON:API v1.1 형식 응답을 생성한다.

- **주요 export**:
  - 인터페이스 `NormalizedError`
  - enum `ErrorResponseFormat`(`CRUD` / `JSON_API`)
  - `class ErrorHandler` — `static handleError(error, options)`(정규화 → applySecurity → format 분기 진입점), `normalizeError`, `applySecurity`. 내부: Prisma 메시지/코드 매핑(`PRISMA_CANONICAL_ERROR_MAP` 사용, P2030/P2031 override), 메시지/스택 새니타이즈, `formatCrudError` / `formatJsonApiError`(`meta.implementation` 은 package.json name/version 에서 파생).
- **의존**: `@lib/http/errors/errorCodes`(`ERROR_CODES`/`PRISMA_ERROR_CODES`/`HTTP_ERROR_CODES`/`PRISMA_CANONICAL_ERROR_MAP`), `@lib/crud/crudHelpers`(`JsonApiError`/`JsonApiErrorResponse`/`ErrorSecurityOptions` 타입), package.json(런타임 require — 구현 버전 문자열).

## Import 규약

- 정규 import 경로: `@lib/http/errors/<file>` (예: `@lib/http/errors/errorCodes`).
- **아웃바운드**: errorFormatter/errorHandler → `@lib/http/errors/errorCodes`(같은 티어 leaf). errorHandler 는 추가로 `@lib/crud/crudHelpers`(타입)에 의존한다. errorCodes 는 무의존.
- **인바운드**: `@lib/http/routing/expressRouter`(CRUD 에러 응답), `@lib/http/routing/proxyMiddleware`(502/504 코드/상태), `@lib/crud/*`(crudHelpers/crudRouteBuilder) 가 이 티어를 소비한다.
