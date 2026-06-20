# injectable/ - Dependency Injection (Services & Middleware)

Folder for defining service modules and middleware that are auto-injected into route handlers.

## File Types

| Pattern | Purpose |
|------|------|
| `*.module.ts` | Business logic service class |
| `*.middleware.ts` | Express middleware factory function |
| `*.middleware.interface.ts` | Middleware parameter type definition |

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

// Applying middleware
router.WITH(injected => injected.authRateLimiterDefault({ maxRequests: 100 }))
    .GET('/api', handler);
```

## Type Generation

Running `npm run generate` auto-generates the types of all injectable modules into `src/core/lib/types/generated-injectable-types.ts`.
