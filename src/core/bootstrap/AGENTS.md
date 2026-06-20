# bootstrap/ - Application bootstrap / lifecycle orchestration

The framework's boot entry-point layer. Sequentially initializes the managers (Prisma → Repository → DI), registers Express middleware, routes, docs, and the health check, then manages the HTTP server lifecycle (start/stop/restart).

## Structure

```
bootstrap/
├── Core.ts                    # Bootstrap orchestrator singleton (init order + server lifecycle + /healthz)
├── Application.ts             # Thin facade wrapping Core (start/stop/restart, createApplication)
└── expressAppSingleton.ts     # DEPRECATED: legacy express() singleton (slated for removal)
```

## Core.ts

The central boot orchestrator. Holds the Express instance obtained via `expressApp.getApp()` and controls the entire sequence: manager initialization → Express setup → route/docs/health-check registration → server listen.

- **Main exports**
  - `Core` class (singleton; `Core.getInstance()`), `export default Core.getInstance()`.
  - `interface CoreConfig` — `basePath`/`routesPath`/`viewsPath`/`viewEngine`/`port`/`host`/`trustProxy`.
  - `function resolveServerDefaults(): { port; host }` — resolves the fallbacks for `process.env.PORT`/`HOST` ('3000'/'0.0.0.0') as a single source. Called from both `Core.getDefaultConfig()` and `src/index.ts`.
- **Initialization order** (`initialize()`): `initializePrismaManager()` → `initializeRepositoryManager()` → `initializeDependencyInjector()` → `loadExtensions()` (register extension router methods, before routes) → `setupExpress()` → `setupCoreMiddleware()` → `runExtensionInit()` (extension `onInit` hooks, before routes) → `setupMonitor()` → `setupHealthCheck()` → `setupDocumentationRoutes()` → `loadRoutes()` → `setupViews()` → Schema API registration → `globalErrorMiddleware` (mounted last).
- **degraded/readiness (P0-1)**: A DB connection failure is non-fatal (it assumes serverless lazy-reconnect) but is recorded in `_degraded`. A top-level throw during Repository/DI initialization is fail-fast. `getReadiness()` judges healthy/degraded from the connection state of DBs excluding those not generated (`generated=false`), and `setupHealthCheck()` registers `/healthz` before the global routes (200 when healthy / 503 when degraded).
- **Lifecycle**: `start()` (ensures `initialize()` runs before listen if not yet initialized), `stop()` (calls `prismaManager.disconnectAll()` first, then closes the server), `restart()`. getters: `app`/`server`/`config`/`isInitialized`/`isRunning`.
- **Dependencies**:
  - `@core/bootstrap/expressAppSingleton` (Express instance source)
  - `@lib/http/routing/loadRoutes_V6_Clean` (automatic route registration)
  - `@lib/extensions/loadExtensions`, `@lib/extensions/extensionRegistry` (CoC extension discovery + `onInit` hooks)
  - `@lib/data/database/prismaManager`, `@lib/data/database/repositoryManager`, `@lib/data/di/dependencyInjector` (manager initialization)
  - `@lib/devtools/documentation/documentationGenerator`, `@lib/devtools/documentation/staticFileMiddleware`, `@lib/devtools/schema-api/schemaApiSetup` (dev-only — gated by `AUTO_DOCS`/`ENABLE_SCHEMA_API`)
  - `@ext/winston` (log), `@ext/util` (getElapsedTimeInString), `express`, `http`, `path`

## Application.ts

A thin user-facing facade wrapping the `Core` singleton. It hides the manager-initialization details and exposes only an intuitive `start/stop/restart` interface.

- **Main exports**
  - `Application` class — captures `Core.getInstance()` in its constructor and holds a `Partial<CoreConfig>`. `start()` (= `core.start()` after `core.initialize(config)`), `stop()`, `restart()`, `use(...handlers)` (adds arbitrary middleware). getters: `express`/`server`/`configuration`/`isRunning`. `getHealthStatus()` reflects `core.getReadiness()` to return `healthy`/`degraded`/`stopped` + uptime/memory/version/config.
  - `function createApplication(config?): Application` — a factory for simple usage.
- **Dependencies**: `@core/bootstrap/Core` (`Core`, `CoreConfig`), `@ext/winston` (log), `express`/`http` (types). It does not depend directly on any lib layer other than Core — it delegates all behavior to Core.

## expressAppSingleton.ts

**DEPRECATED.** An `express()` singleton wrapper retained for legacy compatibility; slated for removal.

- **Main exports**: the `default` is the `AppSingleton.getInstance()` instance. The `AppSingleton` class creates and holds a single `Express` instance and provides `getApp(): Express`. On creation it emits a deprecation warning via `log.Warn`.
- **Current role**: New code should use `Core`/`Application`, but `Core.ts` still obtains the Express instance through this singleton at boot (the only legitimate inbound usage). No new imports allowed.
- **Dependencies**: `express`, `@ext/winston` (log). A leaf module that does not depend on any other layer.

## Import conventions / layer direction

- The canonical import path follows the `@lib/<tier-path>/<file>` pattern, but this bootstrap layer lives under the `@core` root and so is imported as `@core/bootstrap/<file>` (`@lib` = `src/core/lib`, `@core` = `src/core`).
- **Outbound (what this layer depends on)**: `bootstrap` is the top-level assembly layer and depends downward on `@lib/data/*` (DB/DI managers), `@lib/http/routing/*` (route loader), `@lib/devtools/*` (dev-only docs/schema), and `@ext/*` (winston/util).
- **Inbound (what depends on this layer)**: the process entry point `src/index.ts` consumes `Application`/`Core` and `resolveServerDefaults()`. That is, the dependency direction is one-way — `index.ts → bootstrap → lib/* → ext/*` — and no lib module back-references upward into `bootstrap`.
