# devtools/ - Dev-Only Developer Tooling Tier

A bundle of framework developer tools that are active only in development mode — composed of two sub-tiers: OpenAPI documentation automation and the CRUD schema introspection API.

> **DEV-ONLY.** This entire tier is protected by runtime gates and does not operate in production.
> - `documentation/` → `AUTO_DOCS=true` **and** `NODE_ENV !== 'production'` (`isDocumentationEnabled()`)
> - `schema-api/` → `ENABLE_SCHEMA_API=true` or `NODE_ENV=development`/`dev` (`CrudSchemaRegistry.isSchemaApiEnabled()`)
>
> When the gate is off, the registration/generation functions return immediately as no-ops, so it is safe for the upstream caller (`Core.ts`) to invoke them unconditionally.

## Structure

```
devtools/
├── documentation/   # OpenAPI 3.1 documentation auto-generation (AUTO_DOCS) — Swagger UI / openapi.json
└── schema-api/      # /api/schema CRUD schema introspection (ENABLE_SCHEMA_API)
```

## Sub-Tiers

| Sub-tier | Role | Gate env var |
|-----------|------|-----------------|
| `documentation/` | Assembles OpenAPI 3.1 documentation from registered routes + Prisma models and serves `/docs` (Swagger UI), `/docs/openapi.json`, and `/docs/dev` | `AUTO_DOCS` |
| `schema-api/` | Provides the `/api/schema/*` router that introspects the Prisma DMMF to register and query CRUD schema information | `ENABLE_SCHEMA_API` |

## Layering

- **Dependency direction between sub-tiers**: `documentation/` → `schema-api/` (one-way).
  `documentation/dmmfToOpenApi`, `jsonApiSchemas`, and `syncSchemas` consume `schema-api/`'s `PrismaSchemaAnalyzer`/`crudSchemaTypes` (`PrismaModelInfo`, `PrismaFieldMetadata`). There is no reverse dependency.
- **Inbound**: Both tiers are invoked by `src/core/Core.ts` during the bootstrap phase (documentation route registration, schema API registration, model synchronization).
- **Common outbound dependencies**: `@ext/winston` (`log`), `@ext/util` (`pluralize`/`singularize`/`createPaginationCursor`), `@lib/http/*` (validator · errorCodes · requestHandler), `@lib/crud/jsonApiConstants`.

## Import

The canonical import path is `@lib/devtools/<sub-tier>/<file>`. Cross-references inside the sub-folders are written the same way, using the single `@lib` root plus the deepened path (no relative paths). For details on each sub-tier, refer to that folder's `AGENTS.md`.
