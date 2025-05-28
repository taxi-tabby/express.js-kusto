# 자동 Prisma 클라이언트 관리 시스템

`src\app\db\schemas\clients` 폴더에 있는 Prisma 클라이언트들을 자동으로 탐지하고 관리하는 시스템입니다.

## 🚀 특징

- **자동 탐지**: `clients` 폴더의 모든 Prisma 클라이언트 자동 발견
- **환경 변수 매핑**: 클라이언트명에 따른 자동 환경 변수 매칭
- **통합 관리**: 기존 수동 설정과 자동 탐지 클라이언트 통합 관리
- **연결 테스트**: 모든 클라이언트의 연결 상태 확인
- **CLI 도구**: 풍부한 명령어로 클라이언트 관리

## 📁 디렉토리 구조

```
src/app/db/schemas/
├── clients/           # 자동 탐지 대상 폴더
│   ├── default/      # 기본 클라이언트
│   ├── analytics/    # 분석 클라이언트
│   ├── cache/        # 캐시 클라이언트
│   └── logs/         # 로그 클라이언트
└── *.prisma          # 스키마 파일들
```

## ⚙️ 환경 변수 설정

### 1. 클라이언트별 URL 패턴

```env
# 패턴 1: {CLIENT_NAME}_DATABASE_URL
DEFAULT_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/myapp"
ANALYTICS_DATABASE_URL="mysql://root:password@localhost:3306/analytics"
CACHE_DATABASE_URL="file:./cache.db"

# 패턴 2: {CLIENT_NAME}_URL
DEFAULT_URL="postgresql://postgres:postgres@localhost:5432/myapp"
ANALYTICS_URL="mysql://root:password@localhost:3306/analytics"

# 패턴 3: DATABASE_URL_{CLIENT_NAME}
DATABASE_URL_DEFAULT="postgresql://postgres:postgres@localhost:5432/myapp"
DATABASE_URL_ANALYTICS="mysql://root:password@localhost:3306/analytics"

# 기본값
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/myapp"
```

### 2. Provider별 기본값

환경 변수가 없는 경우 provider에 따라 자동 생성:

- **PostgreSQL**: `postgresql://postgres:postgres@localhost:5432/{clientName}`
- **MySQL**: `mysql://root:password@localhost:3306/{clientName}`
- **SQLite**: `file:./{clientName}.db`
- **SQL Server**: `sqlserver://localhost:1433;database={clientName};user=sa;password=password`
- **MongoDB**: `mongodb://localhost:27017/{clientName}`
- **CockroachDB**: `postgresql://root@localhost:26257/{clientName}?sslmode=disable`

## 🎯 사용법

### 1. 기본 사용

```typescript
import { initializeAllClients, getAnyClient, getAllClientNames } from '@core/db';

// 모든 클라이언트 초기화 (자동 + 수동)
await initializeAllClients();

// 특정 클라이언트 사용
const defaultClient = await getAnyClient('default');
const users = await defaultClient.user.findMany();

// 자동 탐지된 클라이언트 사용
const analyticsClient = await getAnyClient('analytics');
const metrics = await analyticsClient.metric.findMany();

// 사용 가능한 모든 클라이언트 목록
const clientNames = getAllClientNames();
console.log('Available clients:', clientNames);
```

### 2. 수동 스캔 및 등록

```typescript
import { clientManager, scanAndRegisterClients } from '@core/db';

// 수동으로 스캔 및 등록
await scanAndRegisterClients();

// 클라이언트 상태 확인
const clients = clientManager.getDetectedClients();
clients.forEach(client => {
  console.log(`${client.name}: ${client.isValid ? 'Valid' : 'Invalid'}`);
});
```

## 🔧 CLI 도구

### 자동 클라이언트 관리 CLI

