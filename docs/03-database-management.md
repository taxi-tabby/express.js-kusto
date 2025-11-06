# 🗄️ 데이터베이스 관리

> **멀티 데이터베이스 지원과 Prisma 통합**  
> 폴더 기반 스키마 관리와 npm run db CLI를 통한 효율적인 데이터베이스 운영  
> **Serverless 환경 자동 재연결 지원**

## 🔌 Serverless 환경 DB 연결 관리

Express.js-Kusto는 **AWS Lambda**, **Vercel**, **Google Cloud Functions** 등의 serverless 환경에서 발생하는 데이터베이스 연결 문제를 자동으로 해결합니다.

### 🚀 핵심 기능

#### 1. 자동 연결 상태 확인
- 각 요청마다 DB 연결 상태를 지능적으로 확인
- 설정된 간격 내에서는 캐시된 상태 사용으로 성능 최적화
- Serverless: 15초, Traditional: 60초 기본 간격

#### 2. 지능형 재연결 로직
- 연결이 끊어진 경우 자동으로 재연결 시도
- 최대 재시도 횟수 제한으로 무한 루프 방지
- 재연결 실패 시 적절한 에러 응답

#### 3. Connection Pool 최적화
- Serverless 환경에 맞는 연결 풀 관리
- Cold start 시 빠른 연결 복구
- 메모리 효율적인 연결 관리

### 🛠️ 환경별 자동 설정

```typescript
// Serverless 환경 자동 감지
const isServerless = process.env.AWS_LAMBDA_FUNCTION_NAME || 
                    process.env.VERCEL || 
                    process.env.FUNCTIONS_WORKER ||
                    process.env.NODE_ENV === 'production';

// 환경별 최적화된 설정 자동 적용
if (isServerless) {
    // 더 자주 연결 상태 확인, 빠른 재연결
    checkInterval: 15000,
    continueOnFailure: false
} else {
    // 덜 자주 체크, 에러 허용적
    checkInterval: 60000,
    continueOnFailure: true
}
```

###  사용 방법

#### 1. 자동 재연결 포함 (권장)
```typescript
// getClient는 자동으로 연결 상태를 확인하고 필요시 재연결합니다
const userDb = await kusto.db.getClient('user');
const users = await userDb.user.findMany();
```

#### 2. 동기 버전 (빠른 응답, 재연결 없음)
```typescript
// 이미 연결된 상태에서 빠른 접근이 필요한 경우
const userDb = kusto.db.getClientSync('user'); 
const users = await userDb.user.findMany();
```


### 🔧 고급 설정

#### Custom Middleware 설정
```typescript
import { createDbConnectionMiddleware } from './core/lib/dbConnectionMiddleware';

// 특정 데이터베이스만 체크
app.use('/api/users', createDbConnectionMiddleware({
    databases: ['user'], // user DB만 체크
    continueOnFailure: false,
    checkInterval: 10000
}));

// 에러 핸들링 커스터마이징
app.use(createDbConnectionMiddleware({
    onError: (error, req, res, next) => {
        // 커스텀 에러 응답
        res.status(503).json({
            error: 'Database temporarily unavailable',
            retryAfter: '30 seconds'
        });
    },
    onReconnect: (database, req) => {
        // 재연결 시 로깅
        console.log(`Database ${database} reconnected for ${req.ip}`);
    }
}));
```

### 🎯 Best Practices

1. **Serverless 환경에서는 `getClient()` 사용**: 자동 재연결 포함
2. **Traditional 서버에서는 `getClientSync()` 사용**: 성능 최적화
3. **Health check 엔드포인트 활용**: 모니터링 시스템 연동
4. **Connection pool 설정**: DATABASE_URL에 적절한 pool 설정 추가
5. **에러 처리**: 연결 실패 시 적절한 fallback 로직 구현

## 📂 폴더 기반 데이터베이스 구조

Express.js-Kusto는 `src/app/db/` 폴더 구조를 기반으로 자동으로 데이터베이스를 인식합니다.

```
src/app/db/
├── user/                    # 사용자 관련 데이터베이스
│   ├── schema.prisma       # Prisma 스키마 파일
│   ├── seed.ts            # 초기 데이터 시딩
│   └── client/            # 생성된 Prisma 클라이언트 (자동 생성)
└── temporary/              # 임시 데이터 저장소
    ├── schema.prisma
    ├── seed.ts
    └── client/
```

각 폴더는 독립적인 데이터베이스를 나타내며, 각자의 스키마와 클라이언트를 가집니다.

## 🛠️ 데이터베이스 CLI 사용법

프로젝트에서는 별도 설치 없이 `npm run db ---` 명령어를 사용하여 데이터베이스를 관리합니다.

### 기본 사용법
```bash
npm run db --- <명령어> [옵션]
```

## 🛠️ 명령어 목록

