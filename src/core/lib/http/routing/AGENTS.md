# routing/ - 라우팅 (Route Builder · Auto-Discovery · Middleware · Proxy)

fluent 라우트 빌더, 폴더 컨벤션 기반 라우트 자동 디스커버리, 프레임워크 미들웨어 래핑, 의존성 없는 리버스 프록시를 제공하는 http 티어의 진입 하위 티어.

## Structure

```
routing/
├── expressRouter.ts          # fluent 라우트 빌더 (공개 API, ExpressRouter 클래스)
├── loadRoutes_V6_Clean.ts    # route.ts/middleware.ts 자동 디스커버리 + 마운트
├── middlewareHelpers.ts      # 6-arg 프레임워크 미들웨어 → Express RequestHandler 래핑
└── proxyMiddleware.ts        # http/https 기반 zero-dep 리버스 프록시
```

## Files

### expressRouter.ts
프레임워크의 핵심 공개 라우팅 API. 메서드 체이닝으로 라우트를 정의하고 마지막에 `build()` 로 Express `Router` 를 반환한다.

- **주요 export**:
  - `class ExpressRouter` — 생성자 `new ExpressRouter({ tag?, description? })`. 메서드:
    - HTTP verb: `GET` / `POST` / `PUT` / `PATCH` / `DELETE` / `NOTFOUND`
    - `_SLUG` 변형: `GET_SLUG` / `POST_SLUG` / `PUT_SLUG` / `PATCH_SLUG` / `DELETE_SLUG` (+ `MIDDLE_PROXY_ROUTE_SLUG` / `STATIC_SLUG`)
    - `_VALIDATED` 계열: `GET_VALIDATED` / `POST_VALIDATED` / `PUT_VALIDATED` / `PATCH_VALIDATED` / `DELETE_VALIDATED` 및 각 `_SLUG_VALIDATED`(+ `_EXACT`) 변형
    - 파일 업로드(multer): `POST_SINGLE_FILE` / `POST_ARRAY_FILE` / `POST_FIELD_FILE` / `POST_ANY_FILE` (PUT 동형)
    - 미들웨어: `WITH(name, params?)` / `MIDDLEWARE(fn)` / `USE(fn)` / `USE_HANDLER(fn)`
    - 프록시/정적: `MIDDLE_PROXY_ROUTE(options)` / `STATIC(path, options?)`
    - CRUD: `CRUD(dbName, modelName, options?)` — JSON:API v1.1 엔드포인트 생성
    - `build(): Router`
  - 타입: `HandlerFunction`, `ValidatedHandlerFunction`, `MiddlewareHandlerFunction`, `ValidatedMiddlewareHandlerFunction`, `RouteDocOptions`
  - re-export: `middlewareHelpers` 의 `MiddlewareHandler` / `ValidatedMiddlewareHandler` / `wrapMiddleware` / `wrapValidatedMiddleware` / `wrapMiddlewares` / `wrapValidatedMiddlewares` / `injectedMiddleware`
- **의존**: `@lib/http/routing/proxyMiddleware`(프록시), `@lib/http/routing/middlewareHelpers`(래핑/내부 위임), `@lib/http/validation/requestHandler`(`_VALIDATED` 엔진), `@lib/http/serialization/serializer`(`serialize`/`applyResponseSerializer`/`ResponseSerializer`), `@lib/http/errors/errorCodes` · `errorFormatter` · `errorHandler`, `@lib/crud/*`(CRUD 빌더/헬퍼/PK 파서/JSON:API 상수), `@lib/data/di/*` · `@lib/data/database/*`(DI/prisma/repo), `@lib/devtools/documentation` · `@lib/devtools/schema-api/*`(dev 전용 문서/스키마 등록), `@lib/types/generated-*` · `@lib/types/express-extensions`, `@ext/winston`, `multer`.

