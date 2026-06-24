# crud/ - CRUD engine (JSON:API v1.1)

The tier that, when `router.CRUD(db, model, options)` is called, auto-generates JSON:API v1.1-compliant REST endpoints (index/show/create/update/destroy/recover/atomic/relationship). It handles query parsing, Prisma query building, JSON:API transformation, PK parsing, and media-type constants.

## Structure

```
crud/
├── crudRouteBuilder.ts         # Orchestrator that registers CRUD routes in bulk (index/show/create/update/destroy/recover/atomic/relationship)
├── crudHelpers.ts              # Query parsing + Prisma query builder + JSON:API transformation + JSON:API type definitions
├── crudResponseSerializer.ts   # User-facing response filtering pre-pass (pick/omit/function serializers on raw Prisma data)
├── primaryKeyParsers.ts        # :id parameter parsers (uuid/string/int/smart) — pure functions
└── jsonApiConstants.ts         # JSON:API media-type constants (SSOT)
```

## Files

### crudResponseSerializer.ts
User-facing CRUD response filtering. `applyCrudSerializers(data, rootSerializer, includeSerializers, req, opts)`
is a pure async pre-pass over RAW Prisma data (before JSON:API transform), so both includeMerge modes
behave identically. Deterministic: relation nodes are addressed by `?include=` path keys, never by
data-shape inference or `schemaAnalyzer`. Reuses `@lib/http/serialization/serializer`
(`applyResponseSerializer`/`ResponseSerializer`); always preserves the identity key — the configured
primaryKey for root records, and the first-present id/uuid/_id for included relation nodes. Consumed by
`crudRouteBuilder` (show/create/index/update/recover handlers and the `GET /:id/:relation` relation route).

### crudRouteBuilder.ts
**Responsibility**: The delegation target of `ExpressRouter.CRUD()`. When ExpressRouter passes a `CrudBuilderContext` carrying its shared capabilities, this builder picks the active actions (computed from `only`/`except`) and registers the Express routes. Each handler follows the flow: set the JSON:API Content-Type → parse query/PK → apply the include policy → call Prisma → serialize the JSON:API envelope → run the `beforeXxx`/`afterXxx` hooks. Soft delete (410 Gone response), relationship handling (connect/disconnect/set, with soft delete as a replacement), atomic operations (`POST /atomic`, transactional), and dev-mode schema registration are all handled here as well.
**Main exports**:
- `type CrudBuilderContext` — alias of the shared `RouterContext` (declared in `@lib/http/routing/expressRouter`, the single source of truth): the capabilities the builder needs from ExpressRouter (`router`, `basePath`, `schemaRegistry`, `schemaAnalyzer`, `wrapHandler`, `wrapMiddleware`, `registerDocumentation`).
- `class CrudRouteBuilder` — the constructor takes a `CrudBuilderContext` and exposes the `build(databaseName, modelName, options?)` entry point. Everything else is private (`setupIndexRoute`/`setupShowRoute`/`setupCreateRoute`/`setupUpdateRoute`/`setupDestroyRoute`/`setupRecoverRoute`/`setupAtomicOperationsRoute`/`processRelationships`, etc.).
**CRUD() options** (passed through `options` to `build()`):
- `primaryKey`, `primaryKeyParser`, `only`/`except`: PK name, custom parser, action allow/deny list.
- `middleware`, `validation`, `hooks` (`beforeXxx`/`afterXxx`): per-operation middleware, Zod validation, lifecycle hooks.
- `serialize` / `serializeIncludes`: user response filtering applied via `crudResponseSerializer.applyCrudSerializers`
  as a pre-pass on raw data; `serialize` shapes the root resource (typed to the model), `serializeIncludes`
  shapes relations by `?include=` path and also applies on the `GET /:id/:relation` relation route (keyed by the
  relation name); identity (id/uuid/_id) is always preserved. Deterministic across both includeMerge modes.
