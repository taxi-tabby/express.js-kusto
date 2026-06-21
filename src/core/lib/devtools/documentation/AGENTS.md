# documentation/ - OpenAPI 3.1 documentation auto-generation (AUTO_DOCS)

A sub-tier that assembles OpenAPI 3.1.0 documentation from registered routes and Prisma models, and serves Swagger UI / `openapi.json` / a dev info page. The entire tier is gated behind `AUTO_DOCS=true` & `NODE_ENV !== 'production'`.

## Structure

```
documentation/
├── index.ts                  # barrel — re-exports sub-modules (excludes documentationGenerator/staticFileMiddleware)
├── openApiTypes.ts           # OpenAPI 3.1 partial type definitions (the type source for the whole tier)
├── pathConverter.ts          # Express path → OpenAPI path + tag/operationId derivation
├── contentTypeRule.ts        # contentType mode → media type key (json / jsonapi / html)
├── infoSource.ts             # env + package.json → OpenAPI info object
├── serversSource.ts          # env(OPENAPI_SERVERS / HOST·PORT) → OpenAPI servers[]
├── schemaConverter.ts        # validator Schema/FieldSchema → OpenAPI schema
├── dmmfToOpenApi.ts          # Prisma scalar/enum field → OpenAPI schema
├── jsonApiSchemas.ts         # Prisma model → JSON:API resource/attributes/relationships/error schema
├── jsonApiHelpers.ts         # JSON:API request body/response schema for CRUD routes
├── openApiBuilder.ts         # assembles the full OpenApiDocument (routes → paths/components)
├── syncSchemas.ts            # analyzer → components.schemas synchronization (DMMF-based)
├── documentationGenerator.ts # static registry + Swagger HTML + isDocumentationEnabled() gate
└── staticFileMiddleware.ts   # middleware serving dev-docs static assets (css/js)
```

## Files

### index.ts
- **Role**: barrel that re-exports the sub-modules from one place.
- **export**: `export *` of `openApiTypes`, `pathConverter`, `contentTypeRule`, `infoSource`, `serversSource`, `schemaConverter`, `dmmfToOpenApi`, `jsonApiSchemas`, `openApiBuilder`, `syncSchemas`, `jsonApiHelpers`. (`documentationGenerator`/`staticFileMiddleware` are intentionally excluded — to avoid cycles and to encourage direct import.)
- **Depends on**: files within the same tier.

### openApiTypes.ts
- **Role**: OpenAPI 3.1.0 / JSON Schema 2020-12 partial type definitions that the framework produces and consumes. The single source for all types in this tier.
- **Main exports**: `OpenApiSchema`, `OpenApiRef`, `OpenApiSchemaOrRef`, `OpenApiObjectSchema`, `OpenApiInfo`, `OpenApiServer`, `OpenApiParameter`, `OpenApiMediaTypeObject`, `OpenApiRequestBody`, `OpenApiResponse`, `OpenApiOperation`, `OpenApiPathItem`, `OpenApiComponents`, `OpenApiTag`, `OpenApiDocument`, `OpenApiPrimitiveType`, `ContentTypeMode`.
- **Depends on**: none (pure types).

### pathConverter.ts
- **Role**: converts an Express router path to an OpenAPI path (`:foo` → `{foo}`), and derives the Swagger group tag and a stable `operationId` from the path. Strips the capture groups of regex parameters via normalization.
- **Main exports**: `PathConversionResult` (interface), `toOpenApiPath()`, `deriveResourceTag()`, `deriveOperationId()`.
- **Depends on**: none (pure functions).

### contentTypeRule.ts
- **Role**: resolves a `ContentTypeMode` ('json' | 'jsonapi' | 'html') to the actual media type string. `'html'` is for extension-registered HTML page routes (e.g. GET_REACT) — not an API.
- **Main exports**: `mediaTypeFor(mode)` → `'application/json'`, `'application/vnd.api+json'`, or `'text/html'`.
- **Depends on**: `@lib/devtools/documentation/openApiTypes` (`ContentTypeMode`), `@lib/crud/jsonApiConstants` (`JSON_API_CONTENT_TYPE`).

