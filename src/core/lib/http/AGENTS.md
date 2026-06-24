# http/ - Request-Handling Tier

The core tier responsible for routing, validation, serialization, and error responses of HTTP requests. On top of Express, it layers the framework's fluent routing API, the `_VALIDATED` validation engine, safe serialization, and JSON:API/CRUD error formatting.

## Structure

```
http/
├── routing/           # route builder + convention-based auto-discovery + middleware/proxy
│   ├── expressRouter.ts          # fluent route builder (public API)
│   ├── loadRoutes_V6_Clean.ts    # auto-mounts routes via folder→URL convention
│   ├── middlewareHelpers.ts      # wraps 6-arg framework middleware → Express
│   └── proxyMiddleware.ts        # zero-dep reverse proxy
├── validation/        # request/response schema validation
│   ├── requestHandler.ts         # *_VALIDATED engine (RequestConfig/ResponseConfig)
│   └── validator.ts              # field schema validator (type/length/pattern/enum/custom)
├── serialization/     # response serialization
│   ├── serializer.ts             # safe BigInt/Date/Prisma-Date serialization + pick/omit
│   └── serializationMiddleware.ts # res.json override middleware
└── errors/            # error codes + formatting
    ├── errorCodes.ts             # error-code SSOT + status mapping
    ├── errorFormatter.ts         # Prisma error → {code, status}
    └── errorHandler.ts           # normalization + sanitization + CRUD/JSON:API formatting
```

## Sub-Tier Roles

- **routing/** — The entry point for route definitions (`ExpressRouter`) and on-disk auto-discovery (`loadRoutes`). It consumes all three lower sub-tiers (validation/serialization/errors) to assemble verb/`_VALIDATED`/`_SLUG`/`_FILE`/`CRUD`/`STATIC`/`MIDDLE_PROXY_ROUTE`.
- **validation/** — The request-validation middleware and response-schema filtering engine for the `_VALIDATED` family of methods. It calls serialization's `applyResponseSerializer`.
- **serialization/** — Safely converts non-serializable types (BigInt/Date/Prisma `@db.Date`) and applies the router response serializer (`pick`/`omit`/functional).
- **errors/** — The single source of truth (SSOT) for error-code constants and HTTP status mapping; normalizes and sanitizes Prisma/generic errors into JSON:API · CRUD response shapes.

## Import Conventions

- The canonical import path drills deep into a single `@lib` root: `@lib/http/<sub-tier>/<file>`.
  - e.g.: `@lib/http/routing/expressRouter`, `@lib/http/validation/requestHandler`, `@lib/http/serialization/serializer`, `@lib/http/errors/errorCodes`.
- **Layer direction (outbound)**: routing → validation → serialization, and routing/proxy/errors → errors (`errorCodes`/`errorHandler`/`errorFormatter`). Only a one-way validation → serialization dependency exists.
- **External tier dependencies**: routing depends on `@lib/data/*` (DI/prismaManager/repositoryManager), `@lib/crud/*`, `@lib/devtools/*` (documentation/schema API, dev-only), `@lib/types/generated-*`, and `@ext/winston`.
- **Inbound**: `src/core/Core.ts` (bootstrap) consumes `loadRoutes`, and `src/app/routes/**/route.ts` consumes `ExpressRouter`. The devtools tier (`/docs`, `/api/schema`) is gated by `AUTO_DOCS`/`ENABLE_SCHEMA_API`.
