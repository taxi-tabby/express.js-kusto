# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Express.js-Kusto is a TypeScript framework for building REST APIs using Convention over Configuration. It wraps Express.js with a fluent routing API, multi-database Prisma management, dependency injection, and JSON:API v1.1 compliant CRUD generation. (Current version: see `package.json`.)

**Language**: Korean is used in commit messages and some documentation. Follow this convention.

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

# Database (kusto-db CLI, via ts-node)
npm run db -- generate --all              # Generate all Prisma clients
npm run db -- migrate -t dev -n "name" -d dbname  # Run migration
npm run db -- studio -d dbname            # Open Prisma Studio
npm run db -- seed -d dbname              # Seed data
npm run db -- validate -d dbname          # Validate schema
npm run db -- debug                       # System info

# Framework self-update (updater/ folder, uses archiver/yauzl)
npm run updater:check    # Check for new versions
npm run updater:update   # Auto-update framework core
```

No test runner is configured in this project.

## Architecture

### Two-Zone Design

- **`src/core/`** — Framework internals. **Do not modify** unless updating the framework itself.
- **`src/app/`** — Developer workspace where all application code lives.

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

### Global Middleware (`src/app/routes/middleware.ts`)

Exports an array of Express middleware applied to all routes, in order:
1. KustoManager initialization (`req.kusto`)
2. Client IP extraction (`clientIpMiddleware`) — populates `req.ip`/`req.ips` honoring proxy headers
3. Helmet security headers
4. CORS (dynamic whitelist from `CORS_WHITELIST` env)
5. Cookie parser
6. Body parser (JSON + URL-encoded, 50mb limit, supports `application/vnd.api+json`)
7. Footwalk request logging (winston `Footwalk` level)
8. Error handler (catches downstream errors, returns 500 JSON)

### Handler Signature

All route handlers receive 5 parameters:
```typescript
async (req, res, injected, repo, db) => { ... }
```
- `req.kusto` — Unified resource access (modules, repos, DB clients)
- `req.validatedData` — Available only in `_VALIDATED` methods
- `req.with` — Middleware-injected parameters

### ExpressRouter Fluent API (`src/core/lib/expressRouter.ts`)

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
import { BaseRepository } from '@lib/baseRepository';

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

## Path Aliases

| Alias | Path |
|-------|------|
| `@/*` | root |
| `@app/*` | `src/app` |
| `@core/*` | `src/core` |
| `@lib/*` | `src/core/lib` |
| `@ext/*` | `src/core/external` |
| `@db/*` | `src/app/db` |

Defined in both `tsconfig.json` (for TS) and `package.json` `_moduleAliases` (for runtime via `module-alias`), and mirrored in `webpack.config.js`.

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

Winston with custom levels: error, warn, info, debug, silly, route, sql, footwalk, auth, email. Daily rotating file logs in `logs/`. Console output with colors in development, JSON structured logs in production.

## Build & Deployment

Webpack bundles to `dist/server.js`. CopyWebpackPlugin copies `src/app/views/`, `public/`, Prisma clients and schemas to dist. Run with `npm run serve` after build.

`updater/` folder contains framework self-update tooling (generate release archives, compare versions, apply updates). Uses `archiver` and `yauzl` packages.