### infoSource.ts
- **Role**: builds the OpenAPI `info` object. Priority: env (`OPENAPI_TITLE`/`OPENAPI_VERSION`/`OPENAPI_DESC`) > package.json > hardcoded fallback (`kusto-api`/`0.0.0`).
- **Main exports**: `buildInfo(packageJson, env)` → `OpenApiInfo`.
- **Depends on**: `@lib/devtools/documentation/openApiTypes` (`OpenApiInfo`).

### serversSource.ts
- **Role**: builds OpenAPI `servers[]`. Uses `OPENAPI_SERVERS` (JSON array) when valid, otherwise a single-server fallback based on `HOST`/`PORT`. Invalid entries are skipped after a warning log.
- **Main exports**: `buildServers(env)` → `OpenApiServer[]`.
- **Depends on**: `@lib/devtools/documentation/openApiTypes` (`OpenApiServer`), `@ext/winston` (`log`).

### schemaConverter.ts
- **Role**: converts the `FieldSchema`/`Schema` of `@lib/http/validation/validator` (the request/response schemas of validated routes) into OpenAPI 3.1 schema. Unknown types fail-fast (throw).
- **Main exports**: `fieldToOpenApi(field)`, `schemaToOpenApi(schema)`.
- **Depends on**: `@lib/http/validation/validator` (`FieldSchema`, `Schema`, `ValidatorType`), `@lib/devtools/documentation/openApiTypes`.

### dmmfToOpenApi.ts
- **Role**: maps Prisma scalar types/enums to OpenAPI primitive type+format. optional becomes a type union (`T | null`), list becomes an array wrapper. enum fields become a `$ref`.
- **Main exports**: `fieldToSchema(field, enumValuesByName)`, `enumToOpenApi(name, values)`.
- **Depends on**: `@lib/devtools/schema-api/crudSchemaTypes` (`PrismaFieldMetadata`), `@lib/devtools/documentation/openApiTypes`, `@ext/winston` (`log`). **(depends on the lower-tier schema-api)**

### jsonApiSchemas.ts
- **Role**: converts Prisma model metadata into the OpenAPI schema for JSON:API resource object components (attributes / relationships / resource / error). Excludes id, relation, and PK fields from attributes.
- **Main exports**: `jsonApiAttributes(model, enumValuesByName)`, `jsonApiRelationships(model)`, `jsonApiResource(model, enumValuesByName)`, `jsonApiErrorObject()`.
- **Depends on**: `@lib/devtools/schema-api/crudSchemaTypes` (`PrismaModelInfo`), `@lib/devtools/documentation/openApiTypes`, `@lib/devtools/documentation/dmmfToOpenApi` (`fieldToSchema`). **(depends on the lower-tier schema-api)**

### jsonApiHelpers.ts
- **Role**: generates the JSON:API request body / single & collection response / error response schema registered by CRUD routes. attributes & relationships `$ref` the components that `syncSchemas` pre-registers.
- **Main exports**: `jsonApiBody(modelName, op)` ('create'|'update'), `jsonApiResponse(modelName, statusCode)`, `jsonApiErrorResponse(statusCode)`, `jsonApiCollectionResponse(modelName)`.
- **Depends on**: `@lib/devtools/documentation/openApiTypes` (`OpenApiObjectSchema`).

