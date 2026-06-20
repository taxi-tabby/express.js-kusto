# data/di/ - Dependency Injection & Resource Facade

injectable 모듈/미들웨어를 동적 로드하고, 라우트 핸들러가 쓰는 `req.kusto` 파사드를 통해 모듈·리포지터리·DB 클라이언트에 통합 접근을 제공하는 티어.

## Structure

```
di/
├── dependencyInjector.ts   # *.module.ts / *.middleware.ts 동적 로드 (pathToCamelCaseIdentifier)
└── kustoManager.ts         # req.kusto 파사드 (injected / repo / db 프록시)
```

## Files

### `dependencyInjector.ts`
- **책임**: 생성된 `MODULE_REGISTRY`/`MIDDLEWARE_REGISTRY`를 순회해 `*.module.ts`(서비스 클래스 → 인스턴스화)와 `*.middleware.ts`(팩토리 함수 → 실행해 미들웨어 객체 생성)를 동적 import 한다. 다양한 export 패턴(default/named/생성자)을 해석하며, 파일 경로를 camelCase 식별자로 변환한다(예: `auth/jwt/export.module.ts` → `authJwtExport`). 싱글톤.
- **주요 export**: `function pathToCamelCaseIdentifier(filePath)`, `class DependencyInjector`(`getInstance`, `initialize`, `getInjectedModules`, `getInjectedMiddlewares`, `getModule`, `getMiddleware`, `registerModule`, `registerMiddleware`, `clear`).
- **의존**: `@lib/types/generated-injectable-types`(`Injectable`/`Middleware`/`MODULE_REGISTRY`/`MIDDLEWARE_REGISTRY`/`ModuleName`/`MiddlewareName`), `@ext/winston`.

### `kustoManager.ts`
- **책임**: 프레임워크 중앙 파사드(`req.kusto`). 주입된 모듈은 `injectable` getter, 리포지터리는 `repo` Proxy, DB 클라이언트는 `db` Proxy로 노출하며, Proxy 내부는 항상 live 상태(`repositoryManager.hasRepository`/`prismaManager.isConnected`)를 확인한다. `db` 프록시는 동적 DB 이름 접근(`kusto.db.user`)과 `getClient`/`getClientSync`/`getWrap`/`status`/`healthCheck`를 제공한다. 싱글톤.
- **주요 export**: `class KustoManager`(`getInstance`, getter `injectable`/`repo`/`db`, `getModule`, `getRepository`, `getDbClient`, `getDbClientSync`), `const kustoManager`(싱글톤), `interface KustoDbProxy`.
- **의존**: `@lib/data/di/dependencyInjector`(모듈 접근), `@lib/data/database/repositoryManager`(리포지터리 프록시), `@lib/data/database/prismaManager`(DB 프록시), `@lib/types/generated-injectable-types`·`generated-repository-types`·`generated-db-types`.

## Import note

정규 import 경로는 `@lib/data/di/<file>` 형태다 (단일 `@lib` 루트, 경로만 깊어짐).
예: `@lib/data/di/dependencyInjector`, `@lib/data/di/kustoManager`.

- 인바운드: `Core` 초기화가 `DependencyInjector.initialize()`를 호출하고, Core 소유 필수 미들웨어 `kustoInitMiddleware`(`@lib/http/routing/frameworkMiddleware`)가 모든 요청에 `req.kusto = kustoManager`(싱글톤)를 주입한다. 라우트 핸들러는 `req.kusto`로 모듈/리포지터리/DB에 접근한다.
- 아웃바운드: 같은 data 티어의 `database/` 서브 티어(`prismaManager`/`repositoryManager`)와 생성 타입(`@lib/types/generated-*`), 로깅(`@ext/winston`)에 의존한다. 상위 라우팅/문서 티어를 역참조하지 않는다.
