# routes/ - HTTP Routing & Global Middleware

Folder that manages Express route definitions and global middleware.

## Structure

```
routes/
├── middleware.ts   # Global middleware stack (applied to every request)
├── route.ts        # Root path (/) handler
└── api/
    └── v1/
        └── users/
            └── route.ts  # /api/v1/users handler
```

## File Convention

- **`middleware.ts`**: Array of middleware applied to that folder's path. The root (`routes/middleware.ts`) is the global policy stack, and the default is `[...defaultGlobalMiddleware()]` (helmet/CORS/cookie/body/log). **Thin and optional** — when absent, Core applies the default automatically. The essential middleware (`req.kusto`/clientIp/global error) is owned by Core, so it is not placed here.
- **`route.ts`**: HTTP endpoint definitions for that folder's path
- The folder structure is the URL path (`routes/api/v1/users/route.ts` → `/api/v1/users`)

## ExpressRouter API

```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter';
import { RequestHandler } from '@lib/http/validation/requestHandler';

const router = new ExpressRouter();

// Define routes with the fluent API
router
    .GET(
        '/',
        ...RequestHandler.createHandler(
            { request: { query: schema }, response: { 200: responseSchema } },
            async (req, res, injected, repo, db) => {
                // injected: DI services, repo: repository manager, db: Prisma manager
                return { message: 'Hello' };
            }
        )
    )
    .POST('/', ...handler)
    .WITH('authRateLimiterDefault', { maxRequests: 100 })  // middleware name + options
    .CRUD('default', 'User', { softDelete: { enabled: true, field: 'deletedAt' } });

export default router.build();
```

The first argument to `WITH` is the name string of a middleware registered under `injectable/`, and the second argument is the options that middleware accepts. Passing an arrow function directly is not supported.

## Handler Signature

```typescript
async (req: ValidatedRequest, res: Response, injected: Injectable, repo: RepositoryManager, db: PrismaManager) => any
```

Five parameters are injected automatically, and `req.validatedData` holds the validated body/query/params.

## CRUD include policy

`router.CRUD()` converts the client's `?include=author,comments.author` into a Prisma `include` and loads relations in a single query (since Prisma itself does not support lazy loading, there is no structural N+1 risk). However, allowing this without limit poses a DoS / information-exposure risk, so the policy can be enforced through the following 4 options.

```typescript
router.CRUD('default', 'Post', {
    maxIncludeCount: 5,                // upper limit on the number of ?include= items
    maxIncludeDepth: 3,                // upper limit on dot-path depth (a.b.c → 3)
    allowedIncludes: ['author', 'comments.author'],  // whitelist
    defaultIncludes: ['author'],       // server-forced eager-load
});
```

| Option | Behavior | On violation |
|---|---|---|
| `maxIncludeCount` | Validates the number of include items the client sent | 400 `INCLUDE_LIMIT_EXCEEDED` |
| `maxIncludeDepth` | Validates each item's dot depth | 400 `INCLUDE_DEPTH_EXCEEDED` |
| `allowedIncludes` | Whitelist matching — allows an exact match or a prefix of an allowed path. Example: with `['comments.author']`, `comments` is also allowed, while `comments.posts` is rejected | 400 `INCLUDE_NOT_ALLOWED` |
| `defaultIncludes` | Merged with the client request and always loaded. Bypasses policy validation (server-trusted) | — |

Validation/merging applies to the 4 operations `index`, `show`, `create`, and `update`. **`create` / `update` also accept the `?include=` query and populate the response's `included` array.**

Note: if the client sends `?select=` at the same time, Prisma uses a select-first policy, so the eager-load effect of `defaultIncludes` is not guaranteed.
