# errors/ - Error Codes & Formatting

The sub-tier that holds the single source of truth (SSOT) for application-wide error codes, HTTP status mappings, and Prisma error mappings, and that normalizes/sanitizes arbitrary errors and formats them into CRUD/JSON:API responses.

## Structure

```
errors/
├── errorCodes.ts     # Error-code constant SSOT + status mappings + Prisma canonical mapping
├── errorFormatter.ts # Prisma error → { code, status }
└── errorHandler.ts   # Error normalization + sanitization + CRUD/JSON:API formatting
```

## Files

### errorCodes.ts
The SSOT that centrally defines all error-code constants. Provides per-category constant groups plus a unified map, a code→HTTP status mapping, and a Prisma code→internal error code canonical mapping.

- **Main exports**:
  - Category constants: `JSON_API_ERROR_CODES`, `CRUD_ERROR_CODES`, `PRISMA_ERROR_CODES`, `HTTP_ERROR_CODES`, `MIDDLEWARE_ERROR_CODES`, `BUSINESS_ERROR_CODES`
  - Unified: `ERROR_CODES` (spread of all categories)
  - Types: `ErrorCode`, `JsonApiErrorCode`, `CrudErrorCode`, `PrismaErrorCode`, `HttpErrorCode`, `MiddlewareErrorCode`, `BusinessErrorCode`
  - Mappings: `ERROR_STATUS_MAP` (code → HTTP status, default 500), `getHttpStatusForErrorCode(code)`, `PRISMA_CANONICAL_ERROR_MAP` (Prisma `P2xxx` → `{ errorCode, httpStatus }` canonical map — unifies the duplicate maps in errorHandler/crudHelpers. P2030/P2031 are intentionally excluded and overridden per consumer)
- **Depends on**: nothing — a pure constant/mapping module. The innermost leaf of the errors tier.

### errorFormatter.ts
A thin adapter that maps Prisma errors into the `{ code, status }` used in JSON:API responses. The only surface currently in use is `mapPrismaError`.

- **Main exports**:
  - `class ErrorFormatter` — `static mapPrismaError(error): { code; status }`. `PrismaClientValidationError` → 400; `PrismaClientKnownRequestError` P2001/P2015/P2018/P2025 → 404, P2002 → 409 (DUPLICATE_ENTRY), P2003/P2004 → 400, others → DATABASE_ERROR/500. An `Invalid UUID` message → INVALID_UUID/400; unknown errors fall back to INTERNAL_ERROR/500.
- **Depends on**: `@lib/http/errors/errorCodes` (`ERROR_CODES`).

### errorHandler.ts
The entry point for all error handling. Normalizes arbitrary errors into a `NormalizedError`, sanitizes sensitive information (connection strings/credentials/file paths/stacks/network) per environment, then produces a CRUD- or JSON:API v1.1-formatted response.

- **Main exports**:
  - Interface `NormalizedError`
  - enum `ErrorResponseFormat` (`CRUD` / `JSON_API`)
  - `class ErrorHandler` — `static handleError(error, options)` (the entry point that runs normalize → applySecurity → format dispatch), `normalizeError`, `applySecurity`. Internals: Prisma message/code mapping (uses `PRISMA_CANONICAL_ERROR_MAP`, with P2030/P2031 override), message/stack sanitization, `formatCrudError` / `formatJsonApiError` (`meta.implementation` is derived from the package.json name/version).
- **Depends on**: `@lib/http/errors/errorCodes` (`ERROR_CODES`/`PRISMA_ERROR_CODES`/`HTTP_ERROR_CODES`/`PRISMA_CANONICAL_ERROR_MAP`), `@lib/crud/crudHelpers` (`JsonApiError`/`JsonApiErrorResponse`/`ErrorSecurityOptions` types), package.json (runtime require — the implementation version string).

## Import conventions

- Canonical import path: `@lib/http/errors/<file>` (e.g. `@lib/http/errors/errorCodes`).
- **Outbound**: errorFormatter/errorHandler → `@lib/http/errors/errorCodes` (same-tier leaf). errorHandler additionally depends on `@lib/crud/crudHelpers` (types). errorCodes has no dependencies.
- **Inbound**: `@lib/http/routing/expressRouter` (CRUD error responses), `@lib/http/routing/proxyMiddleware` (502/504 codes/statuses), and `@lib/crud/*` (crudHelpers/crudRouteBuilder) consume this tier.
