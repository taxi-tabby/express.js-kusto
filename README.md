# Express.js-Kusto

Express.js 기반 TypeScript 백엔드 프레임워크. **Convention over Configuration** 으로 REST API 를 빠르게 구성한다.

## 주요 기능

- **컨벤션 기반 라우팅** — `src/app/routes/` 폴더 구조가 그대로 URL 경로로 매핑되고, `ExpressRouter` 의 플루언트 API 로 핸들러를 정의
- **멀티 DB (Prisma)** — `src/app/db/{name}/` 폴더마다 독립 DB, `npm run db` CLI 로 generate/migrate/studio 관리
- **의존성 주입 & 리포지터리** — `src/app/injectable/`, `src/app/repos/` 자동 탐색 + 타입 생성
- **JSON:API v1.1 CRUD 자동 생성** — `router.CRUD('db', 'model')` 한 줄로 필터·정렬·페이지네이션·관계 포함 엔드포인트 생성
- **확장 시스템 (CoC)** — 코어 수정 없이 `ExpressRouter` 메서드 / 라이프사이클 / 빌드 훅 추가
- **개발 도구** — `AUTO_DOCS` 활성화 시 `/docs` OpenAPI 문서, `kusto monitor` htop 형 실시간 대시보드, `/api/schema` 스키마 인트로스펙션

## 빠른 시작 (권장) — `create-kusto-app`

새 프로젝트는 스캐폴더 [`create-kusto-app`](https://www.npmjs.com/package/create-kusto-app) 로 생성하는 것을 권장한다. 패키지 매니저별로 다음 중 하나를 사용한다:

```bash
npm create kusto-app@latest my-app
npx create-kusto-app my-app
pnpm create kusto-app my-app
yarn create kusto-app my-app
```

### 옵션

| 플래그 | 설명 |
|--------|------|
| `--react` | React 확장(`@expressjs-kusto/react`) 사전 통합 |
| `--no-install` | 의존성 설치 건너뛰기 |
| `--no-git` | git 저장소 초기화 건너뛰기 |
| `--pm <npm\|pnpm\|yarn>` | 패키지 매니저 지정 (기본: 자동 감지) |
| `--ref <branch\|tag>` | 템플릿 git 레퍼런스 선택 (기본: `main`) |
| `-y, --yes` | 프롬프트 없이 기본값 사용 |
| `-h, --help` | 도움말 |
| `-v, --version` | 버전 출력 |

생성 후:

```bash
cd my-app
cp .env.template .env        # 환경 설정 (--no-install 사용 시 의존성도 설치)
npm run dev                  # 개발 서버 실행
```

## 수동 설치 (이 리포지터리 직접 클론)

프레임워크 자체를 개발하거나 직접 클론해서 시작하려면:

```bash
git clone <repository-url>
cd express.js-kusto
npm install

cp .env.template .env        # 환경 설정 (.env.dev / .env.prod 오버라이드 가능)
```

### DB 준비 후 실행

`src/app/db/{name}/` 폴더의 Prisma 스키마와 `.env` 의 `{FOLDER}__KUSTO_RDB_URL` 연결 정보를 확인한 뒤:

```bash
npm run db -- generate --all                          # 모든 Prisma client 생성
npm run db -- migrate -t dev -n "init" -d <db이름>     # 스키마 마이그레이션 (또는 push -d <db이름>)
npm run dev                                           # 개발 서버 실행 (generate + nodemon)
```

## 최소 예제

`src/app/routes/users/route.ts` → `GET /users`, `POST /users`:

```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter';

const router = new ExpressRouter({ tag: 'Users', description: 'User management' });

router
    .GET(async (req, res, injected, repo, db) => {
        res.json({ message: 'list users' });
    })
    // JSON:API v1.1 CRUD 엔드포인트 일괄 생성
    .CRUD('default', 'User');

export default router.build();
```

핸들러는 `(req, res, injected, repo, db)` 5개 인자를 받으며, `req.kusto` 로 모듈·리포지터리·DB 클라이언트에 통합 접근한다.

## 개발 도구

개발 서버 실행 후 (`npm run dev`, `NODE_ENV=development`) 다음에서 확인:

- **API 문서** (`AUTO_DOCS=true`): http://localhost:3000/docs
- **개발 대시보드**: http://localhost:3000/docs/dev
- **OpenAPI 스펙**: http://localhost:3000/docs/openapi.json
- **CRUD 스키마 API** (`ENABLE_SCHEMA_API=true`): http://localhost:3000/api/schema
- **실시간 모니터**: 별도 터미널에서 `npx kusto monitor`

## 올인원 풀 템플릿 (백엔드 + React)

프론트엔드까지 하나의 리포지터리로 함께 운영하고 싶다면 풀 템플릿을 사용하거나, 위 스캐폴더에 `--react` 플래그를 주면 된다:

```bash
npm create kusto-app@latest my-app -- --react
```

**→ [taxi-tabby/express.js-kusto-template-full](https://github.com/taxi-tabby/express.js-kusto-template-full)**

이 프레임워크에 **React 프론트엔드 확장**을 사전 통합한 올인원 스타터다. 백엔드 API 와 React 프론트엔드를 별도 구성 없이 단일 프로젝트로 시작할 수 있어, 프론트·백엔드를 한 리포지터리로 묶고 싶은 팀/조직에 적합하다. 백엔드 프레임워크만 필요하다면 이 리포지터리(또는 `create-kusto-app`)를 그대로 사용하면 된다.

## 문서

자세한 사용법은 [문서 색인](./docs/00-documentation-index.md)을 참고하세요.

| # | 문서 |
|---|------|
| 1 | [핵심 아키텍처](./docs/01-core-architecture.md) |
| 2 | [라우팅 시스템](./docs/02-routing-system.md) |
| 3 | [데이터베이스 관리](./docs/03-database-management.md) |
| 4 | [의존성 주입 시스템](./docs/04-injectable-system.md) |
| 5 | [리포지터리 패턴](./docs/05-repository-pattern.md) |
| 6 | [CRUD 라우터](./docs/06-crud-router.md) |
| 7 | [업데이트 시스템](./docs/07-update-system.md) |
| 8 | [CRUD 스키마 API](./docs/08-crud-schema-api.md) |
| 9 | [실시간 모니터](./docs/09-dev-monitor.md) |
| 10 | [확장 시스템](./docs/10-extension-system.md) |

> 일괄 포맷 커밋이 `git blame`을 가리지 않도록: `git config blame.ignoreRevsFile .git-blame-ignore-revs`

## 테스트

```bash
npm test                    # 전체
npm run test:unit           # 단위만 (빠름)
npm run test:integration    # 통합 (sqlite 부팅)
npm run test:cli            # CLI 만
npm run test:coverage       # 커버리지 리포트
```

기본 백엔드는 SQLite — 워커별 임시 파일 `node_modules/.prisma/test-sqlite-{worker}.db` 를 사용한다. PostgreSQL 로 검증하려면 `KUSTO_TEST_DB=postgres npm test`.

## 라이선스

ISC
