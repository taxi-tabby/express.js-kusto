# http/ - 요청 처리 티어 (Request-Handling Tier)

HTTP 요청의 라우팅 · 검증 · 직렬화 · 에러 응답을 담당하는 코어 티어. Express 위에 프레임워크의 fluent 라우팅 API, `_VALIDATED` 검증 엔진, 안전 직렬화, JSON:API/CRUD 에러 포매팅을 얹는다.

## Structure

```
http/
├── routing/           # 라우트 빌더 + 컨벤션 자동 디스커버리 + 미들웨어/프록시
│   ├── expressRouter.ts          # fluent 라우트 빌더 (공개 API)
│   ├── loadRoutes_V6_Clean.ts    # 폴더→URL 컨벤션 라우트 자동 마운트
│   ├── middlewareHelpers.ts      # 6-arg 프레임워크 미들웨어 → Express 래핑
│   └── proxyMiddleware.ts        # zero-dep 리버스 프록시
├── validation/        # 요청/응답 스키마 검증
│   ├── requestHandler.ts         # *_VALIDATED 엔진 (RequestConfig/ResponseConfig)
│   └── validator.ts              # 필드 스키마 검증기 + SQL/XSS 탐지
├── serialization/     # 응답 직렬화
│   ├── serializer.ts             # BigInt/Date/Prisma-Date 안전 직렬화 + pick/omit
│   └── serializationMiddleware.ts # res.json 오버라이드 미들웨어
└── errors/            # 에러 코드 + 포매팅
    ├── errorCodes.ts             # 에러 코드 SSOT + 상태 매핑
    ├── errorFormatter.ts         # Prisma 에러 → {code, status}
    └── errorHandler.ts           # 정규화 + 새니타이즈 + CRUD/JSON:API 포맷
```

## Sub-Tier 역할

- **routing/** — 라우트 정의(`ExpressRouter`)와 디스크 자동 디스커버리(`loadRoutes`)의 진입점. validation/serialization/errors 세 하위 티어를 모두 소비하여 verb/`_VALIDATED`/`_SLUG`/`_FILE`/`CRUD`/`STATIC`/`MIDDLE_PROXY_ROUTE` 를 조립한다.
- **validation/** — `_VALIDATED` 계열 메서드의 요청 검증 미들웨어와 응답 스키마 필터링 엔진. serialization 의 `applyResponseSerializer` 를 호출한다.
- **serialization/** — 직렬화 불가 타입(BigInt/Date/Prisma `@db.Date`)을 안전하게 변환하고, 라우터 응답 serializer(`pick`/`omit`/함수형)를 적용한다.
- **errors/** — 에러 코드 상수의 단일 진실 공급원(SSOT)과 HTTP 상태 매핑, Prisma/일반 에러를 JSON:API · CRUD 응답 형태로 정규화·새니타이즈한다.

## Import 규약

- 정규 import 경로는 단일 `@lib` 루트를 깊게 파고드는 형태다: `@lib/http/<sub-tier>/<file>`.
  - 예: `@lib/http/routing/expressRouter`, `@lib/http/validation/requestHandler`, `@lib/http/serialization/serializer`, `@lib/http/errors/errorCodes`.
- **레이어 방향(아웃바운드)**: routing → validation → serialization, 그리고 routing/proxy/errors → errors(`errorCodes`/`errorHandler`/`errorFormatter`). validation → serialization 으로의 단방향 의존만 존재한다.
- **외부 티어 의존**: routing 은 `@lib/data/*`(DI/prismaManager/repositoryManager), `@lib/crud/*`, `@lib/devtools/*`(문서/스키마 API, dev 전용), `@lib/types/generated-*`, `@ext/winston` 에 의존한다.
- **인바운드**: `src/core/Core.ts`(부트스트랩)가 `loadRoutes` 를, `src/app/routes/**/route.ts` 가 `ExpressRouter` 를 소비한다. devtools 티어(`/docs`, `/api/schema`)는 `AUTO_DOCS`/`ENABLE_SCHEMA_API` 로 게이트된다.