### loadRoutes_V6_Clean.ts
부트스트랩 시 라우트 디렉터리를 스캔하여 `route.ts`/`middleware.ts` 를 발견하고, 폴더 구조를 URL 경로로 변환해 Express 앱에 마운트한다. webpack 빌드 환경에서는 빌드 타임 생성 라우트 맵(`@core/tmp/routes-map`)을 사용한다.

- **주요 export**:
  - `default loadRoutes(app: Express, dir?: string): Promise<void>` — 라우트 자동 디스커버리/마운트 진입점
  - `convertFolderToUrlSegment(folder): string` — `[^name]` → `:name([^/]+)`, `[name]` → `:name`, 그 외 그대로 (regex → dynamic → namedParam 우선순위, `ROUTE_PATTERNS` 사용)
  - `clearCache(): void` — 미들웨어/라우트/파일존재/모듈해석 캐시 초기화
- **의존**: `@ext/winston`(로깅), `@ext/util`(`normalizeSlash`/`getElapsedTimeInString`), `@lib/devtools/documentation/documentationGenerator`(dev 문서 수집), Node `fs`/`path`. 마운트되는 라우트는 `expressRouter` 가 만든 `Router` 인스턴스다.

### middlewareHelpers.ts
프레임워크 6-arg 미들웨어 시그니처(`req,res,next,injected,repo,db`)를 표준 Express 미들웨어로 래핑하는 단일 출처 헬퍼. async 거부를 `next(error)` 로 전달하고 double-next 를 가드한다.

- **주요 export**:
  - 타입 `MiddlewareHandlerFunction`, `ValidatedMiddlewareHandlerFunction`
  - `wrapMiddleware(handler)` / `wrapValidatedMiddleware(handler)` — 단건 래핑(`RequestHandler` 반환), `req.kusto` 설정 + DI 모듈 주입
  - `wrapMiddlewares(handlers)` / `wrapValidatedMiddlewares(handlers)` — 배열 래핑
  - `injectedMiddleware(fn)` — `__kustoInjected` 브랜딩. `WITH()` 의 `fn.length >= 6` arity 휴리스틱 오분류(기본값/rest 파라미터)를 우회한다.
- **의존**: `@lib/data/di/dependencyInjector`(`DependencyInjector`), `@lib/data/di/kustoManager`(`kustoManager`), `@lib/data/database/prismaManager` · `repositoryManager`, `@lib/http/validation/requestHandler`(`ValidatedRequest` 타입), `@lib/types/generated-injectable-types`(`Injectable`).

### proxyMiddleware.ts
외부 의존성 없이 Node `http`/`https` 만으로 구현한 리버스 프록시 미들웨어 팩토리. hop-by-hop 헤더 제거, `X-Forwarded-*` 세팅(실제 TCP peer 사용), 본문 재직렬화(body-parser 소비 시 content-type 대칭), 타임아웃/실패의 단일 settle 처리를 담당한다.

- **주요 export**:
  - `interface ProxyOptions` — `target`(필수), `changeOrigin?`, `pathRewrite?`, `headers?`, `secure?`, `timeout?`, `onProxyReq?`/`onProxyRes?`/`onError?`
  - `createProxyMiddleware(options): RequestHandler` — 잘못된 `target` 은 부트스트랩 시 fail-fast(throw)
- **의존**: `@ext/winston`(업스트림 실패 로깅), `@lib/http/errors/errorCodes`(`ERROR_CODES`/`getHttpStatusForErrorCode` — 502/504 매핑), Node `http`/`https`/`url`, `qs`(폼 본문 재직렬화).

## Import 규약

- 정규 import 경로: `@lib/http/routing/<file>` (예: `@lib/http/routing/expressRouter`).
- **아웃바운드(레이어 방향)**: routing → `@lib/http/validation` → `@lib/http/serialization`, 그리고 routing/proxy → `@lib/http/errors`. 또한 `@lib/crud/*`, `@lib/data/*`, dev 전용 `@lib/devtools/*` 로 나간다.
- **인바운드**: `loadRoutes` 는 `src/core/Core.ts` 가, `ExpressRouter` 는 `src/app/routes/**/route.ts` 가 소비한다.
