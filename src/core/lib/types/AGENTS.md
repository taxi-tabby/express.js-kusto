# types/ - global type extensions and codegen types

This tier gathers, in one place, the hand-written ambient extensions to the Express request object and the type mappings auto-generated from the `src/app/{db,injectable,repos}` structure.

## Structure

```
types/
├── express-extensions.ts            # hand-written: ambient extension of Express.Request with .with / .kusto
├── generated-db-types.ts            # auto-generated (do-not-edit): DB client types + PrismaManager overload augmentation
├── generated-injectable-types.ts    # auto-generated (do-not-edit): injectable/middleware registry types
└── generated-repository-types.ts    # auto-generated (do-not-edit): repository registry types
```

## express-extensions.ts (hand-written)

Uses `declare global` to extend the `Express.Request` interface, injecting framework-specific properties at the type level.

- **Responsibility**: type-safely expose `req.with` (the parameter map injected by WITH middleware) and `req.kusto` (the central manager) in handlers.
- **Main exports**: none (only secures module scope via `export {}`). As a side effect, it adds the following to `Express.Request`:
  - `with: { [K in MiddlewareParamName]?: MiddlewareParams[K] }` — per-middleware parameters.
  - `kusto: KustoManager` — unified accessor for injectable/repo/db.
- **Dependencies**: `MiddlewareParamName`/`MiddlewareParams` (types) from `@lib/types/generated-injectable-types`, and `KustoManager` (type) from `@lib/data/di/kustoManager`. References the codegen types in the same tier and the data/DI tier as type-only.

## generated-db-types.ts (auto-generated · do not edit)

Maps the Prisma client of each database discovered in the `src/app/db/` folder structure to types, and augments the method overloads of `PrismaManager`.

- **Responsibility**: map DB name → Prisma client instance type, and provide the concrete overloads for `getWrap`/`getClient`.
- **Main exports**: `interface DatabaseClientMap`, `type DatabaseClientType<T>`, `type DatabaseName`, `type DatabaseNamesUnion`, `interface PrismaManagerWrapOverloads`, `interface PrismaManagerClientOverloads`.
- **augment**: via `declare module '../data/database/prismaManager'`, adds per-DB `getWrap`/`getClient` overloads to `PrismaManager` (the relative path points to `@lib/data/database/prismaManager`).
- **Dependencies**: `PrismaClient` from `@app/db/{name}/client` (e.g. `default`). Points toward the app DB clients and the data tier.
- **Regeneration**: `src/core/scripts/generate-*.js` (`npm run generate`). **Do not hand-edit.**

## generated-injectable-types.ts (auto-generated · do not edit)

Scans the module/middleware/middleware-interface files under `src/app/injectable/` to generate the registry and type maps (generates empty interfaces if there are no modules).

- **Responsibility**: provide the type-safety foundation for `injected.*`/`WITH(...)` access.
- **Main exports**: `interface Injectable`, `interface Middleware`, `interface MiddlewareParams`; the runtime registries `MODULE_REGISTRY`/`MIDDLEWARE_REGISTRY`/`MIDDLEWARE_PARAM_MAPPING`; the types `ModuleName`/`MiddlewareName`/`MiddlewareParamName` and the helpers `GetModuleType`/`GetMiddlewareType`/`GetMiddlewareParamType`.
- **Dependencies**: `@app/injectable/*` (generation source). No external imports (when the app is empty, pure types/constants only).
- **Regeneration**: `src/core/scripts/generate-*.js` (`npm run generate`). **Do not hand-edit.**

## generated-repository-types.ts (auto-generated · do not edit)

Scans `*.repository.ts` under `src/app/repos/` to generate the return type of `repo.getRepository(name)` and a dynamic-loading registry.

- **Responsibility**: provide the repository name → instance type mapping and a lazy import registry.
- **Main exports**: `interface RepositoryTypeMap`, `const REPOSITORY_REGISTRY`, `type RepositoryName`, `type GetRepositoryType<T>`.
- **Dependencies**: default-imports `@app/repos/*.repository` (e.g. `example.repository`). Points toward the app repository tier.
- **Regeneration**: `src/core/scripts/generate-*.js` (`npm run generate`). **Do not hand-edit.**

## Import rules

The standard import path is `@lib/types/<file>` (single `@lib` root, deepened tier path). E.g. `@lib/types/express-extensions`, `@lib/types/generated-db-types`.

- **Inbound (who uses this tier)**: router/handler types (`req.with`, `req.kusto`, `injected.*`, `repo.*`, `db.*`) and `PrismaManager` consume the codegen types/overloads.
- **Outbound (what this tier uses)**: the codegen files point toward `@app/{db,injectable,repos}` (the app workspace), and `express-extensions.ts` references `@lib/data/di/kustoManager` and the same-tier `generated-injectable-types` as type-only. `generated-db-types.ts` augments the `@lib/data/database/prismaManager` module.
- **Note**: the three `generated-*` files are codegen output, so editing them directly will be overwritten on the next `npm run generate`. If a change is needed, modify the source (`src/app/...`) or the generator (`src/core/scripts/generate-*.js`).
