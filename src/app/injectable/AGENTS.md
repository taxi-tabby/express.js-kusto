# injectable/ - Dependency Injection (Services & Middleware)

Folder for defining service modules and middleware that are auto-injected into route handlers.

## File Types

| Pattern | `export` | Loader behavior |
|------|------|------|
| `*.module.ts` | `export default class` | `new ModuleClass()` at boot (no args, singleton) |
| `*.middleware.ts` | `export default () => instance` | factory invoked **once, no args**; the **return value** is stored |
| `*.middleware.interface.ts` | **named `export interface`** (NOT `export default`) | type-only — never loaded at runtime, read only by codegen |

`instance` from a middleware factory is an Express middleware function, an array of them, or an object whose values are middleware functions — do **not** double-curry (`() => () => …`). Params are not passed to the factory: `WITH(name, params)` injects them per-request at `req.with.<interfaceIdentifier>`. A module constructor is called with no args, so keep required dependencies out of the constructor (wire lazily, or via `req.kusto.injectable.*`). The interface file must live in the **same directory** as the `*.middleware.ts` it types. 6-arg injected handlers used as middleware should be branded with `injectedMiddleware(fn)` (`@lib/http/routing/middlewareHelpers`); otherwise dispatch falls back to the `fn.length >= 6` heuristic.

## Naming Convention

The file path is converted to camelCase and injected into the handler's `injected` parameter:

```
injectable/
├── auth/
│   ├── jwt/
│   │   └── export.module.ts      → injected.authJwtExport
│   └── rateLimiter/
│       ├── default.middleware.ts  → injected.authRateLimiterDefault (middleware)
│       └── option.middleware.interface.ts  (type definition only)
```

## Usage in Routes

```typescript
router.GET(
    '/protected',
    ...RequestHandler.createHandler({ ... },
        async (req, res, injected, repo, db) => {
            // injected.authJwtExport.verify(token)
        }
    )
);

// Applying middleware — WITH takes the camelCase NAME (string) + a params object.
// (params are typed by the sibling *.middleware.interface.ts and surface at req.with.<name>)
router.WITH('authRateLimiterDefault', { maxRequests: 100, windowMs: 60_000 })
    .GET('/api', handler);
```

## Type Generation

Running `npm run generate` auto-generates the types of all injectable modules into `src/core/lib/types/generated-injectable-types.ts`.
