# TypeScript Route Files
**/app/routes/**/route.ts

When creating or modifying route files:
- Use ExpressRouter with fluent API and method chaining
- Import: `import { ExpressRouter } from '@lib/expressRouter'`
- Always export with: `export default router.build()`
- Use 5-parameter handler: `async (req, res, injected, repo, db) => {}`
- For validation, use _VALIDATED methods with complete schema definitions
- Implement ALL defined status codes in response schema
- Apply middleware with WITH method: `.WITH('authJwtRequired')`
- Access resources via injected, repo, db parameters (preferred over req.kusto)

Example:
```typescript
import { ExpressRouter } from '@lib/expressRouter';

const router = new ExpressRouter();

router
    .WITH('authRateLimiterDefault', { maxRequests: 5 })
    .POST_VALIDATED(requestSchema, responseSchema, handler);

export default router.build();
```

# Dynamic Route Folders
**/app/routes/**/[param]/

When creating dynamic route folders:
- Use [paramName] for simple parameters: `/users/[userId]/route.ts`
- Use [^paramName] for regex constraints: `/api/[^version]/route.ts`
- Use ..[^paramName] for wildcard paths: `/files/..[^path]/route.ts`
- Folder structure directly maps to URL structure
- Access parameters via req.params in handlers

# Injectable Modules
**/app/injectable/**/*.module.ts

When creating injectable modules:
- Extend service classes for business logic
- Export default class with proper methods
- Access in handlers via: `injected.moduleName`
- File naming converts to camelCase: `auth/jwt/export.module.ts` → `authJwtExport`

Example:
```typescript
export default class AuthService {
    public generateToken(payload: any): string {
        // Implementation
    }
}
```

# Injectable Middleware
**/app/injectable/**/*.middleware.ts

When creating middleware:
- Export factory function returning middleware array or object
- Use req.kusto for resource access within middleware
- Support parameter injection via req.with
- File naming: `auth/rateLimiter/default.middleware.ts` → `authRateLimiterDefault`

Example:
```typescript
export default () => {
    return (req: Request, res: Response, next: NextFunction) => {
        const params = req.with.authRateLimiterOption;
        // Middleware logic
        next();
    };
};
```

# Injectable Middleware Interfaces
**/app/injectable/**/*.middleware.interface.ts

When creating middleware parameter interfaces:
- Define TypeScript interfaces for WITH method parameters
- Use descriptive property names with JSDoc comments
- Include validation rules and default values

Example:
```typescript
export interface RateLimiterParams {
    /** Maximum requests allowed */
    maxRequests: number;
    /** Time window in milliseconds */
    windowMs: number;
    /** Repository name for user tracking */
    repositoryName: string;
}
```

# Repository Files
**/app/repos/**/*.repository.ts

When creating repositories:
- Extend BaseRepository with database generic: `BaseRepository<'databaseName'>`
- Implement getDatabaseName() method returning exact database name
- Use this.client for type-safe Prisma access
- Use this.$transaction() for complex operations
- Single database per repository (one-to-one or one-to-many relationship)

Example:
```typescript
import { BaseRepository } from '@lib/baseRepository';

export default class UserRepository extends BaseRepository<'user'> {
    protected getDatabaseName(): 'user' {
        return 'user';
    }

    async findByEmail(email: string) {
        return this.client.user.findUnique({ where: { email } });
    }
}
```

# Repository Types
**/app/repos/**/*.types.ts

When creating repository types:
- Define input/output interfaces for repository methods
- Use clear naming: CreateData, UpdateData, FilterOptions
- Include proper TypeScript types matching Prisma models

# Database Schema Files  
**/app/db/*/schema.prisma

When modifying Prisma schemas:
- Use exact required structure with generator and datasource
- Set output = "client" for generator
- Environment variable pattern: RDS_{DATABASE_NAME}_URL
- Each folder represents one independent database
- Only define models, relations in schema (no business logic)

Required structure:
```prisma
generator client {
  provider = "prisma-client-js"
  output   = "client"
}

datasource db {
  provider = "postgresql"
  url      = env("RDS_USER_URL")
}
```

# CRUD Router Implementation
**/app/routes/**/route.ts

When using CRUD router:
- Use router.CRUD(databaseName, modelName, options)
- Specify primaryKey and primaryKeyParser for non-default keys
- Use 'only' or 'except' to control generated endpoints
- Apply middleware per operation: middleware: { index: [...], create: [...] }
- Add validation schemas for create/update operations
- Implement hooks for before/after operations

Example:
```typescript
router.CRUD('user', 'user', {
    primaryKey: 'uuid',
    primaryKeyParser: ExpressRouter.parseUuid,
    only: ['index', 'show', 'create'],
    middleware: {
        create: [authMiddleware, validationMiddleware]
    },
    validation: {
        create: {
            body: {
                email: { required: true, type: 'email' },
                name: { required: true, type: 'string' }
            }
        }
    }
});
```

# Environment Configuration
**/.env*

When setting up environment variables:
- Database URLs: RDS_{DATABASE_NAME}_URL pattern
- JWT secrets: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
- Use appropriate names for each database connection
- Follow the naming convention strictly for auto-detection

# CLI Usage Patterns
**kusto-db commands

When using kusto-db CLI:
- Always specify database with -d flag: `kusto-db generate -d user`
- Use meaningful migration names: `kusto-db migrate -t dev -n "add_user_profile"`
- Generate all clients after schema changes: `kusto-db generate -a`
- Use studio for database inspection: `kusto-db studio -d user`

# Test Files
**/test-*.ts

When working with test files:
- Use the advanced test engine patterns
- Include both success and failure scenarios
- Test security validations
- Use proper HTTP method handling
- Test CRUD endpoints with various query parameters
- Validate JSON:API v1.1 compliance in responses
