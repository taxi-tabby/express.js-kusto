# 🗄️ 데이터베이스 관리

> **멀티 데이터베이스 지원과 Prisma 통합**  
> 폴더 기반 스키마 관리와 kusto-db CLI를 통한 효율적인 데이터베이스 운영

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

## ⚙️ kusto-db CLI 설치

### 1. CLI 도구 설치
```bash
npm run install-cli
```

### 2. CLI 도구 제거
```bash
npm run uninstall-cli
```

설치 후 전역에서 `kusto-db` 명령어를 사용할 수 있습니다.

## 🛠️ kusto-db 명령어 목록

| 명령어 | 설명 | 옵션 | 예시 |
|--------|------|------|------|
| **기본 명령어** |
| `list` | 사용 가능한 모든 데이터베이스 목록 표시 | - | `kusto-db list` |
| `generate` | Prisma 클라이언트 생성 | `-a` (전체), `-d <db>` (특정 DB) | `kusto-db generate -a`<br>`kusto-db generate -d user` |
| `studio` | Prisma Studio 열기 | `-d <db>` (필수) | `kusto-db studio -d user` |
| **마이그레이션 관리** |
| `migrate` | 스키마 변경사항 관리 | `-t <type>`, `-n <name>`, `-d <db>` | `kusto-db migrate -t dev -n "add_profile" -d user`<br>`kusto-db migrate -t reset -d user`<br>`kusto-db migrate -t status -d user` |
| **데이터 관리** |
| `seed` | 초기 데이터 삽입 | `-a` (전체), `-d <db>` (특정 DB) | `kusto-db seed -d user`<br>`kusto-db seed -a` |
| `pull` ⚠️ | DB 스키마를 Prisma 스키마로 가져오기 | `-d <db>` (필수) | `kusto-db pull -d user` |
| `push` ⚠️ | Prisma 스키마를 DB에 강제 적용 | `-d <db>`, `--accept-data-loss` | `kusto-db push -d user --accept-data-loss` |
| **유틸리티** |
| `validate` | Prisma 스키마 파일 유효성 검사 | `-d <db>` (필수) | `kusto-db validate -d user` |
| `execute` | 원시 SQL 명령 실행 | `-d <db>`, `-q <query>` | `kusto-db execute -d user -q "SELECT COUNT(*) FROM User;"` |
| `debug` | 디버깅 정보 표시 | - | `kusto-db debug` |
| `version` | Prisma CLI 버전 정보 | - | `kusto-db version` |
| `rollback` ⚠️ | 마이그레이션 롤백 (위험) | `-d <db>`, `-t <target>` | `kusto-db rollback -d user -t 1` |

> **⚠️ 위험 표시**: 해당 명령어는 데이터 손실 위험이 있어 이중 보안 확인이 필요합니다.

## 💻 코드에서 데이터베이스 사용

### 1. KustoManager를 통한 접근
```typescript
import { kusto } from '@/core';

// 사용자 데이터베이스 클라이언트 접근
const userClient = kusto.db.getClient('user');
const users = await userClient.user.findMany();

// 임시 데이터베이스 클라이언트 접근
const tempClient = kusto.db.getClient('temporary');
```

### 2. 직접 클라이언트 Import
```typescript
// 생성된 클라이언트를 직접 import
import { PrismaClient as UserClient } from '@/app/db/user/client';
import { PrismaClient as TempClient } from '@/app/db/temporary/client';

const userDb = new UserClient();
const tempDb = new TempClient();
```

## 🔒 보안 기능

kusto-db CLI는 위험한 작업에 대해 이중 보안 확인을 요구합니다:

- **위험 작업**: `reset`, `pull`, `push`, `rollback`
- **보안 코드**: 무작위 4자리 영숫자 코드를 두 번 입력해야 함
- **강제 대기**: `deploy` 같은 특정 작업은 추가 대기 시간 필요

## ⚡ 자동 타입 생성

`kusto-db generate -a` 실행 시 자동으로 생성되는 파일들:

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
| `datasource.provider` | `"postgresql"` | ❌ 필수 | 데이터베이스 타입 |
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
