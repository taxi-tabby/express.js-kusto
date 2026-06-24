# data/database/ - Multi-DB Persistence Layer

The tier responsible for lifecycle management of multi-DB Prisma clients, the abstract repository base, distributed transaction handling, and the DB-folder-name → environment-variable conversion rule.

## Structure

```
database/
├── prismaManager.ts            # Multi-DB Prisma client singleton (getWrap auto-reconnect, driver adapter)
├── baseRepository.ts           # Abstract repository base (this.client, transactions/batches)
├── repositoryManager.ts        # Loads repositories from the generated REPOSITORY_REGISTRY
├── transactionCommitManager.ts # Saga + compensating distributed transactions
├── fieldTypeMap.ts             # Pure: parse a model's field-type map from schema.prisma text
└── dbNaming.ts                 # Single source of truth (SSOT) for folder-name → env-var-name conversion
```

## Files

### `prismaManager.ts`
- **Responsibility**: Scans the app DB base directory (resolved dist-aware via `getAppDbBasePath()`) for `{name}/` subfolders to dynamically import/create a per-DB Prisma client and holds it as a singleton. In a bundled (dist-only) deployment the webpack build copies `src/app/db/**` to `dist/src/app/db/**` and `getAppDbBasePath()` returns the `dist/` path automatically; in the dev source tree it returns `src/app/db`. All DB folder, schema, and client path constructions in this module go through `getAppDbBasePath()` or `getDistDbBasePath()` (SSOT — no scattered `process.cwd(), 'src', 'app', 'db'` literals). If a connection error occurs during a `getWrap()` call, it performs lazy reconnection up to `MAX_RECONNECTION_ATTEMPTS=3` times per DB, with a `RECONNECTION_COOLDOWN_MS=30000` (30-second) cooldown. There is no periodic health polling; `healthCheck()` is an on-demand call. The driver adapter is auto-detected from the datasource provider. **DB-less services are supported**: a missing or empty DB base directory is not an error — `initialize()` boots with zero databases (logged, not thrown), so `getReadiness()` reports healthy (total=0) and `/healthz` returns 200.
- **Main exports**: `class PrismaManager` (`getInstance`, `initialize`, `getClient` (async, includes reconnection), `getClientSync`, `getWrap`, `getAvailableDatabases`, `isConnected`, `getStatus`, `healthCheck`, `getProviderForDatabase`, `getFieldTypeMap`), `const prismaManager` (singleton), `interface DatabaseConfig`, `function listDatabaseFolders(dbPath)` (DB folder names under a path; missing directory → `[]`, never throws — the source of truth for the init scan and DB-less support), `function getAppDbBasePath(cwd?)` (SSOT dist-aware base for all DB folder/schema/client path resolution: bundled runtime → `dist/src/app/db`, dev source tree → `src/app/db`; enables dist-only deploys without `src/app/db` present), and `folderNameToEnvVarName` re-exported from `dbNaming`.
  - `getFieldTypeMap(databaseName, modelName)`: returns the model's `Map<fieldName, {isList,kind,type}>` (or `null` on failure), parsed from the database's `schema.prisma` (read the same way as `getProviderForDatabase`, via `getAppDbBasePath()`) and cached per `db.model`. Delegates parsing to the pure `fieldTypeMap.buildFieldTypeMapFromSchema`. Consumed by the CRUD engine (`@lib/crud`) to validate that array operators (`all`/`elemMatch`/`size`) target scalar-list/Json fields only — a runtime-legal alternative to the dev-only `PrismaSchemaAnalyzer` (no `crud → devtools` edge). NOTE: it parses the `.prisma` text rather than the client's `_runtimeDataModel` because Prisma 7's runtime data model omits `isList` (it can't distinguish `String[]` from `String`); the schema file is the authoritative source and is copied into `dist` by the webpack build.
- **Dependencies**: `@lib/data/database/dbNaming` (folder-name conversion), `@lib/data/database/fieldTypeMap` (`buildFieldTypeMapFromSchema`/`FieldTypeInfo`), `@lib/types/generated-db-types` (`DatabaseClientMap`/`DatabaseName`/`PrismaManager*Overloads`), `@ext/winston`, `fs`/`path`/`dotenv`.

### `fieldTypeMap.ts`
- **Responsibility**: A pure, dependency-free helper that parses a model's field-type map from `schema.prisma` text. It distinguishes scalar lists (`String[]` → `{isList:true, kind:'scalar'}`), Json fields (`{type:'Json'}`), plain scalars, and relation fields (`kind:'object'`). It lives in the `data` tier so the runtime `crud` tier can depend on it without a `crud → devtools` back-edge (SSOT for runtime field-kind lookup). Used to gate CRUD array operators to scalar-list/Json fields. It parses the schema TEXT (not the client runtime data model) because Prisma 7's `_runtimeDataModel` does not carry `isList`, so it cannot tell a scalar list from a plain scalar.
- **Main exports**: `interface FieldTypeInfo` (`{ isList, kind, type }`), `function buildFieldTypeMapFromSchema(schemaContent, modelName): Map<string, FieldTypeInfo> | null` (returns `null` — never throws — when the model block can't be found).
- **Dependencies**: None (pure). Consumed by `prismaManager.getFieldTypeMap` (runtime) and exercised directly by unit + integration tests.

### `baseRepository.ts`
- **Responsibility**: The abstract base that app repositories (`src/app/repos/*`) extend. It enforces, in the constructor, that subclasses implement `getDatabaseName()`, and provides a type-safe Prisma client via `this.client` (= `PrismaManager.getWrap()`). It includes transaction/batch helpers.
- **Main exports**: `abstract class BaseRepository<T extends DatabaseNamesUnion>` (protected `getDatabaseName()`, protected get `client`, `getAsyncClient()`, `$createDistributedOperation()`, `$transaction()`, `$batchOperation()`, `$runDistributedTransaction()`), `interface DistributedTransactionOperation`.
- **Dependencies**: `@lib/data/database/prismaManager` (`prismaManager`/`PrismaManager`), `@lib/data/database/transactionCommitManager` (delegation of distributed transactions), `@lib/types/generated-db-types`, `@ext/winston`.
- **Caution**: `$createDistributedOperation()`/`$runDistributedTransaction()` are unreliable due to Prisma connection pool limitations, so avoid using them (see CLAUDE.md).

### `repositoryManager.ts`
- **Responsibility**: Dynamically imports and instantiates every repository in the generated `REPOSITORY_REGISTRY` (injecting `PrismaManager` into the constructor) and provides lookup/reload by name. Singleton.
- **Main exports**: `class RepositoryManager` (`getInstance`, `initialize`, `getRepository`, `hasRepository`, `getLoadedRepositoryNames`, `reloadRepository`, `getStatus`), `const repositoryManager` (singleton).
- **Dependencies**: `@lib/data/database/prismaManager` (singleton for injection), `@lib/types/generated-repository-types` (`REPOSITORY_REGISTRY`/`RepositoryName`/`GetRepositoryType`), `@ext/winston`.

### `transactionCommitManager.ts`
- **Responsibility**: A distributed transaction executor based on the Saga pattern + compensating transactions. Because true 2PC is impossible given Prisma connection pool constraints, it operates in the order Phase 1 (side-effect-free validation) → Phase 2 (sequential commit) → compensation on failure. It guarantees eventual consistency and Durability, but Atomicity/Isolation are only partially guaranteed.
- **Main exports**: `class TransactionCommitManager` (`executeDistributedTransaction`), `enum TransactionState`, `interface TransactionParticipant`, `interface TransactionCommitOptions`, `interface TransactionCommitResult`.
- **Dependencies**: `@lib/data/database/prismaManager` (`PrismaManager` injection), `@lib/types/generated-db-types`, `@ext/winston`. It is instantiated and used by `baseRepository`.

### `dbNaming.ts`
- **Responsibility**: The single source of truth (SSOT) for converting a DB folder name into its connection environment-variable name. It inserts `_` at camelCase/PascalCase boundaries, converts to UPPER_SNAKE, and then appends the `__KUSTO_RDB_URL` suffix (e.g., `myDatabase` → `MY_DATABASE__KUSTO_RDB_URL`). Separated out as a dependency-free module, it is imported by both `prismaManager` (runtime) and the CLI (`kusto-db-cli`).
- **Main exports**: `function folderNameToEnvVarName(folderName: string): string`.
- **Dependencies**: None (a pure function with no external dependencies). `prismaManager` re-exports it.

## Import note

The canonical import path is of the form `@lib/data/database/<file>` (single `@lib` root, only the path deepened).
Example: `@lib/data/database/prismaManager`, `@lib/data/database/baseRepository`.

- Inbound: app repositories (`src/app/repos/*`) extend `baseRepository`, and `RepositoryManager`/`KustoManager` (`@lib/data/di`) consume `prismaManager`·`repositoryManager`. `Core` initialization calls them in the order `PrismaManager → RepositoryManager`.
- Outbound: depends only on generated types (`@lib/types/generated-*`) and logging (`@ext/winston`). It does not back-reference the higher routing/DI/documentation tiers. `dbNaming` is the lowest (dependency-free) module within this tier.
