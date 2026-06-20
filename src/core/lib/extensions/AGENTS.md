# extensions/ - Extension System (CoC plugins)

The dependency-free core capability that lets an external npm package add `ExpressRouter`
methods, lifecycle hooks, and build hooks without modifying `src/core`. Extensions are
discovered from the convention folder `src/app/extensions/` and applied during boot.
This tier holds only the contract + a small registry/loader; the framework ships zero
extension dependencies, and an unused extension adds nothing to the project.

## Structure

```
extensions/
├── extensionTypes.ts     # contract types + defineExtension() + isKustoExtension()
├── extensionRegistry.ts  # singleton store; runs onInit/onBuild hooks
└── loadExtensions.ts     # CoC discovery of src/app/extensions/*.ts; applies router methods
```

## Files

### extensionTypes.ts
Defines the extension contract and the context shapes hooks receive.

- **Key exports**:
  - `interface KustoExtension` — `name`, optional `version`, `routerMethods?` (name -> impl), `onInit?`, `onBuild?`.
  - `type RouterMethodImpl`, `interface RouterContext` (re-exported from `@lib/http/routing/expressRouter` — the single source of truth for the router context).
  - `interface ExtensionInitContext` (`app`, `config`, `registerMiddleware`, `log`), `interface ExtensionBuildContext` (`rootDir`, `appDir`, `isProduction`, `log`), `interface ExtensionRuntimeConfig` (a structural subset of `CoreConfig`, declared locally to avoid a back-edge into the bootstrap tier).
  - `function defineExtension(ext)` (identity helper for authoring with full inference), `function isKustoExtension(value)` (runtime shape guard used by the loader).
- **Dependencies**: type-only `express`, `@ext/winston` (for `typeof log`), and `@lib/http/routing/expressRouter` (`RouterContext`/`RouterMethodImpl`). No runtime imports.

### extensionRegistry.ts
Singleton that stores loaded extensions and runs their hooks.

- **Key exports**: `const extensionRegistry` (`register`, `getAll`, `runInit(ctx)`, `runBuild(ctx)`, `clear()` for tests). Hooks run in registration order and re-throw to fail-fast. Router methods are NOT stored here — the loader applies them directly to the `ExpressRouter` prototype.
- **Dependencies**: `@ext/winston`, type-only `@lib/extensions/extensionTypes`.

### loadExtensions.ts
Discovers and applies extensions from the convention folder.

- **Key exports**: `default loadExtensions(dir = './src/app/extensions'): KustoExtension[]` — scans `*.ts`/`*.js` (skips `.d.ts`, `index`, `AGENTS`), requires each file's default export, validates it with `isKustoExtension`, registers its `routerMethods` on `ExpressRouter` immediately (must precede route loading), collects it in the registry, and returns the loaded list. No-op (returns `[]`) when the folder is absent. Files are processed in filename order.
- **Dependencies**: `fs`/`path`, `@ext/winston`, `@lib/http/routing/expressRouter` (`ExpressRouter.registerMethod`), `@lib/extensions/extensionTypes`, `@lib/extensions/extensionRegistry`.

## Import conventions

- Canonical import path: `@lib/extensions/<file>`.
- **Outbound (one-way)**: extensions → `@lib/http/routing` (for `RouterContext`/`ExpressRouter.registerMethod`) and `@ext/winston`. It must NOT depend on the bootstrap tier (hence the local `ExtensionRuntimeConfig`).
- **Inbound**: `src/core/bootstrap/Core.ts` calls `loadExtensions()` before route loading and runs `extensionRegistry.runInit()` after Express setup; the `kusto` CLI (`kusto extensions build`) runs `extensionRegistry.runBuild()`. `src/core/index.ts` re-exports `defineExtension` and the contract types as public API.
