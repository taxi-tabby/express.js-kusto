# Multi-Database Prisma Management

이 프로젝트는 여러 데이터베이스를 동시에 관리할 수 있는 Prisma 기반 시스템입니다.

## 설정

### 1. 데이터베이스 설정

`src/app/db/init.ts` 파일에서 데이터베이스 연결을 설정합니다:

```typescript
import { addDatabase } from "@core/db";

export default () => {
    // PostgreSQL 메인 데이터베이스
    addDatabase({
        name: 'default',
        provider: 'postgresql',
        connection: {
            host: 'localhost',
            port: 5432,
            username: 'postgres',
            password: 'postgres',
            database: 'myapp'
        }
    });

    // MySQL 분석 데이터베이스
    addDatabase({
        name: 'analytics',
        provider: 'mysql',
        connection: {
            host: 'localhost',
            port: 3306,
            username: 'root',
            password: 'password',
            database: 'analytics'
        }
    });

    // SQLite 캐시 데이터베이스
    addDatabase({
        name: 'cache',
        provider: 'sqlite',
        connection: {
            database: './cache.db'
        }
    });
};
```

### 2. 스키마 파일 구조

각 데이터베이스 provider별로 스키마 파일이 준비되어 있습니다:

```
src/app/db/schemas/
├── postgresql.prisma
├── mysql.prisma
├── sqlite.prisma
└── sqlserver.prisma
```

### 3. 환경 변수

`.env` 파일에서 데이터베이스 연결 정보를 설정할 수 있습니다:

```env
# PostgreSQL (기본)
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=postgres
PG_DB=myapp
PG_SSL=false

# MySQL (선택사항)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DB=analytics

# SQLite
SQLITE_PATH=./dev.db

# SQL Server (선택사항)
SQLSERVER_HOST=localhost
SQLSERVER_PORT=1433
SQLSERVER_USER=sa
SQLSERVER_PASSWORD=password
SQLSERVER_DB=legacy_system
SQLSERVER_SSL=false
```

## CLI 사용법

### 데이터베이스 목록 확인

```bash
npx tsx src/core/scripts/db-cli-multi.ts list
```

### 마이그레이션 관리

```bash
# 특정 데이터베이스에 마이그레이션 생성
npx tsx src/core/scripts/db-cli-multi.ts migrate create default add_users_table

# 특정 데이터베이스 마이그레이션 실행
npx tsx src/core/scripts/db-cli-multi.ts migrate run default

# 모든 데이터베이스 마이그레이션 실행
npx tsx src/core/scripts/db-cli-multi.ts migrate run-all

# 마이그레이션 상태 확인
npx tsx src/core/scripts/db-cli-multi.ts migrate status default

# 데이터베이스 리셋
npx tsx src/core/scripts/db-cli-multi.ts migrate reset default
```

### Prisma Client 생성

```bash
# 특정 데이터베이스 클라이언트 생성
npx tsx src/core/scripts/db-cli-multi.ts generate default

# 모든 데이터베이스 클라이언트 생성
npx tsx src/core/scripts/db-cli-multi.ts generate-all
```

### 스키마 푸시 (개발용)

```bash
# 특정 데이터베이스에 스키마 푸시
npx tsx src/core/scripts/db-cli-multi.ts push default
```

### Prisma Studio

```bash
# 특정 데이터베이스에 대해 Prisma Studio 열기
npx tsx src/core/scripts/db-cli-multi.ts studio default
```

### 헬스 체크

```bash
# 모든 데이터베이스 연결 상태 확인
npx tsx src/core/scripts/db-cli-multi.ts health
```

### 올인원 셋업

```bash
# 특정 데이터베이스 완전 셋업 (마이그레이션 + 클라이언트 생성)
npx tsx src/core/scripts/db-cli-multi.ts setup default

# 모든 데이터베이스 완전 셋업
npx tsx src/core/scripts/db-cli-multi.ts setup
```

## 프로그래밍에서 사용

### 기본 클라이언트 사용

```typescript
import { getClient, getDefaultClient } from '@core/db';

// 기본 데이터베이스 클라이언트 사용
const defaultClient = getDefaultClient();
const users = await defaultClient.user.findMany();

// 특정 데이터베이스 클라이언트 사용
const analyticsClient = getClient('analytics');
const metrics = await analyticsClient.metric.findMany();

const cacheClient = getClient('cache');
const cachedData = await cacheClient.cache.findFirst();
```

### 트랜잭션

```typescript
import { getClient } from '@core/db';

const client = getClient('default');

await client.$transaction(async (tx) => {
    const user = await tx.user.create({
        data: { email: 'test@example.com', name: 'Test User' }
    });
    
    const post = await tx.post.create({
        data: { title: 'Hello World', authorId: user.id }
    });
    
    return { user, post };
});
```

### 마이그레이션 관리자 사용

```typescript
import { PrismaManager } from '@core/db';

const prismaManager = PrismaManager.getInstance();
const migrationManager = prismaManager.getMigrationManager();

// 프로그래밍 방식으로 마이그레이션 실행
await migrationManager.runMigrations('default', 'add_new_column');

// 클라이언트 생성
await migrationManager.generateClient('default');

// 연결 상태 확인
const isHealthy = await prismaManager.checkConnection('default');
```

## 지원되는 데이터베이스

- PostgreSQL
- MySQL
- SQLite
- SQL Server
- MongoDB
- CockroachDB

## 디렉토리 구조

```
src/
├── app/
│   └── db/
│       ├── init.ts                 # 데이터베이스 설정
│       ├── migrations/             # 마이그레이션 파일들
│       │   ├── default/           # 기본 DB 마이그레이션
│       │   ├── analytics/         # 분석 DB 마이그레이션
│       │   └── cache/             # 캐시 DB 마이그레이션
│       └── schemas/               # Prisma 스키마 파일들
│           ├── postgresql.prisma
│           ├── mysql.prisma
│           ├── sqlite.prisma
│           └── sqlserver.prisma
└── core/
    ├── db/
    │   ├── index.ts              # PrismaManager 및 편의 함수들
    │   ├── migration.ts          # MigrationManager
    │   └── service.ts            # DatabaseService
    └── scripts/
        └── db-cli-multi.ts       # 다중 DB CLI 도구
```

## 주의사항

1. 각 데이터베이스는 독립적인 마이그레이션 히스토리를 가집니다.
2. 스키마 파일은 provider별로 관리되며, 필요에 따라 수정할 수 있습니다.
3. 모든 클라이언트는 동일한 output 디렉토리(`core/db/generated`)를 사용합니다.
4. 환경 변수를 통해 데이터베이스 연결을 동적으로 제어할 수 있습니다.
