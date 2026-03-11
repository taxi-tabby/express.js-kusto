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
import { ExpressRouter } from '@core/lib/expressRouter';
import { RequestHandler } from '@core/lib/requestHandler';

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
    .WITH(injected => injected.someMiddleware())  // 미들웨어 체이닝
    .CRUD('default', 'User', { softDelete: { enabled: true, field: 'deletedAt' } });

export default router;
```

## Handler Signature

```typescript
async (req: ValidatedRequest, res: Response, injected: Injectable, repo: RepositoryManager, db: PrismaManager) => any
```

5개 파라미터가 자동 주입되며, `req.validatedData`에 검증된 body/query/params가 담김.
