# data/di/ - Dependency Injection & Resource Facade

The tier that dynamically loads injectable modules/middlewares and provides unified access to modules, repositories, and DB clients through the `req.kusto` facade used by route handlers.

## Structure

```
di/
├── dependencyInjector.ts   # dynamic load of *.module.ts / *.middleware.ts (pathToCamelCaseIdentifier)
└── kustoManager.ts         # req.kusto facade (injected / repo / db proxy)
```

## Files

### `dependencyInjector.ts`
- **Responsibility**: Iterates the generated `MODULE_REGISTRY`/`MIDDLEWARE_REGISTRY` to dynamically import `*.module.ts` (service class → instantiated) and `*.middleware.ts` (factory function → executed to produce the middleware object). Resolves various export patterns (default/named/constructor) and converts file paths into camelCase identifiers (e.g. `auth/jwt/export.module.ts` → `authJwtExport`). Singleton.
- **Main exports**: `function pathToCamelCaseIdentifier(filePath)`, `class DependencyInjector` (`getInstance`, `initialize`, `getInjectedModules`, `getInjectedMiddlewares`, `getModule`, `getMiddleware`, `registerModule`, `registerMiddleware`, `clear`).
- **Depends on**: `@lib/types/generated-injectable-types` (`Injectable`/`Middleware`/`MODULE_REGISTRY`/`MIDDLEWARE_REGISTRY`/`ModuleName`/`MiddlewareName`), `@ext/winston`.

### `kustoManager.ts`
- **Responsibility**: The framework's central facade (`req.kusto`). Exposes injected modules via the `injectable` getter, repositories via the `repo` Proxy, and DB clients via the `db` Proxy; the Proxy internals always verify the live state (`repositoryManager.hasRepository`/`prismaManager.isConnected`). The `db` proxy provides dynamic DB-name access (`kusto.db.user`) along with `getClient`/`getClientSync`/`getWrap`/`status`/`healthCheck`. Singleton.
- **Main exports**: `class KustoManager` (`getInstance`, getters `injectable`/`repo`/`db`, `getModule`, `getRepository`, `getDbClient`, `getDbClientSync`), `const kustoManager` (singleton), `interface KustoDbProxy`.
- **Depends on**: `@lib/data/di/dependencyInjector` (module access), `@lib/data/database/repositoryManager` (repository proxy), `@lib/data/database/prismaManager` (DB proxy), `@lib/types/generated-injectable-types`·`generated-repository-types`·`generated-db-types`.

## Import note

The canonical import path is of the form `@lib/data/di/<file>` (single `@lib` root, only the path deepens).
e.g. `@lib/data/di/dependencyInjector`, `@lib/data/di/kustoManager`.

- Inbound: `Core` initialization calls `DependencyInjector.initialize()`, and the Core-owned essential middleware `kustoInitMiddleware` (`@lib/http/routing/frameworkMiddleware`) injects `req.kusto = kustoManager` (singleton) into every request. Route handlers access modules/repositories/DB through `req.kusto`.
- Outbound: Depends on the `database/` sub-tier of the same data tier (`prismaManager`/`repositoryManager`), the generated types (`@lib/types/generated-*`), and logging (`@ext/winston`). It does not reference back into the higher routing/documentation tiers.
