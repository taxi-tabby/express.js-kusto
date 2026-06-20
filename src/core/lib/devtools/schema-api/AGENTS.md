# schema-api/ - CRUD Schema Introspection API (ENABLE_SCHEMA_API)

A sub-tier that introspects the Prisma DMMF to register and query CRUD schema information. It provides the `/api/schema/*` endpoints and is enabled only when `ENABLE_SCHEMA_API=true` or `NODE_ENV=development`/`dev`. The analysis results (`PrismaModelInfo`, etc.) are shared by both the CRUD router and the `documentation/` tier.

## Structure

```
schema-api/
├── crudSchemaTypes.ts      # constants (CRUD_ACTIONS/PRISMA_TYPE_MAPPING) + all schema interfaces
├── relationshipConfig.ts   # relationship-pattern / Many-to-Many detection manager
├── prismaSchemaAnalyzer.ts # Prisma client DMMF introspection (CRUD+docs source)
├── crudSchemaRegistry.ts   # CRUD schema register/query singleton registry + enablement gate
├── schemaApiRouter.ts      # /api/schema GET endpoint Express router (dev-only)
└── schemaApiSetup.ts       # helper that mounts the router on the Express app (prevents duplicate registration)
```

## Files

### crudSchemaTypes.ts
- **Role**: The source of constants and types for the whole tier. A pure definition file (no runtime dependencies).
- **Main exports**: Constants `CRUD_ACTIONS` (`index`/`show`/`create`/`update`/`destroy` — excluding `recover`), `PRISMA_TYPE_MAPPING` (Prisma → JS types). Interfaces `PrismaFieldMetadata`, `PrismaRelationInfo`, `PrismaIndexInfo`, `PrismaModelInfo`, `CrudEndpointInfo`, `CrudSchemaInfo`, `SchemaApiResponse<T>`, `AllSchemasResponse`.
- **Dependencies**: None.

### relationshipConfig.ts
- **Role**: Analyzes model relationships via pattern matching to detect Many-to-Many relationships and dynamically generate join-table/column/inverse-relation names. Has built-in default patterns for User-Role/User-Permission/Role-Permission and generic m2m.
- **Main exports**: `RelationshipConfigManager` (class — `isManyToManyRelation()`/`getManyToManyConfig()`/`isIntermediateTableRelation()`/`getActualTargetModel()`/`generateInverseSideName()`/`addPattern()`/`addManyToManyConfig()`, etc.), `RelationshipPattern` (interface), `ManyToManyConfig` (interface).
- **Dependencies**: `@ext/util` (`pluralize`, `singularize`).

### prismaSchemaAnalyzer.ts
- **Role**: Analyzes the Prisma client's DMMF (boundaries such as `_runtimeDataModel`) to extract model/field/relation/index/enum metadata (`PrismaModelInfo`). Holds a per-DB-name instance cache and a model cache. The shared introspection source for the CRUD router and documentation synchronization.
- **Main exports**: `PrismaSchemaAnalyzer` (class — `getInstance()`/constructor, `getDatabaseName()`/`getAllModels()`/`getModel()`/`hasModel()`/`getPrimaryKeyField()`/`getRequiredFields()`/`getUpdatableFields()`/`getJsonFields()`/`isEnumType()`/`getEnumValues()`/`clearCache()`).
- **Dependencies**: `@ext/winston` (`log`), `@lib/devtools/schema-api/crudSchemaTypes` (model types + `PRISMA_TYPE_MAPPING`). The Prisma client is received across an `any` boundary.

### crudSchemaRegistry.ts
- **Role**: A singleton registry that registers and manages CRUD schema information. It determines enablement via `checkEnvironment()` (`isSchemaApiEnabled()` — the tier's single canonical gate), auto-registers all models from the analyzer, and provides per-DB/per-model queries plus TypeORM-compatible schema conversion.
- **Main exports**: `CrudSchemaRegistry` (singleton class — `getInstance()`, `isSchemaApiEnabled()`, `autoRegisterAllModels()`, `registerSchema()`, `getAllSchemas()`/`getSchema()`/`getSchemasByDatabase()`, `hasSchema()`/`hasModelInAnyDatabase()`, `getRegisteredModelNames()`/`getSchemaCount()`, `getTypeOrmCompatibleSchema()`, `getAutoRegisteredSchemas()`/`getManualRegisteredSchemas()`, `getRelationshipManager()`, `clearAllSchemas()`/`debugRegisteredSchemas()`).
- **Dependencies**: `@lib/devtools/schema-api/crudSchemaTypes`, `@lib/devtools/schema-api/prismaSchemaAnalyzer`, `@lib/devtools/schema-api/relationshipConfig`, `@ext/util` (`pluralize`, `createPaginationCursor`), `@ext/winston` (`log`).

### schemaApiRouter.ts
- **Role**: The Express router defining the `/api/schema/*` GET endpoints. It applies the enablement gate + localhost restriction via `developmentOnlyMiddleware`, and responds with the schema list/detail/stats/health/help from the registry. Routes: `/`, `/databases`, `/database/:databaseName`, `/database/:databaseName/:modelName`, `/:databaseName/:modelName`, `/auto-registered`, `/manual-registered`, `/meta/health`, `/meta/help`, `/meta/stats`.
- **Main exports**: `SchemaApiRouter` (class — sets up routes in the constructor, returns the Express `Router` via `getRouter()`).
- **Dependencies**: `express`, `@lib/devtools/schema-api/crudSchemaRegistry`, `@ext/util` (`createPaginationCursor`), `@ext/winston` (`log`), `@lib/http/errors/errorCodes` (`ERROR_CODES`).

### schemaApiSetup.ts
- **Role**: A helper that mounts `SchemaApiRouter` on the Express app. It delegates the enablement decision to `CrudSchemaRegistry.isSchemaApiEnabled()`, prevents duplicate registration with a static flag, and prints a registration log.
- **Main exports**: `SchemaApiSetup` (static class — `registerSchemaApi(app, basePath='/api/schema')`, `isSchemaApiRegistered()`, `resetRegistrationState()`).
- **Dependencies**: `express` (`Application`), `@lib/devtools/schema-api/schemaApiRouter`, `@lib/devtools/schema-api/crudSchemaRegistry`, `@ext/winston` (`log`).

## Import

The canonical import path is `@lib/devtools/schema-api/<file>` (single `@lib` root, deepened path). Write intra-folder cross-references the same way (no relative paths).

**Layering direction**:
- **Inbound**: `src/core/Core.ts` (at bootstrap, `SchemaApiSetup.registerSchemaApi` + `CrudSchemaRegistry.autoRegisterAllModels`), the CRUD router (analyzes models via `PrismaSchemaAnalyzer`), `@lib/devtools/documentation/*` (`dmmfToOpenApi`/`jsonApiSchemas`/`syncSchemas` consume `PrismaSchemaAnalyzer`·`crudSchemaTypes`).
- **Outbound**: Depends only on `@ext/util`, `@ext/winston`, `@lib/http/errors/errorCodes`. **This tier does not depend on the `documentation/` tier (one-way — documentation → schema-api).**
- **Internal dependency graph**: `crudSchemaTypes` (type source) ← `prismaSchemaAnalyzer`/`relationshipConfig` ← `crudSchemaRegistry` ← `schemaApiRouter` ← `schemaApiSetup`.
