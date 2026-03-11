# repos/ - Repository Pattern (Data Access Layer)

데이터베이스 작업을 캡슐화하는 리포지터리 클래스를 정의하는 폴더.

## File Convention

- **파일명**: `{name}.repository.ts` — `{name}` 부분이 `repo.getRepository('name')`의 키가 됨
- **타입 파일** (선택): `{name}.types.ts`

## Required Structure

```typescript
import { BaseRepository } from '@core/lib/baseRepository';

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
| `this.client` | `getWrap()` 기반 Prisma 클라이언트 (서버리스 자동 재연결) |
| `this.getAsyncClient()` | 비동기 버전 (동일한 재연결 로직) |
| `this.$transaction()` | 자동 재시도, 성능 모니터링 포함 트랜잭션 |
| `this.$batchOperation()` | 대량 데이터 배치 처리 |
| `this.$createDistributedOperation()` | 분산 트랜잭션 작업 생성 헬퍼 |

## Usage in Routes

```typescript
async (req, res, injected, repo, db) => {
    const userRepo = repo.getRepository('user'); // UserRepository 인스턴스
    const result = await userRepo.findByEmail('test@example.com');
}
```

## Type Generation

`npm run generate` 실행 시 `src/core/lib/types/generated-repository-types.ts`에 모든 리포지터리의 타입이 자동 생성됨.
