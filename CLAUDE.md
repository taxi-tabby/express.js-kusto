# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Express.js-Kusto is a TypeScript framework for building REST APIs using Convention over Configuration. It wraps Express.js with a fluent routing API, multi-database Prisma management, dependency injection, and JSON:API v1.1 compliant CRUD generation. (Current version: see `package.json`.)

**Language**: Korean is used in commit messages and some documentation. Follow this convention. (Exception: every `AGENTS.md` is written in English — see the **AGENTS.md** rule under Architecture.)

## Commands

```bash
# Development
npm run dev              # Start dev server (runs generate + nodemon)
npm run start            # Start with ts-node directly
npm run serve            # Run production build (dist/server.js)

# Build
npm run build            # Production build (db generate → type generate → webpack → clean)
npm run build:dev        # Development webpack build

# Type generation (auto-runs in dev mode via nodemon on file changes)
npm run generate         # Generate types for injectable/repository/db

# Unified CLI (kusto) — single commander entry over db / update / generate
#   src/core/cli/kusto.ts, also exposed as the `kusto` bin (npx kusto ...)
npm run kusto -- db list                  # = npm run db -- list
npm run kusto -- update check             # check for framework updates
npm run kusto -- update apply --dry-run   # preview an update (no writes)
npm run kusto -- generate                 # generate framework types
npx kusto monitor                         # live htop-style dev dashboard (separate terminal)

# Database (kusto-db CLI, via ts-node) — also `kusto db <...>`
npm run db -- generate --all              # Generate all Prisma clients
npm run db -- migrate -t dev -n "name" -d dbname  # Run migration
npm run db -- studio -d dbname            # Open Prisma Studio
npm run db -- seed -d dbname              # Seed data
npm run db -- validate -d dbname          # Validate schema
npm run db -- debug                       # System info

# Framework self-update (src/core/updater/, uses archiver/yauzl) — also `kusto update <...>`
npm run updater:check    # Check for new versions  (= kusto update check)
npm run updater:update   # Apply update; supports -- --dry-run / --yes / --package <zip>
npm run updater:generate # Build a release update package  (= kusto update build)
```

No test runner is configured in this project.

## Architecture

### Two-Zone Design

