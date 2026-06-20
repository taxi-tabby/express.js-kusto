# TypeScript Route Files
**/app/routes/**/route.ts

When creating or modifying route files:
- Use ExpressRouter with fluent API and method chaining
- Import: `import { ExpressRouter } from '@lib/http/routing/expressRouter'`
- Always export with: `export default router.build()`
- Use 5-parameter handler: `async (req, res, injected, repo, db) => {}`
- For validation, use _VALIDATED methods with complete schema definitions
- Implement ALL defined status codes in response schema
- Apply middleware with WITH method: `.WITH('authJwtRequired')`
- Access resources via injected, repo, db parameters (preferred over req.kusto)

Example:
```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter';

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
  - 제네릭 인자는 `src/app/db/` 의 폴더명 (예: `'default'`). 모델명이 아니다.
- Implement getDatabaseName() method returning exact database name
- Use this.client for type-safe Prisma access (lazy 자동 재연결 포함)
- Use this.$transaction() for complex operations (재시도는 `retryAttempts >= 2` 옵션 시에만 활성화)
- Single database per repository (one-to-one or one-to-many relationship)
- 분산 트랜잭션 (`$createDistributedOperation`/`$runDistributedTransaction`) 은 Prisma 커넥션 풀 한계로 신뢰성이 낮으므로 사용하지 말 것

Example:
```typescript
import { BaseRepository } from '@lib/data/database/baseRepository';

export default class UserRepository extends BaseRepository<'default'> {
    protected getDatabaseName(): 'default' {
        return 'default';
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
- Environment variable pattern: `{FOLDER_NAME_UPPER_SNAKE}__KUSTO_RDB_URL`
  - 폴더명을 camelCase → UPPER_SNAKE_CASE 로 변환 후 `__KUSTO_RDB_URL` 접미사
  - 예: `default` → `DEFAULT__KUSTO_RDB_URL`, `myData` → `MY_DATA__KUSTO_RDB_URL`
  - `schema.prisma` 의 `url` 을 생략하면 위 패턴이 자동 적용된다 (PrismaManager.resolveDatabaseUrl)
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
  url      = env("DEFAULT__KUSTO_RDB_URL")
}
```

# CRUD Router Implementation
**/app/routes/**/route.ts

When using CRUD router:
- Use router.CRUD(databaseName, modelName, options)
  - `databaseName` 은 `src/app/db/` 의 폴더명, `modelName` 은 Prisma 모델 이름 (PascalCase)
- Specify primaryKey and primaryKeyParser for non-default keys
- Use 'only' or 'except' to control generated endpoints
- Apply middleware per operation: middleware: { index: [...], create: [...] }
- Add validation schemas for create/update operations
- Implement hooks for before/after operations
- Include 정책으로 DoS / 정보 노출 방지 (선택):
  - `maxIncludeCount` — `?include=` 토큰 최대 개수
  - `maxIncludeDepth` — 단일 항목 점 깊이 (`a.b.c` → 3) 제한
  - `allowedIncludes` — 화이트리스트 (정확 일치 또는 prefix 허용)
  - `defaultIncludes` — 서버 강제 eager-load (정책 검증 우회)

Example:
```typescript
router.CRUD('default', 'User', {
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
    },
    maxIncludeCount: 5,
    maxIncludeDepth: 3,
    allowedIncludes: ['profile', 'roles']
});
```

# Environment Configuration
**/.env*

When setting up environment variables:
- Database URLs: `{FOLDER}__KUSTO_RDB_URL` pattern (camelCase → UPPER_SNAKE_CASE 로 변환된 폴더명 + `__KUSTO_RDB_URL` 접미사)
- 예: 폴더 `default` → `DEFAULT__KUSTO_RDB_URL`, 폴더 `myData` → `MY_DATA__KUSTO_RDB_URL`
- JWT secrets: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
- Use appropriate names for each database connection
- Follow the naming convention strictly for auto-detection

# CLI Usage Patterns
**kusto-db commands

When using kusto-db CLI:
- Always specify database with -d flag: `kusto-db generate -d default`
- Use meaningful migration names: `kusto-db migrate -t dev -n "add_user_profile" -d default`
- Generate all clients after schema changes: `kusto-db generate -a`
- Use studio for database inspection: `kusto-db studio -d default`
- `-d` 의 인자는 `src/app/db/` 의 폴더명이며, 코드베이스에 실제 존재하는 폴더여야 한다.

# Test Files
**/test-*.ts

When working with test files:
- Use the advanced test engine patterns
- Include both success and failure scenarios
- Test security validations
- Use proper HTTP method handling
- Test CRUD endpoints with various query parameters
- Validate JSON:API v1.1 compliance in responses
