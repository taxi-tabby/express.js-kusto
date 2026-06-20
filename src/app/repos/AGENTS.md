# repos/ - Repository Pattern (Data Access Layer)

Folder for defining repository classes that encapsulate database operations.

## File Convention

- **File name**: `{name}.repository.ts` — the `{name}` part becomes the key for `repo.getRepository('name')`
- **Type file** (optional): `{name}.types.ts`

## Required Structure

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

## Key Features (inherited from BaseRepository)

| Feature | Description |
|------|------|
| `this.client` | `getWrap()`-based Prisma client (lazy auto-reconnection) |
| `this.getAsyncClient()` | Variant that wraps the same instance as `client` in a Promise (for await contexts) |
| `this.$transaction()` | Transaction + performance monitoring. Setting the `retryAttempts >= 2` option enables retries (default 1 — no retry) |
| `this.$batchOperation()` | Batch processing for large data sets |

> NOTE: `this.$createDistributedOperation()` / `this.$runDistributedTransaction()` are unreliable due to Prisma connection pool limitations and must not be used (see CLAUDE.md).

## Usage in Routes

```typescript
async (req, res, injected, repo, db) => {
    const userRepo = repo.getRepository('user'); // UserRepository instance
    const result = await userRepo.findByEmail('test@example.com');
}
```

## Type Generation

Running `npm run generate` auto-generates the types of all repositories into `src/core/lib/types/generated-repository-types.ts`.