- **`src/core/`** — Framework internals. **In any project that consumes this framework, `src/core/` is STRICTLY OFF-LIMITS — never edit it directly; updates arrive only via `kusto update`.** This repository is the *sole* exception: it *implements* the framework, so `src/core/` is edited here — but only with full discipline (read the folder's `AGENTS.md` first, respect the one-way tier dependency direction, and keep `AGENTS.md` in sync). See **`src/core/AGENTS.md`**.
- **`src/app/`** — Developer workspace where all application code lives.

### AGENTS.md — mandatory to read AND to keep in sync

**Every folder carries an `AGENTS.md`** that summarizes its files, exports, and dependency direction. Three rules, all non-negotiable:

- **Always reference it before any work.** Before reading or editing any file in a folder, you MUST first read that folder's `AGENTS.md` (and its parent-tier `AGENTS.md`). It is the single source of truth for what each file does and which way dependencies flow — do not start from the code alone.
- **Always update it on any change.** When you add a feature, file, or export, or change behavior or dependency direction, you MUST update the affected folder's `AGENTS.md` in the same change. Code and its `AGENTS.md` must never drift; a stale `AGENTS.md` is a defect.
- **Always write it in English.** Every `AGENTS.md` is authored in English — one unified language, chosen for reliable LLM comprehension — even though commit messages and other docs may be Korean. Do not mix languages within or across `AGENTS.md` files.

### Core Internal Structure (Tier Layout)

`src/core` is organized into purpose- and layer-grouped tiers (SSOT methodology). The `@lib` alias root is unchanged (`@lib/*` → `src/core/lib/*`); paths are deepened by tier. Each tier/folder has its own `AGENTS.md` (see the **AGENTS.md** rule above) listing its files, exports, and dependency direction.

```
src/core/
├── index.ts              # public API barrel (curated re-exports)
├── bootstrap/            # lifecycle: Application, Core, expressAppSingleton(@deprecated)
├── external/             # 3rd-party wrappers (leaf, zero intra-core imports): winston, util
├── cli/                  # unified `kusto` CLI (commander) over db/update/generate
├── scripts/              # standalone build/codegen CLI tooling (operator-facing)
├── updater/              # framework self-update (excluded from its own deploy map)
└── lib/
    ├── http/             # request-handling tier
    │   ├── routing/      # expressRouter, loadRoutes_V6_Clean, middlewareHelpers, proxyMiddleware
    │   ├── validation/   # requestHandler (_VALIDATED engine), validator
    │   ├── serialization/# serializer (BigInt/Date + response serializer), serializationMiddleware
    │   └── errors/       # errorCodes (SSOT), errorFormatter, errorHandler
    ├── data/             # persistence tier
    │   ├── database/     # prismaManager, baseRepository, repositoryManager, transactionCommitManager, dbNaming
    │   └── di/           # dependencyInjector, kustoManager (req.kusto facade)
    ├── crud/             # JSON:API CRUD engine: crudRouteBuilder, crudHelpers, primaryKeyParsers, jsonApiConstants
    ├── devtools/         # DEV-ONLY (AUTO_DOCS / ENABLE_SCHEMA_API / dev monitor)
    │   ├── documentation/# OpenAPI 3.1 generation + Swagger UI + dev static assets
    │   ├── schema-api/   # /api/schema introspection: crudSchema*, relationshipConfig, prismaSchemaAnalyzer
    │   └── monitor/      # `kusto monitor` metrics source: GET /__kusto/metrics (dev+localhost)
    ├── config/           # environmentLoader
    └── types/            # express-extensions + generated-*.ts (do-not-edit codegen)
```

**Dependency direction (one-way):** `bootstrap` → tiers; within `lib`, higher tiers depend inward on lower ones; `external` and `config` are leaves. Do not introduce a back-edge (e.g. `data` importing `http`). `devtools` is dev-only and may depend on runtime tiers, never the reverse.

### Initialization Flow

`src/index.ts` → `Application.start()` → `Core.initialize()` which sequentially loads:
1. PrismaManager (DB clients from `src/app/db/`)
2. RepositoryManager (repos from `src/app/repos/`)
3. DependencyInjector (modules from `src/app/injectable/`)
4. Express middleware setup (from `src/app/routes/middleware.ts`)
5. Route auto-discovery (from `src/app/routes/**/route.ts`)
6. Documentation routes setup (when `AUTO_DOCS=true`, dev only)

All managers are singletons.

### Auto-Generated Type Files

`npm run generate` produces three files in `src/core/lib/types/` — **do not edit manually**:
- `generated-db-types.ts` — DB client types from `src/app/db/` folders
- `generated-injectable-types.ts` — Injectable module/middleware types from `src/app/injectable/`
- `generated-repository-types.ts` — Repository types from `src/app/repos/`

These provide type-safe access to `injected.*`, `repo.*`, `db.*` in route handlers.

### Routing System (Convention-Based)

Folder structure under `src/app/routes/` maps directly to URL paths:
- `routes/users/[userId]/posts/route.ts` → `/users/:userId/posts`
- `[paramName]` → `:paramName`, `[^paramName]` → regex param, `..[^paramName]` → wildcard

**Only `route.ts` and `middleware.ts` files are auto-discovered.** Other `.ts` files in route folders are ignored by the loader.

Route files must `export default router.build()` using `ExpressRouter`.

### Global Middleware

Two layers, split by ownership so framework essentials don't live in `src/app`:

**Framework-essential (Core-owned, always on, not in app):** registered by `Core` around the app stack — `req.kusto` injection + client-IP resolution (`clientIpMiddleware`) run before routes, and the global JSON:API error handler runs last. These live in `@lib/http/routing/{frameworkMiddleware,clientIpMiddleware}.ts` and ship/update with core.

**Policy stack (`defaultGlobalMiddleware()` from `@core`, user-overridable):** helmet → CORS (whitelist from `CORS_WHITELIST` env) → cookie-parser → body-parser (JSON + URL-encoded, 50mb, `application/vnd.api+json`) → request logging (`Footwalk`). Defined in `@lib/http/routing/globalMiddleware.ts`.

`src/app/routes/middleware.ts` is a **thin, optional** user file: `export default [...defaultGlobalMiddleware(), /* your middleware */]`. If the file is absent, the loader applies `defaultGlobalMiddleware()` automatically; tune via `defaultGlobalMiddleware({ corsWhitelist, bodyLimit, helmet, disableRequestLog })`.

Effective request order: `req.kusto` → clientIp → helmet → CORS → cookie → body → log → routes → error handler.

### Handler Signature

All route handlers receive 5 parameters:
```typescript
async (req, res, injected, repo, db) => { ... }
```
- `req.kusto` — Unified resource access (modules, repos, DB clients)
- `req.validatedData` — Available only in `_VALIDATED` methods
- `req.with` — Middleware-injected parameters

### ExpressRouter Fluent API (`src/core/lib/http/routing/expressRouter.ts`)

Method chaining pattern:
```typescript
const router = new ExpressRouter();
router
    .WITH('middlewareName', params)
    .GET(handler)
    .POST_VALIDATED(requestSchema, responseSchema, handler)
    .CRUD('dbName', 'modelName', options);
export default router.build();
```

Key method categories:
- HTTP verbs: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `NOTFOUND`
- Response serializer (optional): pass `{ serialize }` as the last options arg to verb/`*_VALIDATED`/`*_SLUG` methods to refine the response. `serialize` is a function `(data, req) => shaped` or a declarative `{ pick: [...] }` / `{ omit: [...] }` (typed via `Pick`/`Omit`, arrays applied per-element). When omitted, behavior is unchanged. For `*_VALIDATED`, serialize runs before `responseConfig` validation.
- OpenAPI/Swagger docs (optional): the `/docs` UI is auto-generated and **every route auto-registers and auto-groups** — the resource tag and `operationId` are derived from the path, `_VALIDATED` request/response schemas become parameters/requestBody/responses, and `*_FILE` get framework summaries. To enrich a route, pass doc fields in the same last options arg (alongside `serialize`): `{ summary?, description?, tags?, operationId?, deprecated? }` — e.g. `router.GET(handler, { summary: 'List users', tags: ['Users'] })`. A file-level default tag (and its Swagger group description) is set once via the constructor: `new ExpressRouter({ tag: 'Users', description: 'User management' })`. Precedence for the tag: per-route `tags` > constructor `tag` > path-derived. All fields are optional/back-compatible (docs only render in dev when `AUTO_DOCS=true`).
- Validated variants: `GET_VALIDATED`, `POST_VALIDATED`, etc. — require all defined status codes to be handled
- File uploads: `POST_SINGLE_FILE`, `POST_ARRAY_FILE`, `POST_FIELD_FILE`
- Middleware: `WITH(name, params?)`, `MIDDLEWARE(fn)`, `USE(fn)`
- Proxy: `MIDDLE_PROXY_ROUTE`, `STATIC`
- CRUD: `CRUD(dbName, modelName, options?)` — generates full JSON:API v1.1 REST endpoints

### Multi-Database Layer

Each subfolder in `src/app/db/` represents an independent database:
- Prisma clients generated into `src/app/db/{name}/client/`
- DB URL resolution (2 modes):
  1. `schema.prisma`에 `url = env("VAR_NAME")` → 해당 환경변수 사용
  2. `url` 생략 시 → 폴더명 컨벤션 `{FOLDER}__KUSTO_RDB_URL` 자동 적용 (camelCase → UPPER_SNAKE_CASE)
- 예: `src/app/db/default/` → `DEFAULT__KUSTO_RDB_URL`, `src/app/db/myData/` → `MY_DATA__KUSTO_RDB_URL`

Required schema structure:
```prisma
generator client {
  provider = "prisma-client-js"
  output   = "client"          # Must be "client"
}
datasource db {
  provider = "postgresql"       # Auto-detected for driver adapter
  url      = env("DEFAULT__KUSTO_RDB_URL")  # Or omit url for folder-name convention
}
```

PrismaManager uses lazy auto-reconnection: connection errors during `getWrap()` calls trigger up to 3 reconnect attempts with a 30s cooldown per database. There is no periodic health-check polling — `healthCheck()` is an on-demand call. (See `prismaManager.ts` for `MAX_RECONNECTION_ATTEMPTS` / `RECONNECTION_COOLDOWN_MS`.)

### Dependency Injection (`src/app/injectable/`)

Three file types, distinguished by suffix:
- `*.module.ts` — Service classes, accessed via `injected.camelCaseName` in handlers
- `*.middleware.ts` — Express middleware factories, used via `router.WITH('name')`
- `*.middleware.interface.ts` — TypeScript interfaces for middleware parameters

File paths are auto-converted to camelCase identifiers (e.g., `auth/jwt/export.module.ts` → `injected.authJwtExport`).

All files must use `export default`.

### Repository Pattern (`src/app/repos/`)

```typescript
import { BaseRepository } from '@lib/data/database/baseRepository';

export default class FooRepository extends BaseRepository<'dbname'> {
    protected getDatabaseName(): 'dbname' { return 'dbname'; }
}
```

File naming: `{name}.repository.ts` — the `{name}` part becomes the key for `repo.getRepository('name')`.

Key inherited features: `this.client` (typed Prisma client via `getWrap`, 서버리스 자동 재연결), `this.getAsyncClient()`, `this.$transaction()`, `this.$batchOperation()`.

Avoid `$runDistributedTransaction()` — unreliable due to Prisma connection pool limitations.

### CRUD Router (JSON:API v1.1)

`router.CRUD('dbName', 'modelName', options)` auto-generates:
- `GET /` — index with filtering (`?filter[field_op]=value`), sorting (`?sort=-field`), pagination (`?page[number]=1&page[size]=10`), includes (`?include=relation`), field selection (`?select=field1,field2`)
- `GET /:id`, `POST /`, `PUT|PATCH /:id`, `DELETE /:id`, `POST /:id/recover`

Options: `primaryKey`, `primaryKeyParser`, `only`/`except`, per-operation `middleware` and `validation`.

### Documentation Routes (Dev Mode)

When `AUTO_DOCS=true` and `NODE_ENV=development`, Core.ts registers:
- `GET /docs` — Interactive API documentation HTML
- `GET /docs/openapi.json` — OpenAPI specification
- `GET /docs/dev` — Development info page (route list, links)

### Schema API (Dev Mode)

When `ENABLE_SCHEMA_API=true`, provides CRUD schema introspection at `/api/schema`.
Related modules: `CrudSchemaRegistry`, `PrismaSchemaAnalyzer`, `SchemaApiRouter`, `SchemaApiSetup`.

### Dev Monitor (`kusto monitor`)

When `NODE_ENV !== production`, `Core.setupMonitor()` registers a request-metrics middleware (before routes) and a **localhost-only** `GET /__kusto/metrics` endpoint (`src/core/lib/devtools/monitor/`). `npx kusto monitor` (alias `top`) is a separate-terminal htop-style TUI (`src/core/cli/monitor/`, zero deps) that polls the endpoint and renders process/requests/DB/routing live, adapting to terminal size. Server and CLI share the `MonitorSnapshot` contract. See `docs/09-dev-monitor.md`.

## Path Aliases

| Alias | Path |
|-------|------|
| `@/*` | root |
| `@app/*` | `src/app` |
| `@core/*` | `src/core` |
| `@lib/*` | `src/core/lib` |
| `@ext/*` | `src/core/external` |
| `@db/*` | `src/app/db` |
| `@tests/*` | `tests` |

**Single source of truth: `tsconfig.json` `compilerOptions.paths`.** Everything else derives from it so they can't drift:
- **jest** (`jest.config.ts`): `moduleNameMapper` is generated via `pathsToModuleNameMapper(tsconfig.paths)`.
- **webpack** (`webpack.config.js`): `resolve.alias` is built from tsconfig paths by `buildAliasesFromTsconfig()`.
- **runtime** (`package.json` `_moduleAliases`, used by `module-alias`): the only hand-maintained copy — kept in lockstep by the guard test `tests/unit/config/alias-consistency.test.ts`. The entrypoints `src/index.ts`, `src/core/scripts/kusto-db-cli.ts`, `src/core/cli/kusto.ts`, and `src/core/updater/{generate,compare,update}.ts` register it via `import 'module-alias/register'`.

**To add an alias:** add it to `tsconfig.json` paths **and** `package.json` `_moduleAliases` (jest/webpack pick it up automatically; the guard test enforces the pair). Use `@lib/...` (not `@core/lib/...`) — `@lib` is the canonical spelling for `src/core/lib`.

**Import the tier path, not the old flat path.** After the tier reorg, core modules live under `@lib/<tier>/<file>` — e.g. `@lib/http/routing/expressRouter`, `@lib/http/validation/requestHandler`, `@lib/data/database/baseRepository`, `@lib/http/errors/errorCodes`. The `@lib` root is unchanged, so no alias config changed; only the path after `@lib/` deepened. Each tier folder's `AGENTS.md` lists the canonical import paths for its files.

## SSOT (Single Source of Truth) Methodology

Core is organized so that each piece of truth — a constant, a type, a mapping, a config/env decision, a rule — is **defined once and referenced everywhere else**. When adding or changing code:

- **One home per truth.** Before hardcoding a literal (HTTP status, JSON:API version, default `id`/`deletedAt`/page-size, a Prisma-code → status mapping, an env-mode check), look for an existing constant/helper and reference it. Add the constant to the tier that owns the concept (error mappings → `@lib/http/errors/errorCodes`, JSON:API constants → `@lib/crud/jsonApiConstants`, env decisions → `@lib/config/environmentLoader`, DB-folder→env naming → `@lib/data/database/dbNaming`).
- **No parallel definitions.** A type and its OpenAPI/doc schema, or a runtime list and its literal-union type, must derive from one declaration — don't maintain two copies that can drift.
- **Folders mirror responsibility.** A file's tier is its single conceptual home; cross-tier reuse happens by importing the owner, never by copying. Respect the one-way dependency direction (see Tier Layout).
- **Generated = derived truth.** `src/core/lib/types/generated-*.ts` derive from `src/app/{db,injectable,repos}` — never hand-edit; change the source and regenerate.

## Key Environment Variables

Configured via `.env` (see `.env.template`), with `.env.dev` / `.env.prod` overrides:
- `NODE_ENV` — development/production
- `HOST`, `PORT` — Server binding
- `CORS_WHITELIST` — JSON array or comma-separated origins
- `AUTO_DOCS` — Enable auto documentation (dev only, serves at `/docs`)
- `ENABLE_SCHEMA_API` — Enable `/api/schema` endpoint
- `STRICT_STATUS_CODE_CHECK` — Validate response status codes
- `{FOLDER}__KUSTO_RDB_URL` — Database connection string per `src/app/db/{folder}/`. Folder name is converted camelCase → UPPER_SNAKE_CASE (e.g. `myData` → `MY_DATA__KUSTO_RDB_URL`). Override by setting `url = env(...)` in the schema directly.

## Error Handling

Use `errorFormatter.ts` for consistent error responses. Environment-aware: detailed in development, sanitized in production. Prisma errors (P2001, P2002, P2025, etc.) are auto-mapped to appropriate HTTP status codes. Error codes defined in `errorCodes.ts` (JSON_API_ERROR_CODES, CRUD_ERROR_CODES, PRISMA_ERROR_CODES).

## Logging

Winston (`@ext/winston`) with custom level methods (PascalCase): `Error`, `Warn`, `Info`, `Debug`, `Silly`, `SQL`, `Route`, `SessionDeclaration`, `Footwalk`, `Email`, `Auth` (plus a lowercase `error` alias used by winston's exception handling). Daily rotating file logs in `logs/`. Dev: human-readable colored line (color only on a TTY — respects `NO_COLOR`/`FORCE_COLOR`); prod: one-line structured JSON. Meta is serialized via a safe serializer that never throws (handles circular refs, `BigInt`, `Error`, `Buffer`, `Map`/`Set`, throwing getters) and **redacts** sensitive keys (`password`/`token`/`authorization`/`apikey`/`cookie`/… and `*_token`/`x-api-key` shapes) to `[REDACTED]`.

**Console level is env-aware** (`LOG_LEVEL` always overrides): `production`→`Info`, `test`→`Error`, otherwise→`Debug`. Because dev defaults to `Debug`, **`Silly` is hidden by default** — run with `LOG_LEVEL=Silly` to see per-item traces. Tunable env vars: `LOG_LEVEL` (or `silent`/`off`), `LOG_DIR`, `LOG_MAX_SIZE`, `LOG_MAX_FILES`, `LOG_FILE_LEVEL`, `LOG_REDACT=false` (disable redaction), `LOG_REDACT_KEYS=a,b` (extra keys). If the log directory can't be created, file logging degrades to console-only instead of crashing.

### Log message conventions (runtime code)

Applies to all `log.*` calls under `src/core/` and `src/app/`:

- **English only.** Write log message strings in English. Keep `${...}` interpolations and the structured-meta object (2nd arg) intact.
- **No emoji in messages.** The logger (`@ext/winston`) auto-prepends a per-level emoji in dev (Error→❌, Warn→⚠️, Info→💡, …); a second emoji inside the message just duplicates it (and leaks into prod JSON). Don't restate the level in text either (no leading `Warning:`/`Error:`).
- **No `console.*` in runtime code.** Use `log.*` (`import { log } from '@ext/winston'`). Map: `console.log/info`→`log.Info`, `warn`→`log.Warn`, `error`→`log.Error`, `debug`→`log.Debug`.
- **Right level / right volume.** Reserve `Info` for concise lifecycle summaries; per-item loop traces and routine intermediate steps belong at `Debug`/`Silly`. Avoid duplicate logs for one event.
- **Exempt:** standalone CLI/build tooling (`src/core/scripts/*`, `src/core/cli/*`, `src/core/updater/*`) may keep `console.*`, emoji, and Korean — it is operator-facing terminal output, not application logging. Do not normalize it. The `LOG_SETTINGS` emoji/color map in `src/core/external/winston.ts` is logger config, not a message — leave it.

## Build & Deployment

Webpack bundles to `dist/server.js`. CopyWebpackPlugin copies `src/app/views/`, `public/`, Prisma clients and schemas to dist. Run with `npm run serve` after build.

`src/core/updater/` contains framework self-update tooling (build release archives, compare versions, apply updates with backup/rollback, SHA-256 file maps, zip-slip-safe extraction). Uses `archiver` and `yauzl`. It is excluded from its own deployment map (no self-overwrite) and is not bundled into `dist` (not reachable from the `src/index.ts` entry). The unified `kusto` CLI (`src/core/cli/kusto.ts`, exposed as the `kusto` bin) wraps it as `kusto update <...>`. See `docs/07-update-system.md` and `src/core/updater/AGENTS.md`.
