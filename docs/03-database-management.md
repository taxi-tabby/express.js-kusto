# 🗄️ 데이터베이스 관리

> **멀티 데이터베이스 지원과 Prisma 통합**
> 폴더 기반 스키마 관리와 `npm run db` CLI 를 통한 효율적인 데이터베이스 운영
> **연결 에러 발생 시 lazy 자동 재연결 (서버리스/긴 idle 환경 지원)**

## 🔌 자동 재연결 정책

Express.js-Kusto 의 `PrismaManager` 는 **쿼리 실행 중 연결 에러를 감지하면** 자동으로 재연결을 시도하고 같은 쿼리를 재시도한다. AWS Lambda / Vercel / Cloud Run 같이 인스턴스가 idle 후 깨어나는 환경에서 첫 쿼리가 깨지는 문제를 자동으로 흡수하기 위한 설계.

### 동작 모델

| 항목 | 동작 |
|------|------|
| 트리거 | `getWrap()` Proxy 가 감싼 클라이언트의 쿼리 실행 중 connection-class 에러 발생 시 |
| 백오프 | 지수 백오프 (시도당 약 ×1.5, 상한 8초) |
| 최대 재시도 | `MAX_RECONNECTION_ATTEMPTS = 3` |
| 누적 실패 후 쿨다운 | `RECONNECTION_COOLDOWN_MS = 30000` (30초) |
| 주기적 헬스 체크 | **없음** — 재연결은 실패한 쿼리 경로에서만 trigger |
| 환경 자동 감지 | **없음** — 모든 환경에서 동일한 정책 사용 |

`prismaManager.ts` 의 상수 (`MAX_RECONNECTION_ATTEMPTS`, `RECONNECTION_COOLDOWN_MS`) 가 단일 진실의 원천. 환경별 분기나 별도의 `checkInterval` 설정은 코드에 존재하지 않는다.

### 사용 방법

```typescript
// 1) Repository 내부에서 사용 — 권장
//    BaseRepository.client getter 가 내부적으로 getWrap() 사용 → 재연결 자동
class UserRepository extends BaseRepository<'default'> {
    protected getDatabaseName(): 'default' { return 'default'; }
    async list() { return this.client.user.findMany(); }
}

// 2) 라우트 핸들러에서 직접 — 재연결이 필요한 경우 getWrap() 명시
async (req, res, injected, repo, db) => {
    const wrapped = req.kusto.db.getWrap('default');
    const users = await wrapped.user.findMany();  // 연결 에러 시 자동 재연결
}
```

### `getClient()` / `getClientSync()` vs `getWrap()`

| 메서드 | 반환 | 자동 재연결 | 비고 |
|--------|------|-------------|------|
| `getWrap(name)` | 재연결 Proxy 로 감싼 클라이언트 | ✅ | Repository / 라우트 권장 경로 |
| `getClient(name)` | raw 클라이언트 (Promise) | ❌ | 성능 우선 / dev 모드 무결성 검증만 추가 |
| `getClientSync(name)` | raw 클라이언트 (sync) | ❌ | 동기 접근이 필요한 내부 도구용 |

서버리스 환경에서 자동 재연결을 받으려면 `getWrap()` 또는 Repository 의 `this.client` 를 사용한다. `getClient()` 의 JSDoc 도 동일한 안내를 명시.

### 헬스 체크

`PrismaManager.healthCheck()` 는 외부 호출용 on-demand 메서드다. 자동으로 주기 실행되지 않으며, 모니터링 엔드포인트나 readiness probe 에서 명시적으로 호출해 사용한다.

## 📂 폴더 기반 데이터베이스 구조

Express.js-Kusto는 `src/app/db/` 폴더 구조를 기반으로 자동으로 데이터베이스를 인식합니다.

```
src/app/db/
├── default/                # 기본 데이터베이스 (저장소 기본 포함)
│   ├── schema.prisma       # Prisma 스키마 파일
│   ├── seed.ts             # 초기 데이터 시딩 (선택)
│   └── client/             # 생성된 Prisma 클라이언트 (자동 생성)
└── ...                     # 추가 데이터베이스 폴더 (예: analytics, audit 등)
```

각 폴더는 독립적인 데이터베이스를 나타내며, 각자의 스키마와 클라이언트를 가집니다. 폴더명은 `BaseRepository<'폴더명'>` 의 제네릭 인자와 `router.CRUD('폴더명', ...)` 의 첫 인자로 그대로 사용됩니다.

## 🛠️ 데이터베이스 CLI 사용법

프로젝트에서는 별도 설치 없이 `npm run db --` 명령어를 사용하여 데이터베이스를 관리합니다.

### 기본 사용법
```bash
npm run db -- <명령어> [옵션]
```

## 🛠️ 명령어 목록

