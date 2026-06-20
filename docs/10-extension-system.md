# 🧩 확장 시스템 (Extension System)

> **코어를 건드리지 않고 프레임워크 기능을 확장**
> 별도 패키지로 배포되는 확장(extension)을 CoC 폴더에 한 줄로 활성화하면, `ExpressRouter`에 새 메서드가 **타입까지** 들어옵니다. 사용하지 않으면 의존성·타입 모두 0입니다.

## 개요

확장 시스템은 `src/core`를 수정하지 않고 다음을 추가할 수 있게 합니다.

1. **ExpressRouter 메서드** — 예: `router.GET_REACT('pages/Home')`
2. **Core 라이프사이클 훅(`onInit`)** — 미들웨어·정적 라우트·서비스 등록
3. **빌드 훅(`onBuild`)** — 에셋 번들 등 빌드 참여

확장은 **별도 npm 패키지**로 배포되고, 소비 프로젝트의 `src/app/extensions/`에 둔 **얇은 활성화 파일** 하나로 켜집니다. 설치/활성화하지 않으면 의존성 트리·타입 그래프에 아무것도 추가되지 않습니다.

## 사용자: 확장 활성화

확장 패키지를 설치한 뒤, 활성화 파일을 하나 만듭니다.

```typescript
// src/app/extensions/react.ts  — 한 줄 활성화
import { react } from '@kusto/react';
export default react({ /* options */ });
```

이 `import` 가 확장 패키지의 타입 보강(`.d.ts`)을 함께 끌어오므로, 이후 어느 `route.ts`에서나 새 메서드가 **IDE IntelliSense 에 노출**됩니다.

```typescript
// 어느 route.ts 든
const router = new ExpressRouter();
router.GET_REACT('pages/Home');   // 타입 인식 + 자동완성
export default router.build();
```

규칙:

- `src/app/extensions/*.ts` 만 로드됩니다(`index`, `AGENTS`, `*.d.ts` 는 제외).
- 파일명 순서로 로드되며, default export 는 유효한 `KustoExtension` 이어야 합니다(아니면 부팅이 명확한 에러로 중단).
- 폴더가 없거나 비어 있으면 아무 일도 일어나지 않습니다(no-op).

## 작성자: 확장 만들기

확장은 `defineExtension(...)` 으로 정의한 `KustoExtension` 객체를 default export 하는 별도 패키지입니다.

```typescript
import { defineExtension } from '@core/index';

export function react(options?: ReactExtensionOptions) {
  return defineExtension({
    name: '@kusto/react',
    version: '0.1.0',

    // 1) 새 ExpressRouter 메서드 (라우트 로드 전에 prototype 에 등록됨)
    routerMethods: {
      GET_REACT(ctx, component: string) {
        // ctx: RouterContext — router / basePath / wrapHandler / wrapMiddleware /
        //                      registerDocumentation / schemaRegistry / schemaAnalyzer
        ctx.router.get('/', ctx.wrapHandler(async (_req, res) => { /* render */ }));
        ctx.registerDocumentation('GET', '/', { summary: `React: ${component}` });
      },
    },

    // 2) Core init 훅 (Express 설정 후, 라우트 등록 전)
    onInit(ctx) {
      // ctx: { app, config, registerMiddleware, log }
      // 예: 클라이언트 번들 정적 서빙
      // ctx.registerMiddleware(express.static(...));
    },

    // 3) 빌드 훅 (`kusto extensions build`)
    onBuild(ctx) {
      // ctx: { rootDir, appDir, isProduction, log }
      // 예: TSX 번들
    },
  });
}
```

### IDE 타입 합류 (declaration merging)

새 메서드가 IDE 에 보이려면, 확장 패키지가 `ExpressRouter` 인터페이스를 보강하는 `.d.ts` 를 함께 배포해야 합니다(런타임 구현은 `routerMethods` 가, 타입은 이 `.d.ts` 가 담당).

```typescript
// @kusto/react 패키지가 ships 하는 타입 보강 (패키지 types 엔트리에 포함)
import '<코어 안정 모듈 specifier>';
declare module '<코어 안정 모듈 specifier>' {
  interface ExpressRouter {
    GET_REACT(component: string, opts?: ReactRouteOptions): this;
  }
}
```

> `<코어 안정 모듈 specifier>` 는 `ExpressRouter` 가 선언된 모듈입니다. 이 저장소 기준으로는 `@lib/http/routing/expressRouter`, 배포 패키지 기준으로는 그에 대응하는 공개 타입 경로입니다. 이 specifier 는 공개 계약으로 고정되며, 변경 시 메이저로 취급합니다.

## 동작 방식 / 부팅 순서

`Core.initialize()` 는 다음 순서로 확장을 적용합니다.

```
DI 초기화
  → loadExtensions()        # src/app/extensions/* 발견, routerMethods 를 prototype 에 등록 (라우트보다 먼저)
  → setupExpress → setupCoreMiddleware
  → runExtensionInit()      # 각 확장의 onInit (미들웨어/정적/서비스) — 라우트보다 먼저
  → ... → loadRoutes()      # route.ts 가 GET_REACT 등 사용
  → ... → 전역 에러 핸들러(맨 마지막)
```

- `routerMethods` 등록이 라우트 로드보다 먼저라 `route.ts` 에서 안전하게 호출할 수 있습니다.
- `onInit` 도 라우트보다 먼저라 확장이 깐 미들웨어/정적이 라우트에 선행합니다.
- 발견은 런타임 파일 스캔이며 **코드젠이 필요 없습니다**.

## 빌드 훅

설치된 확장의 `onBuild` 를 실행합니다.

```bash
npx kusto extensions build            # 개발 빌드
npx kusto extensions build --production
```

확장의 `onBuild` 가 throw 하면 빌드는 **즉시 실패**하고 CLI 는 0이 아닌 코드로 종료합니다(fail-fast).

## 핵심 타입

`@core/index` 에서 가져옵니다.

| 심볼 | 설명 |
|---|---|
| `defineExtension(ext)` | 확장 작성 헬퍼(타입 추론 보존) |
| `KustoExtension` | 확장 객체 형태(`name`, `routerMethods?`, `onInit?`, `onBuild?`) |
| `RouterContext` | 라우터 메서드 impl 이 받는 안정 컨텍스트(= CRUD 가 쓰는 컨텍스트와 동일, SSOT) |
| `RouterMethodImpl` | `(ctx, ...args) => void` |
| `ExtensionInitContext` / `ExtensionBuildContext` | `onInit` / `onBuild` 가 받는 컨텍스트 |
| `extensionRegistry` | 로드된 확장 레지스트리(`runInit`/`runBuild`/`clear`) |

## 구현 위치 (코어)

`src/core/lib/extensions/` — `extensionTypes.ts`(계약 + `defineExtension`), `extensionRegistry.ts`(레지스트리), `loadExtensions.ts`(CoC 발견). 자세한 내용은 `src/core/lib/extensions/AGENTS.md`.

---

## 📖 문서 네비게이션

**◀️ 이전**: [📊 실시간 모니터(kusto monitor)](./09-dev-monitor.md)
