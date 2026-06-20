# devtools/ - Dev-Only Developer Tooling Tier

개발 모드에서만 활성화되는 프레임워크 개발자 도구 묶음 — OpenAPI 문서 자동화와 CRUD 스키마 introspection API 두 하위 티어로 구성된다.

> **DEV-ONLY.** 이 티어 전체는 런타임 게이트로 보호되며 프로덕션에서는 동작하지 않는다.
> - `documentation/` → `AUTO_DOCS=true` **그리고** `NODE_ENV !== 'production'` (`isDocumentationEnabled()`)
> - `schema-api/` → `ENABLE_SCHEMA_API=true` 또는 `NODE_ENV=development`/`dev` (`CrudSchemaRegistry.isSchemaApiEnabled()`)
>
> 게이트가 꺼져 있으면 등록/생성 함수들은 즉시 no-op 으로 반환하므로, 상위 호출자(`Core.ts`)가 무조건 호출해도 안전하다.

## Structure

```
devtools/
├── documentation/   # OpenAPI 3.1 문서 자동 생성 (AUTO_DOCS) — Swagger UI / openapi.json
└── schema-api/      # /api/schema CRUD 스키마 introspection (ENABLE_SCHEMA_API)
```

## Sub-Tiers

| 하위 티어 | 역할 | 게이트 환경변수 |
|-----------|------|-----------------|
| `documentation/` | 등록된 라우트 + Prisma 모델에서 OpenAPI 3.1 문서를 조립하고 `/docs` (Swagger UI), `/docs/openapi.json`, `/docs/dev` 를 제공 | `AUTO_DOCS` |
| `schema-api/` | Prisma DMMF 를 introspection 하여 CRUD 스키마 정보를 등록·조회하는 `/api/schema/*` 라우터 제공 | `ENABLE_SCHEMA_API` |

## Layering

- **하위 티어 간 의존 방향**: `documentation/` → `schema-api/` (단방향).
  `documentation/dmmfToOpenApi`, `jsonApiSchemas`, `syncSchemas` 가 `schema-api/`의 `PrismaSchemaAnalyzer`/`crudSchemaTypes`(`PrismaModelInfo`, `PrismaFieldMetadata`)를 소비한다. 역방향 의존은 없다.
- **인바운드**: 두 티어 모두 `src/core/Core.ts` 가 부트스트랩 단계에서 호출한다(문서 라우트 등록, 스키마 API 등록, 모델 동기화).
- **아웃바운드 공통 의존**: `@ext/winston`(`log`), `@ext/util`(`pluralize`/`singularize`/`createPaginationCursor`), `@lib/http/*`(validator·errorCodes·requestHandler), `@lib/crud/jsonApiConstants`.

## Import

캐논 import 경로는 `@lib/devtools/<sub-tier>/<file>` 이다. 하위 폴더 내부 상호참조도 동일하게 단일 `@lib` 루트 + 깊어진 경로로 작성한다(상대경로 금지). 각 하위 티어의 상세는 해당 폴더의 `AGENTS.md` 참고.