```bash
# 클라이언트 스캔
npx tsx src/core/scripts/auto-client-cli.ts scan

# 자동 등록
npx tsx src/core/scripts/auto-client-cli.ts auto-register

# 모든 클라이언트 목록
npx tsx src/core/scripts/auto-client-cli.ts list

# 특정 클라이언트 정보
npx tsx src/core/scripts/auto-client-cli.ts info default

# 연결 테스트
npx tsx src/core/scripts/auto-client-cli.ts test default
npx tsx src/core/scripts/auto-client-cli.ts test-all

# 상태 리포트
npx tsx src/core/scripts/auto-client-cli.ts report

# 환경 변수 확인
npx tsx src/core/scripts/auto-client-cli.ts check-env
```

### 기존 다중 DB CLI와 함께 사용

```bash
# 기존 CLI로 마이그레이션 관리
npx tsx src/core/scripts/db-cli-multi.ts list
npx tsx src/core/scripts/db-cli-multi.ts migrate run default
npx tsx src/core/scripts/db-cli-multi.ts generate default
```

## 🔍 탐지 조건

클라이언트가 유효한 것으로 인식되려면:

1. ✅ `index.js` 파일 존재
2. ✅ `PrismaClient` export 확인
3. ✅ 모듈 로드 가능
4. ✅ 연결 URL 확인 가능

## 📊 상태 모니터링

```typescript
import { clientManager } from '@core/db';

// 상세 리포트 출력
clientManager.printClientReport();

// 프로그래밍 방식으로 상태 확인
const validClients = clientManager.getValidClients();
const allClients = clientManager.getDetectedClients();

console.log(`Valid: ${validClients.length}/${allClients.length}`);
```

## 🛠️ 트러블슈팅

### 1. 클라이언트가 탐지되지 않는 경우

```bash
# 1. 클라이언트 폴더 확인
ls src/app/db/schemas/clients/

# 2. 스캔 실행
npx tsx src/core/scripts/auto-client-cli.ts scan

# 3. 상세 정보 확인
npx tsx src/core/scripts/auto-client-cli.ts info <client-name>
```

### 2. 연결 오류가 발생하는 경우

```bash
# 1. 환경 변수 확인
npx tsx src/core/scripts/auto-client-cli.ts check-env

# 2. 연결 테스트
npx tsx src/core/scripts/auto-client-cli.ts test <client-name>

# 3. 환경 변수 설정
cp .env.example .env
# .env 파일 편집
```

### 3. 스키마와 클라이언트 매칭 문제

자동 매칭 규칙:
- 정확한 이름 매칭: `default` ↔ `default.prisma`
- 포함 관계: `analytics` ↔ `mysql-analytics.prisma`
- 수동 지정: `schema.prisma` 파일을 클라이언트 폴더에 복사

## 🎛️ 설정 옵션

```typescript
// 사용자 정의 클라이언트 매니저
import { PrismaClientManager } from '@core/db/clientManager';

const customManager = PrismaClientManager.getInstance();

// 특정 클라이언트만 로드
const client = await customManager.getClientInstance('analytics');

// 모든 연결 해제
await customManager.disconnectAll();
```

## 📈 성능 최적화

1. **지연 로딩**: 클라이언트는 처음 사용될 때만 로드
2. **연결 풀링**: 각 클라이언트별 독립적인 연결 관리
3. **캐싱**: 탐지된 클라이언트 정보 메모리 캐시
4. **환경별 설정**: 개발/운영환경에 따른 로깅 레벨 조정

## 🔄 마이그레이션 가이드

기존 수동 설정에서 자동 탐지로 전환:

1. **환경 변수 설정**: `.env.example` 참고하여 설정
2. **점진적 전환**: 기존 설정 유지하면서 자동 탐지 추가
3. **테스트 확인**: `test-all` 명령어로 모든 연결 확인
4. **수동 설정 제거**: 정상 동작 확인 후 기존 설정 제거

이제 `src\app\db\schemas\clients` 폴더의 모든 Prisma 클라이언트가 자동으로 관리됩니다! 🎉
