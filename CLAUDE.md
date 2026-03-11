# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Express.js-Kusto (v0.1.45) is a TypeScript framework for building REST APIs using Convention over Configuration. It wraps Express.js with a fluent routing API, multi-database Prisma management, dependency injection, and JSON:API v1.1 compliant CRUD generation.

**Language**: Korean is used in commit messages and some documentation. Follow this convention.

## Commands

```bash
# Development
npm run dev              # Start dev server (runs generate + nodemon)
npm run start            # Start with ts-node directly
npm run serve            # Run production build

# Build
npm run build            # Production build (generate → webpack → clean)
npm run build:dev        # Development webpack build

# Type generation (auto-runs in dev mode via nodemon)
npm run generate         # Generate types for injectable/repository/db

# Database (kusto-db CLI)
npm run db -- generate --all              # Generate all Prisma clients
npm run db -- migrate -t dev -n "name" -d dbname  # Run migration
npm run db -- studio -d dbname            # Open Prisma Studio
npm run db -- seed -d dbname              # Seed data
npm run db -- validate -d dbname          # Validate schema
npm run db -- debug                       # System info

# Framework updates
npm run updater:check    # Check for new versions
npm run updater:update   # Auto-update framework
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
4. Express middleware setup
5. Route auto-discovery (from `src/app/routes/`)

All managers are singletons.

### Routing System (Convention-Based)

Folder structure under `src/app/routes/` maps directly to URL paths:
- `routes/users/[userId]/posts/route.ts` → `/users/:userId/posts`
- `[paramName]` → `:paramName`, `[^paramName]` → regex param, `..[^paramName]` → wildcard

**Only `route.ts` and `middleware.ts` files are auto-discovered.** Other `.ts` files in route folders are ignored by the loader.

Route files must `export default router.build()` using `ExpressRouter`.

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
- Validated variants: `GET_VALIDATED`, `POST_VALIDATED`, etc. — require all defined status codes to be handled
- File uploads: `POST_SINGLE_FILE`, `POST_ARRAY_FILE`, `POST_FIELD_FILE`
- Middleware: `WITH(name, params?)`, `MIDDLEWARE(fn)`, `USE(fn)`
- CRUD: `CRUD(dbName, modelName, options?)` — generates full JSON:API v1.1 REST endpoints

### Multi-Database Layer

Each subfolder in `src/app/db/` represents an independent database:
- `src/app/db/user/schema.prisma` → requires `RDS_USER_URL` env var
- Prisma clients generated into `src/app/db/{name}/client/`
- Naming convention: folder name `foo` → env var `RDS_FOO_URL`

Schema must include `output = "client"` in the generator block.

PrismaManager handles serverless-optimized connections with auto-reconnection (detects Lambda/Vercel/GCP environments).

### Dependency Injection (`src/app/injectable/`)

Three file types, distinguished by suffix:
- `*.module.ts` — Service classes, accessed via `injected.camelCaseName` in handlers
- `*.middleware.ts` — Express middleware factories, used via `router.WITH('name')`
- `*.middleware.interface.ts` — TypeScript interfaces for middleware parameters

File paths are auto-converted to camelCase identifiers (e.g., `auth/jwt/export.module.ts` → `injected.authJwtExport`).

### Repository Pattern (`src/app/repos/`)

```typescript
export default class FooRepository extends BaseRepository<'dbname'> {
    protected getDatabaseName(): 'dbname' { return 'dbname'; }
}
```

Key inherited features: `this.client` (typed Prisma client), `this.$transaction()`, `this.$batchOperation()`, `this.executeWithAutoReconnect()`.

Avoid `$runDistributedTransaction()` — unreliable due to Prisma connection pool limitations.

### CRUD Router (JSON:API v1.1)

`router.CRUD('dbName', 'modelName', options)` auto-generates:
- `GET /` — index with filtering (`?filter[field_op]=value`), sorting (`?sort=-field`), pagination (`?page[number]=1&page[size]=10`), includes (`?include=relation`), field selection (`?select=field1,field2`)
- `GET /:id`, `POST /`, `PUT|PATCH /:id`, `DELETE /:id`, `POST /:id/recover`

Options: `primaryKey`, `primaryKeyParser`, `only`/`except`, per-operation `middleware` and `validation`.

## Path Aliases

| Alias | Path |
|-------|------|
| `@/*` | root |
| `@app/*` | `src/app` |
| `@core/*` | `src/core` |
| `@lib/*` | `src/core/lib` |
| `@ext/*` | `src/core/external` |
| `@db/*` | `src/app/db` |

## Key Environment Variables

Configured via `.env` (see `.env.template`):
- `NODE_ENV` — development/production
- `HOST`, `PORT` — Server binding
- `CORS_WHITELIST` — JSON array or comma-separated origins
- `AUTO_DOCS` — Enable auto documentation (dev only, serves at `/docs`)
- `ENABLE_SCHEMA_API` — Enable `/api/schema` endpoint
- `RDS_{NAME}_URL` — Database connection strings per DB folder

## Error Handling

Use `errorFormatter.ts` for consistent error responses. Environment-aware: detailed in development, sanitized in production. Prisma errors (P2001, P2002, P2025, etc.) are auto-mapped to appropriate HTTP status codes.

## Logging

Winston with custom levels: error, warn, info, debug, silly, route, sql, footwalk, auth, email. Daily rotating file logs in `logs/`. Console output with colors in development.
