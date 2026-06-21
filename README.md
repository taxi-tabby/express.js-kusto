# Express.js-Kusto

Express.js 기반 TypeScript 백엔드 프레임워크. Convention over Configuration 으로 REST API 를 빠르게 구성한다.

## 주요 기능

- **컨벤션 기반 라우팅** — `src/app/routes/` 폴더 구조가 그대로 URL 경로로 매핑되고, `ExpressRouter` 의 플루언트 API 로 핸들러를 정의
- **멀티 DB (Prisma)** — `src/app/db/{name}/` 폴더마다 독립 DB, `npm run db` CLI 로 generate/migrate/studio 관리
- **의존성 주입 & 리포지터리** — `src/app/injectable/`, `src/app/repos/` 자동 탐색
- **JSON:API v1.1 CRUD 자동 생성** — `router.CRUD('db', 'model')` 로 필터·정렬·페이지네이션·관계 포함 엔드포인트 생성
- **확장 시스템 (CoC)** — 코어 수정 없이 `ExpressRouter` 메서드/라이프사이클/빌드 훅 추가
- **개발 도구** — `AUTO_DOCS` 활성화 시 `/docs` OpenAPI 문서, `kusto monitor` htop 형 실시간 대시보드

## 시작하기

```bash
# 설치
git clone <repository-url>
cd express.js-kusto
npm install

# 환경 설정
cp .env.template .env

# 개발 서버 실행
npm run dev
```

## 올인원 풀 템플릿 (백엔드 + React)

프론트엔드까지 하나의 리포지터리로 함께 운영하고 싶은 조직이라면 풀 템플릿을 사용하세요:

**→ [taxi-tabby/express.js-kusto-template-full](https://github.com/taxi-tabby/express.js-kusto-template-full)**

이 프레임워크에 **React 프론트엔드 확장**을 사전 통합한 올인원 스타터다. 백엔드 API 와 React 프론트엔드를 별도 구성 없이 단일 프로젝트로 시작할 수 있어, 프론트·백엔드를 한 리포지터리로 묶고 싶은 팀/조직에 적합하다. 백엔드 프레임워크만 필요하다면 이 리포지터리를 그대로 사용하면 된다.

## 문서

자세한 사용법은 [문서](./docs/00-documentation-index.md)를 참고하세요.

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