| 명령어 | 설명 | 옵션 | 예시 |
|--------|------|------|------|
| **기본 명령어** |
| `list` | 사용 가능한 모든 데이터베이스 목록 표시 | - | `npm run db -- list` |
| `generate` | Prisma 클라이언트 생성 | `-a` (전체), `-d <db>` (특정 DB) | `npm run db -- generate -a`<br>`npm run db -- generate -d default` |
| `studio` | Prisma Studio 열기 | `-d <db>` (필수) | `npm run db -- studio -d default` |
| **마이그레이션 관리** |
| `migrate` | 스키마 변경사항 관리 | `-t <type>`, `-n <name>`, `-d <db>` | `npm run db -- migrate -t dev -n "add_profile" -d default`<br>`npm run db -- migrate -t reset -d default`<br>`npm run db -- migrate -t status -d default` |
| **데이터 관리** |
| `seed` | 초기 데이터 삽입 | `-a` (전체), `-d <db>` (특정 DB) | `npm run db -- seed -d default`<br>`npm run db -- seed -a` |
| `pull` ⚠️ | DB 스키마를 Prisma 스키마로 가져오기 | `-d <db>` (필수) | `npm run db -- pull -d default` |
| `push` ⚠️ | Prisma 스키마를 DB에 강제 적용 | `-d <db>`, `--accept-data-loss` | `npm run db -- push -d default --accept-data-loss` |
| **유틸리티** |
| `validate` | Prisma 스키마 파일 유효성 검사 | `-d <db>` (필수) | `npm run db -- validate -d default` |
| `execute` | 원시 SQL 명령 실행 | `-d <db>`, `-c <command>` | `npm run db -- execute -d default -c "SELECT COUNT(*) FROM User;"` |
| `debug` | 디버깅 정보 표시 | - | `npm run db -- debug` |
| `version` | Prisma CLI 버전 정보 | - | `npm run db -- version` |
| `rollback` ⚠️ | 마이그레이션 롤백 (위험) | `-d <db>`, `-t <target>` | `npm run db -- rollback -d default -t 1` |

> `-d` 인자는 `src/app/db/` 의 폴더명이며 코드베이스에 실제 존재해야 한다. 기본 저장소에는 `default` 폴더만 들어 있다.

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
npm run db -- list

# 2. 모든 데이터베이스의 Prisma 클라이언트 생성
npm run db -- generate -a

# 3. 스키마 검증
npm run db -- validate -d default

# 4. 마이그레이션 생성 및 적용
npm run db -- migrate -t dev -n "initial_schema" -d default
```

### 🔄 개발 중 스키마 변경
```bash
# 1. schema.prisma 파일 수정

# 2. 변경사항 마이그레이션 생성
npm run db -- migrate -t dev -n "add_user_field" -d default

# 3. 마이그레이션 상태 확인
npm run db -- migrate -t status -d default
```

### 🌱 초기 데이터 세팅
```bash
# 1. seed.ts 파일 작성

# 2. 시드 데이터 실행
npm run db -- seed -d default

# 3. Prisma Studio로 데이터 확인
npm run db -- studio -d default
```

### 🔍 개발 시 유용한 명령어
```bash
# 스키마 검증
npm run db -- validate -d default

# SQL 직접 실행 (예: 데이터 개수 확인)
npm run db -- execute -d default -c "SELECT COUNT(*) FROM User;"

# 디버그 정보 확인
npm run db -- debug -d default
```

## ⚡ 자동 타입 생성

`npm run db -- generate -a` 실행 시 자동으로 생성되는 파일들:

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
  url      = env("DEFAULT__KUSTO_RDB_URL")  // 방식 1: 환경변수 직접 지정
}

// 여기에 모델 정의...
```

또는 Prisma 7 스타일로 `url`을 생략하면 폴더명 컨벤션이 자동 적용됩니다:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "client"
}

datasource db {
  provider = "postgresql"
  // url 생략 → 폴더명 기반 자동 결정 (방식 2)
  // 예: src/app/db/default/ → DEFAULT__KUSTO_RDB_URL 환경변수 사용
}
```

### 🔧 스키마 구성 규칙

| 설정 | 값 | 변경 가능 여부 | 설명 |
|------|----|----|------|
| `generator.provider` | `"prisma-client-js"` | ❌ 필수 | Prisma 클라이언트 생성기 |
| `generator.output` | `"client"` | ❌ 필수 | 클라이언트 출력 폴더 |
| `datasource.provider` | `"postgresql"` 등 | Prisma 지원 내에서 자율 | 데이터베이스 타입 (자동 감지됨) |
| `datasource.url` | `env("변수명")` 또는 생략 | ✅ 선택 | 생략 시 폴더명 컨벤션 자동 적용 |

> **⚠️ 중요**: `generator` 설정은 프레임워크 동작을 위해 반드시 유지해야 합니다. `datasource.provider`는 자동 감지되어 적절한 드라이버 어댑터(pg/mysql/sqlite)가 동적 로드됩니다.

### 📌 환경변수 결정 규칙

DB URL 환경변수는 **두 가지 방식**으로 결정됩니다:

#### 방식 1: `schema.prisma`에 직접 지정 (우선)

`datasource.url`에 `env("변수명")`이 있으면 해당 변수명을 그대로 사용합니다.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("MY_CUSTOM_DB_URL")  // → MY_CUSTOM_DB_URL 환경변수 사용
}
```

#### 방식 2: 폴더명 기반 컨벤션 (자동)

`schema.prisma`에 `url = env(...)` 구문이 없는 경우 (Prisma 7 스타일 등), 폴더명에서 자동으로 환경변수명을 생성합니다.

**규칙**: `{FOLDER_NAME}__KUSTO_RDB_URL` (폴더명을 `UPPER_SNAKE_CASE`로 변환 + `__KUSTO_RDB_URL`)

| DB 폴더 | 환경변수명 |
|---------|-----------|
| `src/app/db/default/` | `DEFAULT__KUSTO_RDB_URL` |
| `src/app/db/analytics/` | `ANALYTICS__KUSTO_RDB_URL` |
| `src/app/db/myDatabase/` | `MY_DATABASE__KUSTO_RDB_URL` |

> **참고**: `.env.template` 파일에 예시가 포함되어 있습니다.

---

## 📖 문서 네비게이션

**◀️ 이전**: [🛣️ 라우팅 시스템](./02-routing-system.md)  
**▶️ 다음**: [🔌 의존성 주입 시스템](./04-injectable-system.md)
