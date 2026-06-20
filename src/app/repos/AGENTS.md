# repos/ - Repository Pattern (Data Access Layer)

데이터베이스 작업을 캡슐화하는 리포지터리 클래스를 정의하는 폴더.

## File Convention

- **파일명**: `{name}.repository.ts` — `{name}` 부분이 `repo.getRepository('name')`의 키가 됨
- **타입 파일** (선택): `{name}.types.ts`

## Required Structure

```typescript
import { BaseRepository } from '@lib/baseRepository';

export default class UserRepository extends BaseRepository<'default'> {
    protected getDatabaseName(): 'default' {
        return 'default';
    }

    async findByEmail(email: string) {
        return this.client.user.findUnique({ where: { email } });
    }
}
```

## Key Features (BaseRepository 상속)

| 기능 | 설명 |
|------|------|
| `this.client` | `getWrap()` 기반 Prisma 클라이언트 (lazy 자동 재연결) |
| `this.getAsyncClient()` | `client` 와 동일한 인스턴스를 Promise 로 래핑한 변형 (await 컨텍스트용) |
| `this.$transaction()` | 트랜잭션 + 성능 모니터링. `retryAttempts >= 2` 옵션 지정 시 재시도 활성화 (기본 1회 — 재시도 없음) |
| `this.$batchOperation()` | 대량 데이터 배치 처리 |

> NOTE: `this.$createDistributedOperation()` / `this.$runDistributedTransaction()` 는 Prisma 커넥션 풀 한계로 신뢰성이 낮으므로 사용하지 않는다 (CLAUDE.md 참고).

## Usage in Routes

```typescript
async (req, res, injected, repo, db) => {
    const userRepo = repo.getRepository('user'); // UserRepository 인스턴스
    const result = await userRepo.findByEmail('test@example.com');
}
```

## Type Generation

`npm run generate` 실행 시 `src/core/lib/types/generated-repository-types.ts`에 모든 리포지터리의 타입이 자동 생성됨.
