# validation/ - Request/Response Validation (Validation Engine)

The sub-tier that provides the engine responsible for the request-validation middleware and response-schema filtering of `_VALIDATED` routes, plus a field-level schema validator (type/length/pattern/enum/custom + SQL, XSS, and command-injection detection).

## Structure

```
validation/
├── requestHandler.ts   # *_VALIDATED engine (RequestConfig/ResponseConfig/ValidatedRequest)
└── validator.ts        # field schema validator + security pattern detection
```

## Files

### validator.ts
A static validator that checks data field by field against a schema (`Schema`) and returns a result containing only the fields that passed validation. For string inputs it detects SQL injection, XSS, and command-injection patterns.

- **Main exports**:
  - Types/interfaces: `ValidationError`, `ValidationResult`, `ValidatorType`(`string`/`number`/`boolean`/`array`/`object`/`email`/`url`/`file`/`binary`/`buffer`), `FieldSchema`(`type`/`required`/`min`/`max`/`pattern`/`enum`/`custom`/`format`/`contentType`/`mediaType`/`properties`/`example`/`sensitive`/`confidential`, etc.), `Schema`
  - `class Validator` — `static validate(data, schema)`, `validateBody` / `validateQuery` / `validateParams`. Internally it runs `detectSecurityThreats`(security patterns), type coercion (number/boolean), and range/length/pattern/enum/custom validation, and ignores fields outside the schema (Debug log in dev).
- **Dependencies**: `@ext/winston`(Debug logging of extra fields). No outer-tier dependencies — a pure validation utility.

### requestHandler.ts
The core engine for the `_VALIDATED` family of routes. It creates the request-validation middleware and, after the handler runs, processes the response through a (serialize → schema filter/validate → send) pipeline. In development mode it statically analyzes the handler source to warn about or block status codes that are declared in `ResponseConfig` but not implemented.

- **Main exports**:
  - Interfaces: `RequestConfig`(`body`/`query`/`params`: `Schema`), `ResponseConfig`(`{ [statusCode]: Schema }`), `HandlerConfig`(`request`/`response`/`serialize`/`sourceInfo`), `ValidatedRequest<TConfig>`(`req.validatedData.{body,query,params}` type inference), `ApiResponse`
  - Types: `ExtractFieldType<T>`(field → TS type inference)
  - `class RequestHandler` — `static validateRequest(config)`(422 validation middleware), `validateAndFilterResponse(data, schema)`, `sendSuccess` / `sendError`, `validateHandlerImplementation`(static-analysis heuristic, `__skipImplementationCheck` opt-out / `STRICT_STATUS_CODE_CHECK` enforcement), `createHandler(config, handler)`(validation + DI + serialize + response wrapper), `withValidation` / `withFullValidation`
  - Binding convenience functions: `createValidatedHandler`, `withValidation`, `withFullValidation`, `sendSuccess`, `sendError`
- **Dependencies**: `@lib/http/validation/validator`(`Validator`/`Schema`/`FieldSchema`), `@lib/http/serialization/serializer`(`ResponseSerializer`/`applyResponseSerializer` — serialize is applied before response-schema validation), `@lib/data/di/dependencyInjector`(DI module injection), `@lib/data/database/prismaManager` · `repositoryManager`, `@lib/types/generated-injectable-types`(`Injectable`), `@ext/winston`.

## Import Conventions

- Canonical import path: `@lib/http/validation/<file>` (e.g. `@lib/http/validation/requestHandler`).
- **Outbound (layer direction)**: requestHandler → `@lib/http/validation/validator` → (pure), and requestHandler → `@lib/http/serialization/serializer`. validation does not directly reference the errors tier.
- **Inbound**: `@lib/http/routing/expressRouter` uses `RequestConfig`/`ResponseConfig`/`createHandler` in its `_VALIDATED` method implementations, and `middlewareHelpers` references the `ValidatedRequest` type.