| 명령어 | 설명 | 옵션 | 예시 |
|--------|------|------|------|
| **기본 명령어** |
| `list` | 사용 가능한 모든 데이터베이스 목록 표시 | - | `npm run db --- list` |
| `generate` | Prisma 클라이언트 생성 | `-a` (전체), `-d <db>` (특정 DB) | `npm run db --- generate -a`<br>`npm run db --- generate -d user` |
| `studio` | Prisma Studio 열기 | `-d <db>` (필수) | `npm run db --- studio -d user` |
| **마이그레이션 관리** |
| `migrate` | 스키마 변경사항 관리 | `-t <type>`, `-n <name>`, `-d <db>` | `npm run db --- migrate -t dev -n "add_profile" -d user`<br>`npm run db --- migrate -t reset -d user`<br>`npm run db --- migrate -t status -d user` |
| **데이터 관리** |
| `seed` | 초기 데이터 삽입 | `-a` (전체), `-d <db>` (특정 DB) | `npm run db --- seed -d user`<br>`npm run db --- seed -a` |
| `pull` ⚠️ | DB 스키마를 Prisma 스키마로 가져오기 | `-d <db>` (필수) | `npm run db --- pull -d user` |
| `push` ⚠️ | Prisma 스키마를 DB에 강제 적용 | `-d <db>`, `--accept-data-loss` | `npm run db --- push -d user --accept-data-loss` |
| **유틸리티** |
| `validate` | Prisma 스키마 파일 유효성 검사 | `-d <db>` (필수) | `npm run db --- validate -d user` |
| `execute` | 원시 SQL 명령 실행 | `-d <db>`, `-c <command>` | `npm run db --- execute -d user -c "SELECT COUNT(*) FROM User;"` |
| `debug` | 디버깅 정보 표시 | - | `npm run db --- debug` |
| `version` | Prisma CLI 버전 정보 | - | `npm run db --- version` |
| `rollback` ⚠️ | 마이그레이션 롤백 (위험) | `-d <db>`, `-t <target>` | `npm run db --- rollback -d user -t 1` |

> **⚠️ 위험 표시**: 해당 명령어는 데이터 손실 위험이 있어 이중 보안 확인이 필요합니다.


## 🔒 보안 기능

데이터베이스 CLI는 위험한 작업에 대해 이중 보안 확인을 요구합니다:

- **위험 작업**: `reset`, `pull`, `push`, `rollback`
- **보안 코드**: 무작위 4자리 영숫자 코드를 두 번 입력해야 함
- **강제 대기**: `deploy` 같은 특정 작업은 추가 대기 시간 필요

## 💡 실전 워크플로우

### 🚀 프로젝트 초기 설정
```bash
# 1. 데이터베이스 목록 확인
npm run db --- list

# 2. 모든 데이터베이스의 Prisma 클라이언트 생성
npm run db --- generate -a

# 3. 스키마 검증
npm run db --- validate -d temporary

# 4. 마이그레이션 생성 및 적용
npm run db --- migrate -t dev -n "initial_schema" -d temporary
```

### 🔄 개발 중 스키마 변경
```bash
# 1. schema.prisma 파일 수정

# 2. 변경사항 마이그레이션 생성
npm run db --- migrate -t dev -n "add_user_field" -d temporary

# 3. 마이그레이션 상태 확인
npm run db --- migrate -t status -d temporary
```

### 🌱 초기 데이터 세팅
```bash
# 1. seed.ts 파일 작성

# 2. 시드 데이터 실행
npm run db --- seed -d temporary

# 3. Prisma Studio로 데이터 확인
npm run db --- studio -d temporary
```

### 🔍 개발 시 유용한 명령어
```bash
# 스키마 검증
npm run db --- validate -d temporary

# SQL 직접 실행 (예: 데이터 개수 확인)
npm run db --- execute -d temporary -c "SELECT COUNT(*) FROM User;"

# 디버그 정보 확인
npm run db --- debug -d temporary
```

## ⚡ 자동 타입 생성

`npm run db --- generate -a` 실행 시 자동으로 생성되는 파일들:

1. **Prisma 클라이언트**: `src/app/db/{database}/client/`
2. **타입 안전한 접근**: KustoManager를 통한 완전한 타입 지원


## 📋 Prisma 스키마 구성

각 데이터베이스 폴더의 `schema.prisma` 파일은 다음과 같이 **반드시** 구성해야 합니다:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "client"
}

datasource db {
  provider = "postgresql"
  url      = env("RDS_USER_URL")
}

// 여기에 모델 정의...
```

### 🔧 스키마 구성 규칙

| 설정 | 값 | 변경 가능 여부 | 설명 |
|------|----|----|------|
| `generator.provider` | `"prisma-client-js"` | ❌ 필수 | Prisma 클라이언트 생성기 |
| `generator.output` | `"client"` | ❌ 필수 | 클라이언트 출력 폴더 |
| `datasource.provider` | `"postgresql"` | Prisma 지원 내에서 자율 | 데이터베이스 타입 |
| `datasource.url` | `env("RDS_DB_URL")` | ✅ 변경 가능 | **환경변수 이름만 변경 가능** |

> **⚠️ 중요**: `datasource.url`에서는 환경변수 이름(예: `RDS_USER_URL`)만 변경할 수 있습니다. 나머지 설정은 프레임워크 동작을 위해 반드시 유지해야 합니다.

### 📌 환경변수 명명 규칙
- 패턴: `RDS_{DATABASE_NAME}_URL`
- 예시: 
  - `user` 데이터베이스 → `RDS_USER_URL`
  - `temporary` 데이터베이스 → `RDS_TEMPORARY_URL`
  - `admin` 데이터베이스 → `RDS_ADMIN_URL`

---

## 📖 문서 네비게이션

**◀️ 이전**: [🛣️ 라우팅 시스템](./02-routing-system.md)  
**▶️ 다음**: [🔌 의존성 주입 시스템](./04-injectable-system.md)
