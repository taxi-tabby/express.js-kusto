# injectable/ - Dependency Injection (Services & Middleware)

라우트 핸들러에 자동 주입되는 서비스 모듈과 미들웨어를 정의하는 폴더.

## File Types

| 패턴 | 용도 |
|------|------|
| `*.module.ts` | 비즈니스 로직 서비스 클래스 |
| `*.middleware.ts` | Express 미들웨어 팩토리 함수 |
| `*.middleware.interface.ts` | 미들웨어 파라미터 타입 정의 |

## Naming Convention

파일 경로가 camelCase로 변환되어 핸들러의 `injected` 파라미터에 주입됨:

```
injectable/
├── auth/
│   ├── jwt/
│   │   └── export.module.ts      → injected.authJwtExport
│   └── rateLimiter/
│       ├── default.middleware.ts  → injected.authRateLimiterDefault (미들웨어)
│       └── option.middleware.interface.ts  (타입 정의만)
```

## Usage in Routes

```typescript
router.GET(
    '/protected',
    ...RequestHandler.createHandler({ ... },
        async (req, res, injected, repo, db) => {
            // injected.authJwtExport.verify(token)
        }
    )
);

// 미들웨어 적용
router.WITH(injected => injected.authRateLimiterDefault({ maxRequests: 100 }))
    .GET('/api', handler);
```

## Type Generation

`npm run generate` 실행 시 `src/core/lib/types/generated-injectable-types.ts`에 모든 injectable 모듈의 타입이 자동 생성됨.
