# bootstrap/ - 애플리케이션 부트스트랩 / 생명주기 오케스트레이션

프레임워크의 부팅 진입점 계층. 매니저(Prisma → Repository → DI)를 순차 초기화하고 Express 미들웨어·라우트·문서·헬스체크를 등록한 뒤 HTTP 서버 생명주기(start/stop/restart)를 관리한다.

## Structure

```
bootstrap/
├── Core.ts                    # 부트스트랩 오케스트레이터 싱글톤 (초기화 순서 + 서버 생명주기 + /healthz)
├── Application.ts             # Core 를 감싸는 얇은 파사드 (start/stop/restart, createApplication)
└── expressAppSingleton.ts     # DEPRECATED: 레거시 express() 싱글톤 (제거 예정)
```

## Core.ts

부팅의 핵심 오케스트레이터. `expressApp.getApp()` 으로 받은 Express 인스턴스를 보유하고, 매니저 초기화 → Express 설정 → 라우트/문서/헬스체크 등록 → 서버 listen 까지의 전체 순서를 통제한다.

- **주요 export**
  - `Core` 클래스 (싱글톤; `Core.getInstance()`), `export default Core.getInstance()`.
  - `interface CoreConfig` — `basePath`/`routesPath`/`viewsPath`/`viewEngine`/`port`/`host`/`trustProxy`.
  - `function resolveServerDefaults(): { port; host }` — `process.env.PORT`/`HOST` 의 fallback('3000'/'0.0.0.0')을 단일 출처로 해석. `Core.getDefaultConfig()` 와 `src/index.ts` 양쪽에서 호출.
- **초기화 순서** (`initialize()`): `initializePrismaManager()` → `initializeRepositoryManager()` → `initializeDependencyInjector()` → `setupExpress()` → `setupHealthCheck()` → `setupDocumentationRoutes()` → `loadRoutes()` → `setupViews()` → Schema API 등록.
- **degraded/readiness (P0-1)**: DB 연결 실패는 non-fatal(서버리스 lazy-reconnect 전제)이지만 `_degraded` 에 기록한다. Repository/DI 초기화의 top-level throw 는 fail-fast. `getReadiness()` 가 미생성(`generated=false`) DB 를 제외한 연결 상태로 healthy/degraded 를 판정하고, `setupHealthCheck()` 가 `/healthz` 를 글로벌 라우트보다 먼저 등록(정상 200 / degraded 503).
- **생명주기**: `start()`(미초기화 시 listen 전 `initialize()` 보장), `stop()`(먼저 `prismaManager.disconnectAll()` 후 서버 close), `restart()`. getter: `app`/`server`/`config`/`isInitialized`/`isRunning`.
- **의존**:
  - `@core/bootstrap/expressAppSingleton` (Express 인스턴스 소스)
  - `@lib/http/routing/loadRoutes_V6_Clean` (라우트 자동 등록)
  - `@lib/data/database/prismaManager`, `@lib/data/database/repositoryManager`, `@lib/data/di/dependencyInjector` (매니저 초기화)
  - `@lib/devtools/documentation/documentationGenerator`, `@lib/devtools/documentation/staticFileMiddleware`, `@lib/devtools/schema-api/schemaApiSetup` (개발 전용 — `AUTO_DOCS`/`ENABLE_SCHEMA_API` 게이트)
  - `@ext/winston`(log), `@ext/util`(getElapsedTimeInString), `express`, `http`, `path`

## Application.ts

`Core` 싱글톤을 감싸는 얇은 사용자 대면 파사드. 매니저 초기화 디테일을 숨기고 직관적인 `start/stop/restart` 인터페이스만 노출한다.

- **주요 export**
  - `Application` 클래스 — 생성자에서 `Core.getInstance()` 를 잡고 `Partial<CoreConfig>` 를 보관. `start()`(= `core.initialize(config)` 후 `core.start()`), `stop()`, `restart()`, `use(...handlers)`(임의 미들웨어 추가). getter: `express`/`server`/`configuration`/`isRunning`. `getHealthStatus()` 는 `core.getReadiness()` 를 반영해 `healthy`/`degraded`/`stopped` + uptime/memory/version/config 를 반환.
  - `function createApplication(config?): Application` — 간단 사용을 위한 팩토리.
- **의존**: `@core/bootstrap/Core`(`Core`, `CoreConfig`), `@ext/winston`(log), `express`/`http`(타입). Core 외 다른 lib 계층에는 직접 의존하지 않는다 — 모든 동작을 Core 에 위임한다.

## expressAppSingleton.ts

**DEPRECATED.** 레거시 호환을 위해 남은 `express()` 싱글톤 래퍼로, 제거 대상이다.

- **주요 export**: `default` 로 `AppSingleton.getInstance()` 인스턴스. `AppSingleton` 클래스는 단일 `Express` 인스턴스를 생성·보유하며 `getApp(): Express` 를 제공. 생성 시 `log.Warn` 으로 deprecation 경고를 출력.
- **현재 역할**: 신규 코드는 `Core`/`Application` 을 사용해야 하지만, 아직 `Core.ts` 가 부팅 시 이 싱글톤을 통해 Express 인스턴스를 획득한다(유일한 정상 인바운드 사용처). 신규 import 금지.
- **의존**: `express`, `@ext/winston`(log). 다른 계층에 의존하지 않는 잎(leaf) 모듈.

## Import 규약 / 계층 방향

- 정식 import 경로는 `@lib/<tier-path>/<file>` 패턴을 따르지만, 이 부트스트랩 계층은 `@core` 루트 아래에 있어 `@core/bootstrap/<file>` 로 import 한다(`@lib` = `src/core/lib`, `@core` = `src/core`).
- **아웃바운드(이 계층이 의존하는 곳)**: `bootstrap` 은 최상위 조립 계층으로 아래쪽 `@lib/data/*`(DB/DI 매니저), `@lib/http/routing/*`(라우트 로더), `@lib/devtools/*`(개발 전용 문서/스키마)와 `@ext/*`(winston/util)에 의존한다.
- **인바운드(이 계층에 의존하는 곳)**: 프로세스 진입점 `src/index.ts` 가 `Application`/`Core` 와 `resolveServerDefaults()` 를 소비한다. 즉 의존 방향은 `index.ts → bootstrap → lib/* → ext/*` 로 단방향이며, `bootstrap` 위로 역참조하는 lib 모듈은 없다.
