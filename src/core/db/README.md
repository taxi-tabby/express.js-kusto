# Prisma 다중 클라이언트 관리 시스템

이 프로젝트는 Prisma를 사용하여 다중 데이터베이스 클라이언트를 효율적으로 관리할 수 있는 고수준 인터페이스를 제공합니다.

## 📁 프로젝트 구조

```
src/
├── core/
│   └── db/
│       ├── index.ts          # 다중 클라이언트 관리 인터페이스
│       ├── service.ts        # 고수준 데이터베이스 서비스
│       ├── migration.ts      # 마이그레이션 관리
│       ├── seed.ts          # 시드 데이터
│       └── generated/       # Prisma Client 생성 위치
└── app/
    └── db/
        ├── migrations/      # 커스텀 마이그레이션 파일
        └── examples.ts      # 사용 예제
```

## 🚀 빠른 시작

### 1. 초기 설정

```bash
# 완전한 데이터베이스 설정 (마이그레이션 + 클라이언트 생성 + 시드)
npm run db:setup
```

### 2. 개별 명령어

```bash
# Prisma Client 생성
npm run db:generate

# 마이그레이션 실행
npm run db:migrate

# 데이터베이스 시드
npm run db:seed

# 헬스 체크
npm run db:health

# Prisma Studio 열기
npm run db:studio
```

## 📊 마이그레이션 관리

### 새 마이그레이션 생성
```bash
npm run db:migrate:create "add_user_role"
```

### 마이그레이션 실행
```bash
npm run db:migrate
```

### 마이그레이션 상태 확인
```bash
npm run db:migrate:status
```

### 데이터베이스 리셋
```bash
npm run db:migrate:reset
```

## 💻 코드에서 사용하기

### 1. 기본 사용법

```typescript
import { getDefaultClient } from '../core/db';

const db = getDefaultClient();

// 사용자 생성
const user = await db.user.create({
  data: {
    email: 'user@example.com',
    name: 'John Doe'
  }
});

// 게시글 생성
const post = await db.post.create({
  data: {
    title: 'My Post',
    content: 'Post content',
    authorId: user.id,
    published: true
  }
});
```

### 2. 다중 데이터베이스 사용

```typescript
import { addDatabase, getClient } from '../core/db';

// 새 데이터베이스 설정 추가
addDatabase({
  name: 'analytics',
  url: 'file:./analytics.db'
});

// 특정 데이터베이스 클라이언트 사용
const analyticsDb = getClient('analytics');
const mainDb = getClient('default');
```

### 3. 트랜잭션 사용

```typescript
import { databaseService } from '../core/db/service';

const result = await databaseService.executeTransaction(async (db) => {
  const user = await db.user.create({
    data: { email: 'test@example.com', name: 'Test User' }
  });
  
  const post = await db.post.create({
    data: { title: 'Test Post', authorId: user.id }
  });
  
  return { user, post };
});
```

### 4. 헬퍼 함수 사용

```typescript
import { dbHelpers } from '../app/db/examples';

// 페이지네이션이 적용된 사용자 목록
const users = await dbHelpers.getUsers(1, 10);

// 발행된 게시글 목록
const posts = await dbHelpers.getPosts(true, 1, 20);

// 특정 사용자의 게시글
const userPosts = await dbHelpers.getUserPosts(1);
```

## 🌐 API 엔드포인트

데이터베이스 테스트를 위한 REST API가 제공됩니다:

### 헬스 체크
```
GET /db-test/health
```

### 사용자 관리
```
GET /db-test/users?page=1&limit=10
POST /db-test/users
GET /db-test/users/:userId/posts
```

### 게시글 관리
```
GET /db-test/posts?published=true&page=1&limit=10
POST /db-test/posts
```

### 예제 실행
```
POST /db-test/examples/basic
POST /db-test/examples/multi
POST /db-test/examples/transaction
POST /db-test/examples/advanced
```

### 마이그레이션 상태
```
GET /db-test/migrations
```

## 🛠️ 고급 기능

### 1. 데이터베이스 헬스 체크

```typescript
import { databaseService } from '../core/db/service';

const healthStatus = await databaseService.healthCheck();
console.log(healthStatus); // { default: true, analytics: false }
```

### 2. 마이그레이션 상태 확인

```typescript
const migrations = await databaseService.getMigrationStatus();
console.log(migrations);
```

### 3. 커스텀 마이그레이션

`src/app/db/migrations/` 디렉토리에 SQL 파일을 생성하여 커스텀 마이그레이션을 관리할 수 있습니다.

```sql
-- src/app/db/migrations/002_add_user_role.sql
ALTER TABLE "User" ADD COLUMN "role" TEXT DEFAULT 'user';
```

## 📋 사용 가능한 스크립트

### 데이터베이스 관리
- `npm run db:setup` - 완전한 초기 설정
- `npm run db:generate` - Prisma Client 생성
- `npm run db:migrate` - 마이그레이션 실행
- `npm run db:seed` - 시드 데이터 삽입
- `npm run db:health` - 연결 상태 확인
- `npm run db:studio` - Prisma Studio 실행

### 마이그레이션
- `npm run db:migrate:create` - 새 마이그레이션 생성
- `npm run db:migrate:status` - 마이그레이션 상태 확인
- `npm run db:migrate:reset` - 데이터베이스 리셋

### Prisma 직접 명령어
- `npm run prisma:generate` - Prisma Client 생성
- `npm run prisma:migrate` - Prisma 마이그레이션
- `npm run prisma:studio` - Prisma Studio
- `npm run prisma:push` - 스키마 푸시

## 🔧 설정

### 환경 변수
```env
DATABASE_URL="file:./dev.db"
```

### Prisma 스키마
`prisma/schema.prisma` 파일에서 데이터베이스 스키마를 관리합니다.

### 시드 설정
`package.json`에 시드 설정이 포함되어 있습니다:
```json
{
  "prisma": {
    "seed": "ts-node src/core/db/seed.ts"
  }
}
```

## 🎯 사용 예제

프로젝트에서 제공하는 예제들:

1. **기본 사용법** - 기본적인 CRUD 작업
2. **다중 데이터베이스** - 여러 데이터베이스 동시 관리
3. **트랜잭션** - 안전한 데이터 조작
4. **고급 쿼리** - 복잡한 조건과 집계 쿼리

각 예제는 `/db-test/examples/:type` 엔드포인트를 통해 실행할 수 있습니다.

## 📝 참고사항

- 모든 Prisma Client는 `src/core/db/generated` 위치에 생성됩니다
- 마이그레이션 파일은 `src/app/db/migrations`에서 관리됩니다
- 싱글톤 패턴으로 구현되어 메모리 효율적입니다
- 자동 연결 해제 및 에러 처리가 포함되어 있습니다