### openApiBuilder.ts
- **Role**: assembles a completed `OpenApiDocument` from the registered routes array + components schemas. Builds paths/operations, converts parameters/requestBody/responses, detects whether the input is already in OpenAPI form or is a validator Schema, ensures operationId uniqueness (appends `_2`/`_3` suffix on duplicates), and composes document-level tags[]. **Resilient per route**: a single route whose doc fails to convert is skipped with a `log.Warn` rather than crashing the whole spec (field-level conversion stays fail-fast). For `text/html` routes with no explicit responses, the default 200 is an HTML string (not the JSON success envelope).
- **Main exports**: `RouteDocumentationLike` (interface), `BuildOpenApiInput` (interface), `buildOpenApiDocument(input)`.
- **Depends on**: `@lib/http/validation/validator` (`Schema`), `@lib/devtools/documentation/openApiTypes`, `schemaConverter`, `infoSource` (`buildInfo`), `serversSource` (`buildServers`), `pathConverter` (`toOpenApiPath`/`deriveResourceTag`/`deriveOperationId`), `contentTypeRule` (`mediaTypeFor`), `@ext/winston` (`log`).

### syncSchemas.ts
- **Role**: takes all models from a single `PrismaSchemaAnalyzer` → registers each model's 3 JSON:API variants (resource/attributes/relationships) + enum schemas into components.schemas via `DocumentationGenerator.registerSchema`. Registers the shared `JsonApiError` schema. Returns immediately when the gate is off.
- **Main exports**: `syncSchemasFromAnalyzer(analyzer, databaseName)`, `registerJsonApiErrorSchema()`.
- **Depends on**: `@lib/devtools/schema-api/prismaSchemaAnalyzer`, `@lib/devtools/schema-api/crudSchemaTypes` (`PrismaModelInfo`), `documentationGenerator` (`DocumentationGenerator`/`isDocumentationEnabled`), `jsonApiSchemas`, `dmmfToOpenApi` (`enumToOpenApi`), `@ext/winston` (`log`). **(the synchronization point that wires together both schema-api and documentationGenerator)**

### documentationGenerator.ts
- **Role**: a static registry that collects routes, schemas, and tag descriptions, and is also the document-artifact generator. Holds the single canonical gate `isDocumentationEnabled()`, and renders the Swagger UI 5.x HTML shell and the dev info page HTML. When the gate is off, every register/generate is a no-op.
- **Main exports**: `DocumentationGenerator` (static class — `registerRoute`/`registerTag`/`registerSchema`/`updateRoutePaths`/`generateOpenAPISpec`/`generateHTMLDocumentation`/`generateDevInfoPage`/`getRoutes`/`reset`, etc.), `isDocumentationEnabled()`, `RouteDocumentation` (interface), `ApiDocumentation` (= `OpenApiDocument` alias).
- **Depends on**: `@lib/http/validation/requestHandler` (`ResponseConfig`), `@ext/winston` (`log`), `@lib/devtools/documentation` (barrel — `buildOpenApiDocument`/types). Dynamically requires `package.json`.

### staticFileMiddleware.ts
- **Role**: Express middleware serving dev-docs static assets (`.css`/`.js`) from the `static/` directory. Active only when `AUTO_DOCS=true` & non-production; all other requests pass through via `next()`.
- **Main exports**: `StaticFileMiddleware` (static class — `serveStaticFiles()` middleware factory, `getAvailableFiles()`, `fileExists()`).
- **Depends on**: `express`, `path`, `fs`, `@ext/winston` (`log`). (Not in the barrel — direct import.)

## Import

The canonical import path is `@lib/devtools/documentation/<file>` (single `@lib` root, deepened path). General consumers import from the barrel `@lib/devtools/documentation`, but `documentationGenerator`/`staticFileMiddleware` are imported directly by file path.

**Layering direction**:
- **Inbound**: `src/core/Core.ts` (registers documentation routes & syncs models), `ExpressRouter` (`DocumentationGenerator.registerRoute`/`registerTag` on route registration), CRUD router (uses the JSON:API body/response helpers).
- **Outbound**: `@lib/devtools/schema-api/*` (DMMF analysis & model types — `dmmfToOpenApi`/`jsonApiSchemas`/`syncSchemas`), `@lib/http/validation/*` (validator & requestHandler), `@lib/crud/jsonApiConstants`, `@ext/winston`. **This tier depends on schema-api, but schema-api does not depend on this tier.**
