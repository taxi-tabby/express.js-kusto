# routing/ - Routing (Route Builder · Auto-Discovery · Middleware · Proxy)

The entry sub-tier of the http tier, providing a fluent route builder, folder-convention-based route auto-discovery, framework middleware wrapping, and a dependency-free reverse proxy.

## Structure

```
routing/
├── expressRouter.ts          # fluent route builder (public API, ExpressRouter class)
├── loadRoutes_V6_Clean.ts    # route.ts/middleware.ts auto-discovery + mounting
├── middlewareHelpers.ts      # 6-arg framework middleware → Express RequestHandler wrapping
└── proxyMiddleware.ts        # http/https-based zero-dep reverse proxy
```

## Files

### expressRouter.ts
The framework's core public routing API. Defines routes via method chaining and returns an Express `Router` from a final `build()` call.

- **Key exports**:
  - `class ExpressRouter` — constructor `new ExpressRouter({ tag?, description? })`. Methods:
    - HTTP verb: `GET` / `POST` / `PUT` / `PATCH` / `DELETE` / `NOTFOUND`
    - `_SLUG` variants: `GET_SLUG` / `POST_SLUG` / `PUT_SLUG` / `PATCH_SLUG` / `DELETE_SLUG` (+ `MIDDLE_PROXY_ROUTE_SLUG` / `STATIC_SLUG`)
    - `_VALIDATED` family: `GET_VALIDATED` / `POST_VALIDATED` / `PUT_VALIDATED` / `PATCH_VALIDATED` / `DELETE_VALIDATED` and each `_SLUG_VALIDATED` (+ `_EXACT`) variant
    - File upload (multer): `POST_SINGLE_FILE` / `POST_ARRAY_FILE` / `POST_FIELD_FILE` / `POST_ANY_FILE` (PUT equivalents)
    - Middleware: `WITH(name, params?)` / `MIDDLEWARE(fn)` / `USE(fn)` / `USE_HANDLER(fn)`
    - Proxy/static: `MIDDLE_PROXY_ROUTE(options)` / `STATIC(path, options?)`
    - CRUD: `CRUD(dbName, modelName, options?)` — generates JSON:API v1.1 endpoints
    - `build(): Router`
    - Extension support: `static registerMethod(name, impl)` — attach a fluent router method at runtime (used by the extension system; collision/idempotency guarded); `static clearExtensionMethods()` (test-only)
  - Types: `HandlerFunction`, `ValidatedHandlerFunction`, `MiddlewareHandlerFunction`, `ValidatedMiddlewareHandlerFunction`, `RouteDocOptions`, `RouterContext` (shared router-context surface — single source of truth, also aliased by CRUD as `CrudBuilderContext`), `RouterMethodImpl`
  - re-export: `middlewareHelpers`'s `MiddlewareHandler` / `ValidatedMiddlewareHandler` / `wrapMiddleware` / `wrapValidatedMiddleware` / `wrapMiddlewares` / `wrapValidatedMiddlewares` / `injectedMiddleware`
- **Dependencies**: `@lib/http/routing/proxyMiddleware` (proxy), `@lib/http/routing/middlewareHelpers` (wrapping/internal delegation), `@lib/http/validation/requestHandler` (`_VALIDATED` engine), `@lib/http/serialization/serializer` (`serialize`/`applyResponseSerializer`/`ResponseSerializer`), `@lib/http/errors/errorCodes` · `errorFormatter` · `errorHandler`, `@lib/crud/*` (CRUD builder/helpers/PK parsers/JSON:API constants), `@lib/data/di/*` · `@lib/data/database/*` (DI/prisma/repo), `@lib/devtools/documentation` · `@lib/devtools/schema-api/*` (dev-only documentation/schema registration), `@lib/types/generated-*` · `@lib/types/express-extensions`, `@ext/winston`, `multer`.

### loadRoutes_V6_Clean.ts
At bootstrap, scans the route directory to discover `route.ts`/`middleware.ts`, converts the folder structure into URL paths, and mounts them onto the Express app. In a webpack build environment it uses the build-time generated route map (`@core/tmp/routes-map`).

- **Key exports**:
  - `default loadRoutes(app: Express, dir?: string): Promise<void>` — entry point for route auto-discovery/mounting
  - `convertFolderToUrlSegment(folder): string` — `[^name]` → `:name([^/]+)`, `[name]` → `:name`, everything else unchanged (regex → dynamic → namedParam precedence, using `ROUTE_PATTERNS`)
  - `clearCache(): void` — clears the middleware/route/file-existence/module-resolution caches
- **Dependencies**: `@ext/winston` (logging), `@ext/util` (`normalizeSlash`/`getElapsedTimeInString`), `@lib/devtools/documentation/documentationGenerator` (dev documentation collection), Node `fs`/`path`. The mounted routes are `Router` instances produced by `expressRouter`.

### middlewareHelpers.ts
The single-source helper that wraps the framework's 6-arg middleware signature (`req,res,next,injected,repo,db`) into standard Express middleware. Forwards async rejections to `next(error)` and guards against double-next.

- **Key exports**:
  - Types `MiddlewareHandlerFunction`, `ValidatedMiddlewareHandlerFunction`
  - `wrapMiddleware(handler)` / `wrapValidatedMiddleware(handler)` — single wrapping (returns `RequestHandler`), sets up `req.kusto` + injects DI modules
  - `wrapMiddlewares(handlers)` / `wrapValidatedMiddlewares(handlers)` — array wrapping
  - `injectedMiddleware(fn)` — `__kustoInjected` branding. Bypasses `WITH()`'s `fn.length >= 6` arity heuristic misclassification (default/rest parameters).
- **Dependencies**: `@lib/data/di/dependencyInjector` (`DependencyInjector`), `@lib/data/di/kustoManager` (`kustoManager`), `@lib/data/database/prismaManager` · `repositoryManager`, `@lib/http/validation/requestHandler` (`ValidatedRequest` type), `@lib/types/generated-injectable-types` (`Injectable`).

### proxyMiddleware.ts
A reverse-proxy middleware factory implemented with only Node `http`/`https` and no external dependencies. Handles hop-by-hop header removal, `X-Forwarded-*` setup (using the actual TCP peer), body re-serialization (content-type symmetry when body-parser has consumed the body), and single-settle handling of timeouts/failures.

- **Key exports**:
  - `interface ProxyOptions` — `target` (required), `changeOrigin?`, `pathRewrite?`, `headers?`, `secure?`, `timeout?`, `onProxyReq?`/`onProxyRes?`/`onError?`
  - `createProxyMiddleware(options): RequestHandler` — an invalid `target` fails fast at bootstrap (throws)
- **Dependencies**: `@ext/winston` (upstream-failure logging), `@lib/http/errors/errorCodes` (`ERROR_CODES`/`getHttpStatusForErrorCode` — 502/504 mapping), Node `http`/`https`/`url`, `qs` (form-body re-serialization).

## Import conventions

- Canonical import path: `@lib/http/routing/<file>` (e.g. `@lib/http/routing/expressRouter`).
- **Outbound (layer direction)**: routing → `@lib/http/validation` → `@lib/http/serialization`, and routing/proxy → `@lib/http/errors`. It also reaches out to `@lib/crud/*`, `@lib/data/*`, and the dev-only `@lib/devtools/*`.
- **Inbound**: `loadRoutes` is consumed by `src/core/Core.ts`, and `ExpressRouter` is consumed by `src/app/routes/**/route.ts`.
