# PrismaManager 사용법

PrismaManager는 여러 Prisma 데이터베이스를 관리하는 싱글톤 클래스입니다.

## 주요 특징

- **싱글톤 패턴**: 애플리케이션 전체에서 동일한 인스턴스 사용
- **자동 발견**: `src/app/db` 폴더의 각 하위 폴더를 자동으로 스캔
- **연결 상태 관리**: Prisma 클라이언트가 생성되지 않은 경우 자동으로 제외
- **타입 안전성**: TypeScript 타입 지원
- **에러 처리**: 연결 실패 시 애플리케이션이 중단되지 않음

## 기본 사용법

### 1. 인스턴스 가져오기

```typescript
import { prismaManager } from '../core/lib/prismaManager';
```

### 2. 특정 데이터베이스 클라이언트 사용

```typescript
// 방법 1: getClient 메서드 사용
const db1 = prismaManager.getClient('testdb1');
const users = await db1.user.findMany();

// 방법 2: 편의 메서드 사용
const db1 = prismaManager.testdb1();
const users = await db1.user.findMany();
```

### 3. 여러 데이터베이스 사용

```typescript
export async function compareData(req: Request, res: Response) {
    try {
        const db1 = prismaManager.testdb1();
        const db2 = prismaManager.testdb2();
        
        const [users1, users2] = await Promise.all([
            db1.user.findMany(),
            db2.user.findMany()
        ]);
        
        res.json({
            testdb1: { count: users1.length, users: users1 },
            testdb2: { count: users2.length, users: users2 }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
```

## 고급 사용법

### 1. 트랜잭션 실행

```typescript
// 여러 데이터베이스에서 각각 트랜잭션 실행
const results = await prismaManager.executeTransactions([
    {
        database: 'testdb1',
        operation: async (tx) => {
            return tx.user.create({ data: { email: 'user1@example.com' } });
        }
    },
    {
        database: 'testdb2',
        operation: async (tx) => {
            return tx.user.create({ data: { email: 'user2@example.com' } });
        }
    }
]);
```

### 2. Raw 쿼리 실행

```typescript
const result = await prismaManager.executeRawQuery(
    'testdb1',
    'SELECT COUNT(*) as user_count FROM "User"'
);
```

### 3. 헬스 체크

```typescript
const health = await prismaManager.healthCheck();
console.log('Overall status:', health.overall);
health.databases.forEach(db => {
    console.log(`${db.name}: ${db.status} (${db.responseTime}ms)`);
});
```

## 상태 확인

### 연결된 데이터베이스 목록

```typescript
const databases = prismaManager.getAvailableDatabases();
console.log('Connected databases:', databases);
```

### 전체 상태 확인

```typescript
const status = prismaManager.getStatus();
console.log('Initialized:', status.initialized);
console.log('Connected DBs:', status.connectedDatabases);
console.log('Total DBs:', status.totalDatabases);
```

### 특정 데이터베이스 연결 상태

```typescript
if (prismaManager.isConnected('testdb1')) {
    // testdb1이 연결된 경우
    const client = prismaManager.testdb1();
    // ... 데이터베이스 작업
}
```

## API 엔드포인트

PrismaManager 상태를 확인할 수 있는 기본 API 엔드포인트들:

- `GET /database/status` - 전체 데이터베이스 상태
- `GET /database/health` - 헬스 체크
- `GET /database/list` - 데이터베이스 목록
- `GET /database/test/:dbName` - 특정 DB 연결 테스트

## 환경 설정

각 데이터베이스 폴더명에 따라 환경 변수가 매핑됩니다:

- `testdb1` → `RDS1_DEFAULT_URL`
- `testdb2` → `RDS2_DEFAULT_URL`
- `customdb` → `CUSTOMDB_DEFAULT_URL`

## 주의사항

1. **Prisma Generate**: 각 데이터베이스의 Prisma 클라이언트가 생성되어야 합니다.
2. **환경 변수**: 데이터베이스 연결 URL이 환경 변수에 설정되어야 합니다.
3. **에러 처리**: 데이터베이스 연결 실패는 애플리케이션을 중단시키지 않습니다.
4. **초기화**: 라우트 로드 전에 자동으로 초기화됩니다.

## 예제 라우트

실제 사용 예제는 다음 라우트들을 참고하세요:

- `/users` - 기본 CRUD 작업
- `/users/compare` - 여러 DB 비교
- `/database/health` - 헬스 체크
- `/database/status` - 상태 확인
