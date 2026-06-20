# data/ - Persistence Tier

The framework's persistence layer. A higher-level tier that groups multi-DB Prisma client management, repository-based data access, and dependency injection; composed of two sub-tiers.

## Structure

```
data/
├── database/   # Prisma multi-DB management · repository base · distributed transactions · DB naming SSOT
└── di/         # injectable module/middleware loader (DependencyInjector) · req.kusto facade (KustoManager)
```

## Sub-tiers

- **`database/`** — `PrismaManager` (multi-DB singleton, `getWrap` auto-reconnect), `BaseRepository` (abstract repository base), `RepositoryManager` (loads repositories from the generated registry), `TransactionCommitManager` (Saga/compensating transactions), `dbNaming` (single source of truth for folder-name → env-var conversion). See `database/AGENTS.md` for details.
- **`di/`** — `DependencyInjector` (dynamic loading of `*.module.ts`/`*.middleware.ts`), `KustoManager` (provides injected/repo/db proxies via the `req.kusto` facade). See `di/AGENTS.md` for details.

## Layering

- Inbound: the `Core` initialization sequence calls in the order `PrismaManager → RepositoryManager → DependencyInjector`, and route handlers access this tier through `KustoManager` (`req.kusto`). App code under `src/app/repos/*` extends `@lib/data/database/baseRepository`.
- Outbound: depends only on the generated types (`@lib/types/generated-*`) and logging (`@ext/winston`). It does not reach back up to the routing/documentation tiers.

## Import note

The canonical import path has the form `@lib/data/<sub-tier>/<file>` (single `@lib` root, only the path deepens).
Example: `@lib/data/database/prismaManager`, `@lib/data/di/kustoManager`.
