# config/ - Environment Variable Loading SSOT

The single entry point (Single Source of Truth) tier that provides consistent environment variable loading and environment detection (production/development) across the entire project.

## Structure

```
config/
├── environmentLoader.ts   # dotenv loader + environment detection + get/getRequired
└── packageInfo.ts         # SSOT for accessing package.json name/version/description
```

## environmentLoader.ts

Loads the `.env` file exactly once relative to `process.cwd()` (`dotenv.config`), and provides helpers for environment variable access and environment detection.

- **Responsibility**: Guarantees idempotent `.env` loading (the static `isLoaded` flag prevents duplicate loads), and every access method calls `load()` first at call time to block missed loads. Acts as the SSOT for reading environment variables.
- **Main exports**: `class EnvironmentLoader` (static members only)
  - `load()` — Loads `.env` once. If the file is missing or loading fails, it only emits `log.Warn` and proceeds.
  - `reload()` — Resets `isLoaded`, then forces a reload.
  - `isProduction()` — `true` if `NODE_ENV` is `production`/`prod` (case-insensitive).
  - `isDevelopment()` — The negation of `isProduction()`.
  - `get(key, defaultValue?)` — Returns `string | undefined` (the default value if absent).
  - `getRequired(key)` — Required environment variable access that throws an `Error` if absent.
  - `getLoadStatus()` — A state snapshot of `{ isLoaded, nodeEnv }`.
- **Dependencies**: `dotenv` (external), `path` (Node), and `log` from `@ext/winston` (warning output). It is a lower (leaf) tier that does not depend on other lib tiers.

## packageInfo.ts

The single source for reading `package.json`'s `name`/`version`/`description`. It consolidates a previous problem where `crudHelpers`/`errorHandler`/`documentationGenerator` each did `require('.../package.json')` and held different fallbacks (`kusto-server` vs `kusto-api`), so the app name could be inconsistent on load failure.

- **Main exports**: `getPackageInfo()` → `{ name, version, description? }` (a single fallback of `kusto-server`/`0.0.0` on load failure, no logging), `getImplementationString()` → `"name v version"` (for JSON:API `meta.implementation`), `interface PackageInfo`.
- **Dependencies**: None (a leaf that only reads the root `package.json` via `require`). Inlined when bundled by webpack; in dev, ts-node resolves the require.

## Import Rules

The standard import paths are `@lib/config/environmentLoader` and `@lib/config/packageInfo` (single `@lib` root, with deepened tier paths).

- **Inbound (callers of this tier)**: Higher-level code that needs bootstrap/configuration (e.g. `@core/*`, the data/DI tiers, middleware, etc.) calls in for environment detection and environment variable access.
- **Outbound (what this tier uses)**: Depends only on `@ext/winston` (logging). By layering direction it sits near the very bottom and does not pull in other lib tiers.
