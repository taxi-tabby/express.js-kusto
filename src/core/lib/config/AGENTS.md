# config/ - 환경변수 로딩 SSOT

프로젝트 전체에서 일관된 환경변수 로딩과 환경 판별(production/development)을 제공하는 단일 진입점(Single Source of Truth) 티어다.

## Structure

```
config/
├── environmentLoader.ts   # dotenv 로더 + 환경 판별 + get/getRequired
└── packageInfo.ts         # package.json name/version/description 접근 SSOT
```

## environmentLoader.ts

`.env` 파일을 `process.cwd()` 기준으로 한 번만 로드(`dotenv.config`)하고, 환경변수 접근 및 환경 판별 헬퍼를 제공한다.

- **책임**: `.env` 로드의 멱등성 보장(`isLoaded` 정적 플래그로 중복 로드 방지), 모든 접근 메서드가 호출 시점에 `load()`를 먼저 호출하여 로드 누락을 차단. 환경변수 읽기의 SSOT 역할.
- **주요 export**: `class EnvironmentLoader` (정적 멤버만)
  - `load()` — `.env`를 1회 로드. 파일 없거나 로드 실패 시 `log.Warn`만 출력하고 진행.
  - `reload()` — `isLoaded`를 리셋 후 강제 재로드.
  - `isProduction()` — `NODE_ENV`가 `production`/`prod`(대소문자 무시)이면 `true`.
  - `isDevelopment()` — `isProduction()`의 부정.
  - `get(key, defaultValue?)` — `string | undefined` 반환(없으면 기본값).
  - `getRequired(key)` — 없으면 `Error`를 throw하는 필수 환경변수 접근.
  - `getLoadStatus()` — `{ isLoaded, nodeEnv }` 상태 스냅샷.
- **의존**: `dotenv`(외부), `path`(Node), `@ext/winston`의 `log`(경고 출력). 다른 lib 티어에 의존하지 않는 하위(leaf) 티어다.

## packageInfo.ts

`package.json`의 `name`/`version`/`description`을 읽는 단일 출처. 과거 `crudHelpers`/`errorHandler`/`documentationGenerator`가 각자 `require('.../package.json')` 하고 서로 다른 fallback(`kusto-server` vs `kusto-api`)을 들고 있어 로드 실패 시 앱 이름이 불일치할 수 있던 문제를 통합한다.

- **주요 export**: `getPackageInfo()` → `{ name, version, description? }`(로드 실패 시 단일 fallback `kusto-server`/`0.0.0`, 무로그), `getImplementationString()` → `"name v version"`(JSON:API `meta.implementation`용), `interface PackageInfo`.
- **의존**: 없음(`require`로 루트 `package.json`만 읽는 leaf). webpack 번들 시 inline, dev 는 ts-node 가 require 해석.

## Import 규칙

표준 import 경로는 `@lib/config/environmentLoader` · `@lib/config/packageInfo`다(`@lib` 단일 루트, 티어 경로 심화).

- **Inbound(이 티어를 쓰는 쪽)**: 부트스트랩/설정이 필요한 상위 코드(예: `@core/*`, 데이터·DI 티어, 미들웨어 등)가 환경 판별과 환경변수 접근을 위해 호출한다.
- **Outbound(이 티어가 쓰는 것)**: `@ext/winston`(로깅)에만 의존. 레이어링 방향상 거의 최하단에 위치하며 다른 lib 티어를 끌어오지 않는다.
