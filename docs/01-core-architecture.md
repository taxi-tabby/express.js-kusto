# 🏗️ 핵심 아키텍처

> **Express.js-Kusto 프레임워크의 기본 구조**  
> Application 클래스와 Core 시스템의 역할과 동작 방식을 이해합니다.

## 📋 목차

- [설계 철학](#설계-철학)
- [기본 사용법](#기본-사용법)
- [프로젝트 구조와 관례](#프로젝트-구조와-관례)
- [서버 시작 시 자동 실행](#서버-시작-시-자동-실행)
- [핵심 특징](#핵심-특징)

## 설계 철학

### Convention over Configuration (관례 우선 설정)

프레임워크는 **설정보다는 관례**를 따릅니다. 복잡한 설정 파일 없이도 정해진 폴더 구조만 따르면 자동으로 동작합니다.

#### 관례 적용 수준

| 영역 | 수준 | 설명 |
|------|------|------|
| **라우팅** | 완전 자동 | 폴더 구조 = URL 경로. `route.ts`/`middleware.ts` 배치만으로 동작 |
| **DB 발견** | 완전 자동 | `src/app/db/` 하위에 `schema.prisma` 폴더 존재만으로 자동 등록. Provider(pg/mysql/sqlite) 자동 감지 |
| **Repository** | 관례 + Codegen | `*.repository.ts` 네이밍 → 키 자동 매핑. 단, 파일 추가/변경 시 `npm run generate` 실행 필요 |
| **Injectable/DI** | 관례 + Codegen | 폴더 경로 → camelCase 키 자동 매핑. 단, 파일 추가/변경 시 `npm run generate` 실행 필요 |
| **DB URL** | 명시적 설정 | `schema.prisma`에 `env("변수명")` 지정 또는 `{FOLDER}__KUSTO_RDB_URL` 컨벤션. [상세](./03-database-management.md) |
| **Views** | 부분 자동 | 경로는 basePath에서 파생. 엔진은 `ejs` 기본값 |

> **Codegen 주의사항**: `npm run dev`는 시작 시 자동으로 `npm run generate`를 실행합니다. 하지만 서버 실행 중 파일을 추가하면 서버를 재시작하거나 수동으로 `npm run generate`를 실행해야 합니다.

### 자동화 우선

개발자가 반복적으로 해야 하는 작업들을 프레임워크가 자동으로 처리합니다:
- 라우트 파일 자동 탐색 및 등록
- 타입 정의 자동 생성
- 데이터베이스 연결 자동 관리

## 기본 사용법

### 프로젝트 시작하기

1. **프로젝트 클론 및 설치**:
```bash
git clone <repository-url>
cd express.js-kusto
npm install
```

2. **환경 설정**:
```bash
cp .env.template .env
# .env 파일을 열어서 필요한 설정 입력
```

3. **개발 서버 실행**:
```bash
npm run dev
```

4. **브라우저에서 확인**:
- http://localhost:3000 접속

## 프로젝트 구조와 관례

### 폴더 구조

```
src/
├── core/                    # 프레임워크 핵심 (건드리지 않음)
│   ├── Application.ts       # 앱 시작점
│   ├── Core.ts             # 내부 시스템
│   ├── lib/                # 핵심 기능들
│   └ ...                   
└── app/                    # 개발자가 작업하는 영역
    ├── routes/             # API 서비스 엔드포인트 (.ts 파일)
    ├── views/              # HTML 템플릿 (.ejs 파일)
    ├── db/                 # 데이터베이스 스키마
    ├── repos/              # 리포지터리
    └── injectable/         # 의존성 묶음

```

### 핵심 관례들

#### 1. 라우트 파일 관례

`app/routes/` 폴더에 다음 파일들을 만들 수 있습니다:

```
app/routes/
├── route.ts              # 루트 경로 (/)
├── middleware.ts         # 루트 미들웨어
└── authorities/
    └── signin/
        └── route.ts      # /authorities/signin 경로
```

- **폴더 구조** = **URL 경로**: 폴더명이 그대로 URL이 됩니다
- **route.ts**: 실제 API 엔드포인트 정의
- **middleware.ts**: 해당 경로의 미들웨어 정의

*자세한 라우팅 방법은 [라우팅 시스템 문서](./02-routing-system.md)에서 설명합니다.*

#### 2. 데이터베이스 관례

`app/db/` 폴더에 각 데이터베이스별로 폴더를 만듭니다:

```
app/db/
├── user/                 # 사용자 데이터베이스
│   ├── schema.prisma     # Prisma 스키마 (모델 정의)
│   └── client/           # 자동 생성된 클라이언트
└── temporary/            # 임시 데이터베이스
    ├── schema.prisma
    └── client/
```

**데이터베이스 구성**: 
- **각 폴더 = 하나의 데이터베이스**: 폴더명이 데이터베이스 식별자가 됩니다
- **schema.prisma**: 데이터 모델(테이블 구조)만 정의합니다
- **client/**: Prisma가 자동 생성한 타입 안전한 클라이언트입니다
- **비즈니스 로직 분리**: 실제 데이터 조작 로직은 Repository에서 담당합니다

#### 3. 템플릿 관례

`app/views/` 폴더의 `.ejs` 파일들이 자동으로 템플릿 엔진에 등록됩니다.

#### 4. Injectable 관례

`app/injectable/` 폴더에는 의존성 주입을 위한 모듈들을 구성합니다:

```
app/injectable/
├── auth/                 # 인증 관련 모듈
│   ├── jwt/             # JWT 토큰 처리
│   ├── csrf/            # CSRF 보호
│   └── rateLimiter/     # 요청 제한
└── ...                  # 기타 모듈들
```

Injectable에서는 라우터에서 사용할 외부 의존성 코드나 미들웨어, 미들웨어에서 사용할 각 파라미터 정의를 모듈 형식으로 구성할 수 있습니다.
이는 모두 폴더 및 파일 명칭을 기반으로 한 camelCase 형식으로 키워드가 생성되며, `route.ts`에서 직접 사용할 수 있습니다.
import 구문 없이도 폴더 구조가 자동으로 키워드로 변환되어 접근 가능하며, **타입이 완전히 지원되어 에디터에서 간편히 호출할 수 있습니다**.

#### 5. Repository 관례

`app/repos/` 폴더에는 데이터 액세스 레이어를 구성합니다:

```
app/repos/
├── account/             # 계정 관련 리포지터리
│   ├── user.repository.ts
│   ├── user.types.ts
│   └── types.ts
└── ...                  # 기타 도메인별 리포지터리
```

**DB와 Repository 관계**:
- **1:1 관계**: 하나의 DB에 하나의 Repository (예: `user` DB → `account/user.repository.ts`)
- **1:n 관계**: 하나의 DB에 여러 Repository (예: `user` DB → `account/user.repository.ts`, `profile/user.repository.ts`)
- **역할 분리**: 
  - **DB 폴더**: 데이터 구조(스키마)와 클라이언트만 관리
  - **Repository**: 실제 비즈니스 로직과 데이터 조작 처리

각 리포지터리는 특정 도메인의 데이터 조작을 담당하며, 비즈니스 로직과 데이터베이스 액세스를 분리합니다.
폴더 구조나 파일명에 따라 camelCase로 키워드가 자동 생성되며, routes 폴더의 라우터에서 import 없이 직접 호출하여 사용할 수 있습니다.
**타입이 완전히 지원되어 에디터에서 간편히 호출할 수 있습니다**.

## 서버 시작 시 자동 실행

`npm run dev`를 실행하면 다음이 자동으로 일어납니다:

1. **환경 설정 확인**: `.env` 파일 로드
2. **데이터베이스 연결**: `app/db/` 폴더의 Prisma 클라이언트 자동 초기화
3. **리포지터리 로드**: `app/repos/` 폴더의 리포지터리 자동 등록
4. **의존성 주입**: `app/injectable/` 폴더의 모듈/미들웨어 로드
5. **Express 설정**: 미들웨어 체인 구성
6. **라우트 탐색 및 등록**: `app/routes/` 폴더 구조에 따라 URL 경로 자동 생성
7. **서버 실행**: 지정된 포트에서 HTTP 서버 시작



## 핵심 특징

### 1. Convention over Configuration (CoC) 패러다임

**Ruby on Rails**에서 유명해진 설계 원칙을 따릅니다. 복잡한 설정 파일 없이 폴더 구조가 곧 URL 경로가 되는 관례 기반 시스템입니다.

```
app/routes/api/users/route.ts       → GET /api/users          (완전 자동)
app/db/default/schema.prisma        → DB 'default' 자동 등록   (완전 자동)
app/repos/user.repository.ts        → repo.getRepository('user') (codegen 필요)
app/injectable/auth/jwt/export.module.ts → injected.authJwtExport   (codegen 필요)
```

라우팅과 DB 발견은 **제로 설정**(파일 배치만으로 동작)이며, Repository와 DI는 **관례 + 코드 생성** 방식으로 동작합니다. 자세한 수준별 구분은 [관례 적용 수준](#관례-적용-수준) 표를 참고하세요.

### 2. Multi-tenant Architecture (멀티 테넌트 아키텍처)

**SaaS 애플리케이션**에서 사용하는 패턴으로, 하나의 애플리케이션에서 여러 데이터베이스를 동시 관리합니다. 

```
app/db/user/ → 사용자 데이터베이스 (스키마 + 클라이언트)
app/db/analytics/ → 분석 데이터베이스 (스키마 + 클라이언트)
app/db/logs/ → 로그 데이터베이스 (스키마 + 클라이언트)
```

**설계 원칙**:
- **DB 폴더**: 순수 데이터 구조 정의 (Prisma 스키마 + 자동 생성 클라이언트)
- **Repository**: 실제 비즈니스 로직과 데이터 조작 처리
- **관계**: DB와 Repository는 1:1 또는 1:n 관계로 유연하게 구성 가능

### 3. Dependency Injection (의존성 주입) + Auto-wiring

**Spring Framework**의 핵심 개념인 의존성 주입을 TypeScript 환경에 적용했습니다. 폴더 구조 기반으로 자동 타입 생성 및 Auto-wiring을 지원합니다.

### 4. Code Generation (코드 자동 생성)

**GraphQL Code Generator**나 **Prisma Client**처럼 Repository, Injectable 폴더를 기반으로 TypeScript 타입을 자동 생성합니다. 폴더명과 파일명이 camelCase 키워드로 변환되어 IntelliSense 지원됩니다.

### 5. Zero Runtime Dependencies Import

**Deno**의 철학을 차용하여 런타임에서 import 구문 없이 모든 의존성에 접근할 수 있습니다. 컴파일 타임에 의존성 그래프가 구성되어 타입 안전성을 보장합니다.

### 6. File-based Routing + Auto-discovery

**Next.js**의 파일 기반 라우팅과 **NestJS**의 Auto-discovery를 결합했습니다. 서버 시작 시 자동으로 라우트, 미들웨어, 리포지터리를 스캔하고 등록합니다.





---

## 📖 문서 네비게이션

**◀️ 이전**: [📋 문서 색인](./00-documentation-index.md)  
**▶️ 다음**: [🛣️ 라우팅 시스템](./02-routing-system.md)
