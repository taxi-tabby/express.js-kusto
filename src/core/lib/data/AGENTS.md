# data/ - Persistence Tier

프레임워크의 영속성 계층. 멀티 DB Prisma 클라이언트 관리, 리포지터리 기반 데이터 접근, 의존성 주입을 묶은 상위 티어이며 두 개의 서브 티어로 구성된다.

## Structure

```
data/
├── database/   # Prisma 멀티 DB 관리 · 리포지터리 베이스 · 분산 트랜잭션 · DB 네이밍 SSOT
└── di/         # injectable 모듈/미들웨어 로더(DependencyInjector) · req.kusto 파사드(KustoManager)
```

## Sub-tiers

- **`database/`** — `PrismaManager`(멀티 DB 싱글톤, `getWrap` 자동 재연결), `BaseRepository`(리포지터리 추상 베이스), `RepositoryManager`(생성된 레지스트리에서 리포지터리 로드), `TransactionCommitManager`(Saga/보상 트랜잭션), `dbNaming`(폴더명→환경변수 변환 단일 출처). 세부는 `database/AGENTS.md` 참고.
- **`di/`** — `DependencyInjector`(`*.module.ts`/`*.middleware.ts` 동적 로드), `KustoManager`(`req.kusto` 파사드로 injected/repo/db 프록시 제공). 세부는 `di/AGENTS.md` 참고.

## Layering

- 인바운드: `Core` 초기화 시퀀스가 `PrismaManager → RepositoryManager → DependencyInjector` 순으로 호출하고, 라우트 핸들러는 `KustoManager`(`req.kusto`)를 통해 이 티어에 접근한다. 앱 코드의 `src/app/repos/*`는 `@lib/data/database/baseRepository`를 상속한다.
- 아웃바운드: 생성 타입(`@lib/types/generated-*`)과 로깅(`@ext/winston`)에만 의존한다. 상위 라우팅/문서 티어를 역참조하지 않는다.

## Import note

정규 import 경로는 `@lib/data/<sub-tier>/<file>` 형태다 (단일 `@lib` 루트, 경로만 깊어짐).
예: `@lib/data/database/prismaManager`, `@lib/data/di/kustoManager`.
