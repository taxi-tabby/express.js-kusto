# routes/ - HTTP Routing & Global Middleware

Express 라우트 정의와 글로벌 미들웨어를 관리하는 폴더.

## Structure

```
routes/
├── middleware.ts   # 글로벌 미들웨어 스택 (모든 요청에 적용)
├── route.ts        # 루트 경로 (/) 핸들러
└── api/
    └── v1/
        └── users/
            └── route.ts  # /api/v1/users 핸들러
```

## File Convention

- **`middleware.ts`**: 해당 폴더 경로에 적용되는 미들웨어 (Helmet, CORS, body-parser 등)
- **`route.ts`**: 해당 폴더 경로의 HTTP 엔드포인트 정의
- 폴더 구조가 곧 URL 경로 (`routes/api/v1/users/route.ts` → `/api/v1/users`)

## ExpressRouter API

```typescript
import { ExpressRouter } from '@lib/expressRouter';
import { RequestHandler } from '@lib/requestHandler';

const router = new ExpressRouter();

// Fluent API로 라우트 정의
router
    .GET(
        '/',
        ...RequestHandler.createHandler(
            { request: { query: schema }, response: { 200: responseSchema } },
            async (req, res, injected, repo, db) => {
                // injected: DI 서비스, repo: 리포지터리 매니저, db: Prisma 매니저
                return { message: 'Hello' };
            }
        )
    )
    .POST('/', ...handler)
    .WITH('authRateLimiterDefault', { maxRequests: 100 })  // 미들웨어 이름 + 옵션
    .CRUD('default', 'User', { softDelete: { enabled: true, field: 'deletedAt' } });

export default router.build();
```

`WITH` 의 첫 인자는 `injectable/` 에 등록된 미들웨어의 이름 문자열이며, 두 번째 인자는 해당 미들웨어가 받는 옵션이다. arrow function 을 직접 넘기는 형태는 지원하지 않는다.

## Handler Signature

```typescript
async (req: ValidatedRequest, res: Response, injected: Injectable, repo: RepositoryManager, db: PrismaManager) => any
```

5개 파라미터가 자동 주입되며, `req.validatedData`에 검증된 body/query/params가 담김.

## CRUD include 정책

`router.CRUD()` 는 클라이언트의 `?include=author,comments.author` 를 Prisma `include` 로 변환해 한 쿼리로 관계를 로드한다 (Prisma 자체가 lazy loading 을 지원하지 않으므로 N+1 위험은 구조적으로 없음). 다만 무제한 허용은 DoS / 정보 노출 위험이 있어 다음 4개 옵션을 통해 정책을 강제할 수 있다.

```typescript
router.CRUD('default', 'Post', {
    maxIncludeCount: 5,                // ?include= 항목 개수 상한
    maxIncludeDepth: 3,                // 점 경로 깊이 상한 (a.b.c → 3)
    allowedIncludes: ['author', 'comments.author'],  // 화이트리스트
    defaultIncludes: ['author'],       // 서버 강제 eager-load
});
```

| 옵션 | 동작 | 위반 시 |
|---|---|---|
| `maxIncludeCount` | 클라이언트가 보낸 include 항목 수 검증 | 400 `INCLUDE_LIMIT_EXCEEDED` |
| `maxIncludeDepth` | 각 항목의 점 깊이 검증 | 400 `INCLUDE_DEPTH_EXCEEDED` |
| `allowedIncludes` | 화이트리스트 매칭 — 정확 일치 또는 허용 경로의 prefix 허용. 예: `['comments.author']` 이면 `comments` 도 허용, `comments.posts` 는 거부 | 400 `INCLUDE_NOT_ALLOWED` |
| `defaultIncludes` | 클라이언트 요청과 병합되어 항상 로드. 정책 검증 우회 (서버 신뢰) | — |

검증/병합은 `index`, `show`, `create`, `update` 4개 작업에 적용된다. **`create` / `update` 도 `?include=` 쿼리를 받아 응답의 `included` 배열을 채운다.**

주의: 클라이언트가 `?select=` 를 동시에 보내면 Prisma 가 select 우선 정책을 사용하므로 `defaultIncludes` 의 eager-load 효과는 보장되지 않는다.