**Dependencies**: same tier — `@lib/crud/crudHelpers` (CrudQueryParser, PrismaQueryBuilder, CrudResponseFormatter, JsonApiTransformer, JSON:API types), `@lib/crud/primaryKeyParsers` (parseString, parseIdSmart, getSmartPrimaryKeyParser), `@lib/crud/jsonApiConstants` (media types), `@lib/crud/crudResponseSerializer` (applyCrudSerializers). External tiers: `@lib/data/database/prismaManager` (`getWrap`/`getClient`, and `getFieldTypeMap` — resolved once per CRUD route and threaded into `buildFindManyOptions` for array-operator type validation), `@lib/http/validation/requestHandler` (validation middleware), `@lib/http/serialization/serializer` (BigInt/Date serialization), `@lib/http/errors/errorFormatter`·`errorHandler`·`errorCodes`, `@lib/devtools/schema-api/*` (CrudSchemaRegistry, PrismaSchemaAnalyzer, dev mode only), `@lib/devtools/documentation` (OpenAPI helpers), `@lib/http/routing/expressRouter` (types `HandlerFunction`·`MiddlewareHandlerFunction`), `@ext/winston`. Note: `sendMappedCrudError` honors an explicit `error.statusCode`/`error.code` (e.g. the filter-operator `INVALID_FILTER`/400 thrown by the query builder) before falling back to Prisma error mapping.

### crudHelpers.ts
**Responsibility**: The single source of CRUD's pure transformation logic and JSON:API domain types. It parses the query string (`include`/`select`/`fields`/`sort`/`page`/`filter`, including OR conditions), validates the include policy (depth, count, whitelist), and performs schema-based smart type conversion (rejecting with 400 when UUID validation fails). It builds the parsed result into Prisma `findMany`/`include`/`where`/`orderBy` options, and handles pagination meta, error sanitization (redacting sensitive data), and raw row → JSON:API resource transformation.

**Filter operator semantics** (the `?filter[field_op]=value` map, in `PrismaQueryBuilder.buildFieldConditions` + the parse layer `parseFilterValue`):
- **Comparison/string/membership** (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `between`, `start`→`startsWith`, `end`→`endsWith`, `contains`, `in`, `not_in`→`notIn`, `null`, `not_null`) map directly to real Prisma operators.
- **`like`/`ilike`** are LITERAL substring matches (Prisma `contains`), NOT SQL `LIKE` (Prisma has no raw-LIKE). An unescaped `%` is rejected with **400 INVALID_FILTER** (use `\%` for a literal percent); `ilike` adds `mode:'insensitive'` (PostgreSQL). The `%`-shorthand auto-detect path (bare `filter[name]=%foo%`) is exempt from the reject rule for back-compat.
- **`present`/`blank`/`exists`** are NULL-only (no empty-string check): `present:true`==`NOT NULL`, `blank` is the inverse, and `exists` is an alias of `present` (collapsed to one branch).
- **Array operators `all`/`elemMatch`/`size`** are TYPE-AWARE via an optional field-type map (see below): `all`→`hasEvery` (scalar list) / `array_contains` (Json); `elemMatch`→`has`(single)/`hasSome`(array) (scalar list) / `array_contains` (Json); `size:0`→`isEmpty`. `size:N>0` and `regex` have no Prisma `where` equivalent and are rejected with **400 INVALID_FILTER** at the parse layer. Applying an array operator to a non-array field (or when the type can't be resolved) throws a `statusCode:400`/`code:INVALID_FILTER` error rather than emitting a non-existent Prisma key.
- `buildFindManyOptions`/`buildWhereOptions`/`buildFieldConditions` accept an optional `fieldTypeMap` (`Map<fieldName,{isList,kind,type}>`) used only for the array-operator type checks; it is threaded in from `crudRouteBuilder` (resolved once per route via `prismaManager.getFieldTypeMap`). When absent/null, array operators 400 (never emit invalid keys). Nested relation fields are not in the root map, so array operators on relation paths 400.
**Main exports**:
- Classes: `CrudQueryParser` (`parseQuery`·`validateIncludes`·`mergeDefaultIncludes`), `PrismaQueryBuilder` (`buildFindManyOptions`·`buildIncludeOptions`·`buildSelectOptions`), `CrudResponseFormatter` (`createPaginationMeta`·`formatResponse`·`formatError`·`sanitizePrismaError`·`sanitizeDetails`), `JsonApiTransformer` (`transformToResource`·`transformToCollection`·`createJsonApiErrorResponse`·`createJsonApiResponse`·`createIncludedResources`).
- Types/interfaces: `CrudQueryParams`, `SortParam`, `PageParam`, `FilterCondition`, `FilterOperator`, `ErrorSecurityOptions`, and the JSON:API family (`JsonApiResource`, `JsonApiResourceIdentifier`, `JsonApiRelationship`, `JsonApiRelationshipData`, `JsonApiResponse`, `JsonApiError`, `JsonApiErrorResponse`, `JsonApiObject`, `JsonApiLinks`, `JsonApiRelationshipLinks`, `JsonApiAtomicOperation`, `JsonApiAtomicOperationsDocument`, `JsonApiAtomicResultsDocument`).
**Dependencies**: external tiers — `@lib/http/errors/errorHandler` (`ErrorHandler`·`ErrorResponseFormat`), `@lib/http/errors/errorCodes` (`ERROR_CODES`·`PRISMA_CANONICAL_ERROR_MAP`), `@ext/winston`. No same-tier dependencies (this file is the type/logic hub of the crud tier, and `crudRouteBuilder` consumes it).

### primaryKeyParsers.ts
**Responsibility**: A collection of pure functions that convert a CRUD route's `:id` / `:primaryKey` path parameter into the appropriate type. They do not depend on any instance state, and they provide the default parser the builder auto-selects when `options.primaryKeyParser` is not specified.
**Main exports**: `parseUuid` (string after UUID validation), `parseString` (as-is), `parseInt_` (integer validation), `parseIdSmart` (auto-detects UUID/number/string), `getSmartPrimaryKeyParser(databaseName, modelName, primaryKey)` (selects a parser by PK name — `parseUuid` for `uuid`-family names, `parseIdSmart` otherwise).
**Dependencies**: none (a leaf module with no external/same-tier imports). Consumed by `crudRouteBuilder`.

### jsonApiConstants.ts
**Responsibility**: The single source of truth (SSOT) for the JSON:API v1.1 media-type strings. It consolidates the `application/vnd.api+json` notation that used to be hardcoded all over the place into one place to prevent omissions.
**Main exports**: `JSON_API_CONTENT_TYPE` (the standard media type), `JSON_API_ATOMIC_CONTENT_TYPE` (the atomic-extension media type).
**Dependencies**: none (a leaf constant module). Consumed by `crudRouteBuilder` and the routing/middleware/documentation tiers.

## Import convention

The canonical import path takes the form `@lib/crud/<file>`, descending deep from the single `@lib` root.

```ts
import { CrudRouteBuilder, CrudBuilderContext } from '@lib/crud/crudRouteBuilder';
import { CrudQueryParser, PrismaQueryBuilder, JsonApiTransformer } from '@lib/crud/crudHelpers';
import { applyCrudSerializers } from '@lib/crud/crudResponseSerializer';
import { parseIdSmart, getSmartPrimaryKeyParser } from '@lib/crud/primaryKeyParsers';
import { JSON_API_CONTENT_TYPE } from '@lib/crud/jsonApiConstants';
```

**Layering direction**:
- **Inbound**: `@lib/http/routing/expressRouter` instantiates `CrudRouteBuilder` and injects itself as the shared `RouterContext` (aliased here as `CrudBuilderContext`). The routing/middleware/documentation tiers reference `jsonApiConstants`.
- **Outbound (crud → lower tiers)**: `crud` depends on `@lib/data/database` (Prisma), `@lib/http/{validation,serialization,errors}`, and — dev mode only — `@lib/devtools/{schema-api,documentation}` (gated by AUTO_DOCS / ENABLE_SCHEMA_API).
- **Intra-tier**: `crudRouteBuilder` → (`crudHelpers`, `primaryKeyParsers`, `jsonApiConstants`). The other three files do not depend on one another, being leaf/hub modules, and `crudRouteBuilder` is their single consumer.
