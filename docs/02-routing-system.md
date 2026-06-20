# 02. 라우팅 시스템 (Routing System)

## 개요

Express.js-Kusto 프레임워크는 **계층적 라우팅 시스템**을 구현하여 체계적이고 유지보수가 용이한 API 구조를 제공합니다. 각 디렉토리에는 최대 2개의 파일(`route.ts`, `middleware.ts`)만이 인식되며, 이들은 계층적으로 적용됩니다.

라우트 파일은 **플루언트(Fluent) 개발론**을 기반으로 설계되어 메서드 체이닝을 통한 직관적이고 읽기 쉬운 코드 작성을 지원합니다.

## 파일 구조 규칙

### 인식되는 파일
- `route.ts`: 라우트 정의 파일 (필수)
- `middleware.ts`: 미들웨어 정의 파일 (선택사항)

### 제약사항
- 각 폴더당 위 2개 파일만 자동으로 인식됩니다
- 다른 파일명은 자동 로딩되지 않습니다 (import를 통한 참조는 가능)
- 모든 파일은 TypeScript로 작성되어야 합니다

## 동적 라우팅 (URL 파라미터)

프레임워크는 두 가지 방법으로 URL 파라미터를 정의할 수 있습니다:

### 방법: 폴더명 정의

폴더명을 사용하여 자동으로 URL 파라미터를 생성합니다:

**명명 규칙:**
1. **일반 폴더**: `foldername` → `/foldername`
2. **파라미터 폴더**: `[paramName]` → `/:paramName`
3. **정규식 파라미터**: `[^paramName]` → `/:paramName([^/]+)`
4. **동적 파라미터**: `..[^paramName]` → `/:paramName*`

**예시 구조:**
```
src/app/routes/
├── users/
│   ├── route.ts                    # /users
│   └── [userId]/
│       ├── route.ts                # /users/:userId
│       └── posts/
│           ├── route.ts            # /users/:userId/posts
│           └── [postId]/
│               └── route.ts        # /users/:userId/posts/:postId
├── api/
│   └── [^version]/                 # /api/:version([^/]+) - 정규식 제약
│       └── route.ts
└── files/
    └── ..[^path]/                  # /files/:path* - 동적 경로
        └── route.ts
```

### 방법: 코드로 받기

코드에서 직접 슬러그를 정의할 수도 있습니다:

```typescript
// 코드에서 직접 파라미터 정의
router.GET_SLUG(["userId", "postId"], async (req, res, injected, repo, db) => {
    const { userId, postId } = req.params;
    // 처리 로직...
});
```

## 라우트 파일 (route.ts)

### 기본 구조 및 플루언트 API

라우트 파일은 **플루언트(Fluent) 개발론**을 기반으로 설계되어 메서드 체이닝을 통한 직관적이고 읽기 쉬운 코드 작성을 지원합니다:

```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter'

const router = new ExpressRouter();

// 플루언트 방식으로 라우트 정의
router
    .WITH('authRateLimiter', { maxRequests: 5 })
    .WITH('authJwtRequired')
    .GET_VALIDATED(requestConfig, responseConfig, handler)
    .POST_VALIDATED(requestConfig, responseConfig, handler);

export default router.build();
```

### HTTP 메서드

#### 1. 기본 HTTP 메서드

```typescript
// GET 요청
router.GET(async (req, res, injected, repo, db) => {
    return res.render('index', { 
        CONST_VERSION_NAME: `1.0.0-kusto`,
    });
});

// POST, PUT, DELETE, PATCH 등
router.POST(async (req, res, injected, repo, db) => {
    // 처리 로직
});

// 체이닝 가능
router
    .GET(getHandler)
    .POST(postHandler)
    .PUT(putHandler);
```

#### 2. 슬러그 기반 라우트 (코드 정의)

```typescript
// 단일 파라미터
router.GET_SLUG(["userId"], async (req, res, injected, repo, db) => {
    const userId = req.params.userId;
    // 처리 로직
});

// 여러 파라미터
router.GET_SLUG(["userId", "postId"], async (req, res, injected, repo, db) => {
    const { userId, postId } = req.params;
    // 처리 로직
});
```

#### 3. 검증된 라우트 (Validated Routes)

플루언트 API의 핵심 기능으로, 요청/응답 검증과 자동 문서화를 제공합니다:

> **⚠️ 중요**: `_VALIDATED` 메서드를 사용할 때는 정의된 요청 파라미터와 상태 코드별 응답을 **반드시** 준수해야 합니다. 구현이 누락되거나 실제 반환값이 스키마와 다를 경우 경고나 에러가 발생합니다.

```typescript
router
    .WITH('authRateLimiter', { maxRequests: 10 })
    .POST_VALIDATED(
        // 요청 검증 설정 - 이 스키마에 맞는 데이터만 허용
        {
            body: {
                email: { type: 'email', required: true },
                password: { type: 'string', required: true, minLength: 8 }
            },
            query: {
                remember: { type: 'boolean', required: false }
            }
        },
        // 응답 스키마 정의 - 정의된 모든 상태코드에 대한 응답 구현 필수
        {
            200: {
                success: { type: 'boolean', required: true },
                accessToken: { type: 'string', required: true },
                refreshToken: { type: 'string', required: true },
                user: {
                    type: 'object',
                    required: true,
                    properties: {
                        uuid: { type: 'string', required: true },
                        email: { type: 'string', required: true }
                    }
                }
            },
            400: {
                error: { type: 'string', required: true },
                details: { type: 'array', required: false }
            },
            401: {
                error: { type: 'string', required: true }
            }
        },
        // 핸들러 함수 - 모든 정의된 응답 케이스를 구현해야 함
        async (req, res, injected, repo, db) => {
            const data = req.validatedData; // 검증된 데이터만 사용
            
            try {
                // 비즈니스 로직...
                
                // 200 응답 - 스키마와 정확히 일치해야 함
                return {
                    success: true,
                    accessToken: "generated_token",
                    refreshToken: "generated_refresh_token",
                    user: { 
                        uuid: "user_uuid", 
                        email: data.body.email 
                    }
                };
            } catch (error) {
                // 401 응답 예시
                if (error.type === 'UNAUTHORIZED') {
                    res.status(401);
                    return {
                        error: '인증에 실패했습니다'
                    };
                }
                
                // 400 응답 예시
                res.status(400);
                return {
                    error: '요청 처리 중 오류가 발생했습니다',
                    details: [error.message]
                };
            }
        }
    );
```

#### 4. 미들웨어 체이닝

플루언트 API의 강력한 기능으로, 여러 미들웨어를 체인으로 연결할 수 있습니다:

```typescript
router
    .WITH('corsHandler')                    // CORS 처리
    .WITH('authRateLimiterDefault', {       // Rate Limiting
        repositoryName: 'accountUser', 
        maxRequests: 3, 
        windowMs: 1*60*1000, 
        message: "너무 많은 요청입니다."
    })
    .WITH('authJwtNoLoginOnly')             // JWT 인증 (로그인 안된 사용자만)
    // 참고: 프레임워크 기본 제공 CSRF 미들웨어는 제거되었습니다.
    // 쿠키 기반 인증(credentials)을 사용한다면 앱에서 직접 csrf 라이브러리를
    // (예: csrf-csrf double-submit 토큰) middleware.ts 에 등록하세요.
    .POST_VALIDATED(requestConfig, responseConfig, handler)
    .GET_VALIDATED(getRequestConfig, getResponseConfig, getHandler);
```

#### 5. 특수 라우트 메서드

```typescript
// 404 핸들링
router.NOTFOUND((req, res) => {
    res.status(404).json({ 
        error: "요청한 리소스를 찾을 수 없습니다",
        path: req.path 
    });
});

// 파일 업로드 (단일)
router.POST_SINGLE_FILE(storage, 'avatar', async (req, res, injected, repo, db) => {
    const file = req.file; // 업로드된 파일
    // 파일 처리 로직...
});

// 파일 업로드 (필드별)
router.POST_FIELD_FILE(storage, [
    { name: 'avatar', maxCount: 1 },
    { name: 'documents', maxCount: 5 }
], async (req, res, injected, repo, db) => {
    const files = req.files; // 업로드된 파일들
    // 파일 처리 로직...
});
```

### 핸들러 함수 매개변수

모든 핸들러 함수는 다음 5개의 매개변수를 받습니다:

- `req`: Express Request 객체 (확장됨)
- `res`: Express Response 객체  
- `injected`: 의존성 주입된 모듈들
- `repo`: Repository Manager 인스턴스
- `db`: Prisma Manager 인스턴스

```typescript
async (req, res, injected, repo, db) => {
    // 기본 제공되는 매개변수 사용 (권장)
    const jwt = injected.authJwtExport;
    const logger = injected.loggerService;
    
    const userRepo = repo.getRepository('accountUser');
    const postRepo = repo.getRepository('post');
    
    const users = await db.getClient('user').user.findMany();
    
    // URL 파라미터 접근 (폴더명 또는 코드 정의)
    const { userId, postId } = req.params;
    
    // 검증된 데이터 접근 (_VALIDATED 메서드에서만)
    const validatedData = req.validatedData;
    
    // req.kusto는 선택사항 (특별한 경우에만 사용)
    // const kustoManager = req.kusto;
}
```

### Request 객체 확장 기능

Express Request 객체는 프레임워크에 의해 다음과 같이 확장됩니다:

#### req.kusto - Kusto Manager 접근

모든 Express Request 객체에서 `req.kusto`를 통해 Kusto Manager에 접근할 수 있습니다:

```typescript
// 라우트 핸들러에서
router.GET(async (req, res, injected, repo, db) => {
    // Kusto Manager는 리소스 총괄 접근 인스턴스
    const kustoManager = req.kusto;
    
    // 모듈 접근
    const authModule = req.kusto.getModule('authJwtExport');
    const rateLimiter = req.kusto.getModule('authRateLimiterDefault');
    
    // 데이터베이스 클라이언트 접근
    const userClient = req.kusto.db.getClient('user');
    const tempClient = req.kusto.db.getClient('temporary');
    
    // Repository 접근
    const userRepo = req.kusto.getRepository('accountUser');
});

// 미들웨어에서도 동일하게 접근 가능
export default [
    (req: Request, res: Response, next: NextFunction) => {
        // 미들웨어에서도 Kusto Manager 접근 가능
        const kustoManager = req.kusto;
        
        // 로깅, 인증, 권한 확인 등에 활용
        const logger = kustoManager.getModule('loggerService');
        logger.info(`Request to ${req.path}`, {
            method: req.method,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
        
        next();
    }
];
```

#### req.validatedData - 검증된 데이터

`_VALIDATED` 메서드를 사용한 라우트에서만 사용 가능합니다:

```typescript
router.POST_VALIDATED(
    {
        body: { email: { type: 'email', required: true } },
        query: { page: { type: 'number', required: false, default: 1 } }
    },
    responseConfig,
    async (req, res, injected, repo, db) => {
        // 검증되고 타입이 보장된 데이터
        const email = req.validatedData.body.email;    // string (email format)
        const page = req.validatedData.query.page;     // number (default: 1)
        
        // 원본 데이터에도 여전히 접근 가능
        const rawBody = req.body;
        const rawQuery = req.query;
    }
);
```

> **💡 참고**: Kusto Manager는 프레임워크의 핵심 리소스 관리자로, 모든 모듈, 데이터베이스 클라이언트, 서비스에 대한 통합 접근점을 제공합니다.

## 미들웨어 파일 (middleware.ts)

### 기본 구조

각 폴더의 `middleware.ts`는 해당 경로와 하위 경로에 적용되는 미들웨어를 정의합니다.

```typescript
import { Request, Response, NextFunction } from "express";
import { log } from "@ext/winston";

export default [
    (req: Request, res: Response, next: NextFunction) => {
        // 미들웨어 로직 — winston 로거 사용 (프레임워크 컨벤션)
        log.Info(`요청 경로: ${req.path}`);
        next();
    },

    (req: Request, res: Response, next: NextFunction) => {
        // 다음 핸들러로 값을 넘기려면 declaration merging 으로 Request 를 확장하거나
        // (권장) WITH 미들웨어 체인을 사용해 req.with.<name> 슬롯을 활용한다.
        (req as any).customData = "some data";
        next();
    }
];
```

### 최상위 미들웨어 (src/app/routes/middleware.ts)

최상위 미들웨어는 모든 요청에 적용되며, 다음과 같은 기능을 제공합니다:

- **Kusto Manager 초기화**: 모든 요청에 kusto 인스턴스 제공
- **보안 헤더**: Helmet을 통한 보안 설정
- **CORS 처리**: 동적 화이트리스트 관리
- **요청 파싱**: JSON, URL-encoded 데이터 파싱 (`application/vnd.api+json` 지원)
- **IP 추적**: 클라이언트 IP 식별 및 Footwalk 로깅
- **에러 핸들링**: 전역 에러 처리

### 계층적 미들웨어 적용

미들웨어는 계층적으로 적용됩니다:

1. **최상위 미들웨어** (`src/app/routes/middleware.ts`)
2. **폴더별 미들웨어** (해당 경로의 `middleware.ts`)
3. **라우트 레벨 미들웨어** (WITH 메서드로 추가된 미들웨어)

예시 구조:
```
src/app/routes/
├── middleware.ts          # 모든 요청에 적용
├── route.ts              # 루트 라우트
└── authorities/
    ├── middleware.ts      # /authorities/* 요청에 적용
    └── signin/
        ├── middleware.ts  # /authorities/signin/* 요청에 적용
        └── route.ts      # /authorities/signin 라우트
```

## 실제 사용 예시

### 1. 루트 라우트 (src/app/routes/route.ts)

```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter'

const router = new ExpressRouter();

router.GET(async (req, res, injected, repo, db) => {
    return res.render('index', { 
        CONST_VERSION_NAME: `1.0.0-kusto`,
    });
});

router.NOTFOUND((req, res) => {
    res.status(404).send("Not found");
});

export default router.build();
```

### 2. 동적 라우트 예시 (폴더명 기반)

```typescript
// src/app/routes/users/[userId]/route.ts
import { ExpressRouter } from '@lib/http/routing/expressRouter';

const router = new ExpressRouter();

// GET /users/:userId - 사용자 정보 조회
router.GET(async (req, res, injected, repo, db) => {
    const userId = req.params.userId; // 폴더명에서 자동 추출
    
    // req.kusto를 통한 리소스 접근
    const userRepo = req.kusto.getRepository('accountUser');
    const user = await userRepo.findById(userId);
    
    if (!user) {
        return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
    }
    
    return res.json(user);
});

export default router.build();
```

### 3. 중첩 동적 라우트 (src/app/routes/users/[userId]/posts/[postId]/route.ts)

```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter';

const router = new ExpressRouter();

// GET /users/:userId/posts/:postId - 특정 사용자의 특정 게시물 조회
router.GET(async (req, res, injected, repo, db) => {
    const { userId, postId } = req.params; // 여러 파라미터 동시 접근
    
    // Kusto Manager를 통한 통합 리소스 접근
    const authModule = req.kusto.getModule('authJwtExport');
    const userRepo = req.kusto.getRepository('accountUser');
    const postRepo = req.kusto.getRepository('post');
    
    // 사용자 권한 확인
    const user = await userRepo.findById(userId);
    if (!user) {
        return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
    }
    
    // 게시물 조회
    const post = await postRepo.findByIdAndUser(postId, userId);
    
    return res.json(post);
});

export default router.build();
```

### 4. 인증 라우트 (src/app/routes/authorities/signin/route.ts)

```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter';

const router = new ExpressRouter();

router
.WITH('authRateLimiterDefault', {
    repositoryName: 'accountUser', 
    maxRequests: 3, 
    windowMs: 1*60*1000, 
    message: "로그인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
})
.WITH('authJwtNoLoginOnly')
.POST_VALIDATED(
    {
        body: {
            email: { type: 'email', required: true },
            password: { type: 'string', required: true }
        }
    },
    {
        200: {
            success: { type: 'boolean', required: true },
            accessToken: { type: 'string', required: true },
            refreshToken: { type: 'string', required: true },
            uuid: { type: 'string', required: false },
        },
        400: {
            success: { type: 'boolean', required: true, default: false },
            error: { type: 'string', required: true }
        },
    },
    async (req, res, injected, repo, db) => {
        // req.kusto를 통한 통합 리소스 접근
        const jwt = req.kusto.getModule('authJwtExport');
        const userRepo = req.kusto.getRepository('accountUser');
        const data = req.validatedData;

        const _userInfo = await userRepo.findByEmail(data?.body.email);

        if (!_userInfo) {
            res.status(400);
            return { error: '로그인에 실패했습니다' }
        }

        if (!await jwt.verifyPassword(data?.body.password, _userInfo?.passwordHash ?? '')) {
            res.status(400);
            return { error: '로그인에 실패했습니다' }
        }

        // 추가 검증 로직...

        const accessToken = jwt.generateAccessToken({
            uuid: _userInfo.uuid.toString(),
            email: _userInfo.email,
            role: withRoles?.roles.map((userRole: any) => userRole.role.uuid) ?? []
        });

        const refreshToken = jwt.generateRefreshToken({
            uuid: _userInfo.uuid.toString(),
            email: _userInfo.email,
            role: withRoles?.roles.map((userRole: any) => userRole.role.uuid) ?? []
        });

        return {
            success: true,
            accessToken,
            refreshToken,
            uuid: _userInfo.uuid.toString()
        }
    }
);

export default router.build();
```

## 주요 특징

### 1. 플루언트 API와 타입 안전성
- **메서드 체이닝**: 직관적이고 읽기 쉬운 코드 작성
- **TypeScript 완전 지원**: 컴파일 타임 타입 검증
- **자동 완성**: IDE에서 강력한 IntelliSense 지원

```typescript
// 플루언트 API 예시
router
    .WITH('authRateLimiter', { maxRequests: 10 })
    .WITH('authJwtRequired')
    .GET_VALIDATED(requestConfig, responseConfig, handler)
    .POST_VALIDATED(postRequestConfig, postResponseConfig, postHandler);
```

### 2. 의존성 주입과 통합 리소스 접근
- **자동 의존성 주입**: 핸들러 함수에 필요한 서비스 자동 제공
- **req.kusto**: 모든 리소스에 대한 통합 접근점
- **다중 접근 방식**: injected, repo, db, req.kusto 모두 사용 가능

### 3. 자동 문서화와 검증
- **스키마 기반 검증**: 요청/응답 자동 검증
- **API 문서 생성**: 검증 스키마로부터 자동 문서화
- **런타임 안전성**: 잘못된 데이터 형식 자동 차단

### 4. 계층적 구조와 미들웨어
- **폴더 기반 라우팅**: 직관적인 URL 구조
- **계층적 미들웨어**: 상위 폴더의 미들웨어 자동 상속
- **선택적 적용**: 필요한 곳에만 미들웨어 적용

### 5. 유연한 파라미터 정의
- **폴더명 기반**: 시각적으로 명확한 URL 구조
- **코드 기반**: 복잡한 라우팅 로직 지원
- **정규식 지원**: 고급 URL 패턴 매칭




**응답 스키마 설계:**
```typescript
// 일관된 응답 형식 사용
const standardResponseConfig = {
    200: {
        success: { type: 'boolean', required: true },
        data: { type: 'object', required: true },
        message: { type: 'string', required: false }
    },
    400: {
        success: { type: 'boolean', required: true, default: false },
        error: { type: 'string', required: true },
        details: { type: 'array', required: false }
    },
    401: {
        success: { type: 'boolean', required: true, default: false },
        error: { type: 'string', required: true }
    }
};
```

### 3. 리소스 접근 패턴

**기본 매개변수 사용 (권장):**
```typescript
router.GET(async (req, res, injected, repo, db) => {
    // 기본 제공되는 매개변수 사용
    const userRepo = repo.getRepository('accountUser');
    const authModule = injected.authJwtExport;
    const userClient = db.getClient('user');
    
    // req.kusto는 선택사항 (필요시에만 사용)
    const kustoManager = req.kusto; // 특별한 경우에만
});
```

### 4. 에러 처리 패턴

**일관된 에러 응답:**
```typescript
router.POST_VALIDATED(
    requestConfig,
    {
        200: {
            success: { type: 'boolean', required: true },
            data: { type: 'object', required: true }
        },
        404: {
            success: { type: 'boolean', required: true },
            error: { type: 'string', required: true },
            code: { type: 'string', required: true }
        }
    },
    async (req, res, injected, repo, db) => {
        try {
            const userRepo = repo.getRepository('accountUser');
            const user = await userRepo.findById(req.validatedData.body.userId);
            
            // 정의된 404 응답을 반드시 구현
            if (!user) {
                res.status(404);
                return {
                    success: false,
                    error: '사용자를 찾을 수 없습니다',
                    code: 'USER_NOT_FOUND'
                };
            }
            
            // 정의된 200 응답을 반드시 구현
            return {
                success: true,
                data: user
            };
            
        } catch (error) {
            // 예상치 못한 에러는 상위로 전파
            throw error;
        }
    }
);
```


## 주의사항과 제약사항

### 파일 구조 관련
1. **파일명 규칙**: `route.ts`와 `middleware.ts`만 자동 인식됩니다.
2. **export default**: 모든 라우트와 미들웨어 파일은 `export default`를 사용해야 합니다.
3. **폴더명 제약**: 동적 라우팅 폴더명은 `[paramName]`, `[^paramName]`, `..[^paramName]` 형식을 따라야 합니다.


### 실행 순서와 처리
4. **미들웨어 순서**: 미들웨어 배열 내의 순서가 실행 순서를 결정합니다.
5. **에러 처리**: 미들웨어에서 에러가 발생하면 반드시 `next(error)`를 호출해야 합니다.
6. **파라미터 충돌**: 같은 경로에서 동일한 파라미터 이름을 사용하지 않도록 주의합니다.


### 성능과 메모리
7. **메모리 누수**: 핸들러 함수에서 큰 객체를 반환할 때 메모리 사용량을 고려하세요.
8. **비동기 처리**: 모든 핸들러는 async/await 또는 Promise를 올바르게 처리해야 합니다.

### 보안 관련
9. **검증 우회**: `_VALIDATED` 메서드가 아닌 일반 메서드에서는 수동으로 입력값을 검증해야 합니다.
10. **권한 확인**: 민감한 작업은 반드시 적절한 인증/권한 미들웨어를 적용하세요.
11. **응답 스키마 준수**: `_VALIDATED` 메서드에서는 정의된 모든 상태 코드와 응답 형식을 반드시 구현해야 합니다.

## 개발 팁과 트러블슈팅





### 자주 발생하는 문제들

#### 1. _VALIDATED 메서드 응답 스키마 오류
```typescript
// ❌ 잘못된 예 - 정의되지 않은 상태코드 사용
router.POST_VALIDATED(
    requestConfig,
    {
        200: { success: { type: 'boolean', required: true } }
        // 404는 정의하지 않음
    },
    async (req, res) => {
        res.status(404); // 에러 발생!
        return { error: 'Not found' };
    }
);

// ✅ 올바른 예 - 모든 사용할 상태코드 정의
router.POST_VALIDATED(
    requestConfig,
    {
        200: { success: { type: 'boolean', required: true } },
        404: { error: { type: 'string', required: true } }
    },
    async (req, res) => {
        res.status(404);
        return { error: 'Not found' }; // 정상 작동
    }
);
```



#### 3. 미들웨어 순서 문제
```typescript
// ❌ 잘못된 순서 - 인증 후 CORS
router
    .WITH('authJwtRequired')       // 인증 먼저
    .WITH('corsHandler')           // CORS 나중에 - 문제 발생 가능
    .GET(handler);

// ✅ 올바른 순서 - CORS 후 인증
router
    .WITH('corsHandler')           // CORS 먼저
    .WITH('authJwtRequired')       // 인증 나중에
    .GET(handler);
```




---


## 전체 메소드

### 기본 메서드
> 라우터를 적용하는 기능입니다.
```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter'
const router = new ExpressRouter();

...
...
...

// 모든 라우터는 코드의 마지막에 해당 메서드를 사용해서 export default 로 반환해야 합니다.
export default router.build();
```

- **`build`** - 라우터를 빌드하여 Express Router 객체를 반환합니다.
- **`setBasePath`** - 라우터의 기본 경로를 설정합니다.



### HTTP 메서드 (기본)
```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter'
const router = new ExpressRouter();

// Express.js를 사용하는 방법과 거의 동일합니다.
// req(Request), res(Result) 는 express.js에서 제공하는 함수와 거의 완전 동일합니다.
// 반환 방법도 동일합니다.
// 앱 기반 라우터 동작을 지향하므로 path 입력은 없습니다.
// https://expressjs.com/en/starter/hello-world.html 를 참고하세요
router
.GET(async (req, res, injected, repo, db) => {
    return res.render('index', { 
        CONST_VERSION_NAME: `1.0.0-kusto`,
    });
});
```

- **`GET`** - HTTP GET 메서드의 동작을 정의합니다.
- **`GET_SLUG`** - HTTP GET 메서드의 SLUG 동작을 정의합니다.
```typescript
router
.GET_SLUG(['slug1', 'slug2'], async (req, res, injected, repo, db) => {
    return res.render('index', { 
        CONST_VERSION_NAME: `1.0.0-kusto`,
    });
});
```

- **`POST`** - HTTP POST 메서드의 동작을 정의합니다.
- **`POST_SLUG`** - HTTP POST 메서드의 SLUG 동작을 정의합니다.
- **`PUT`** - HTTP PUT 메서드의 동작을 정의합니다.
- **`PUT_SLUG`** - HTTP PUT 메서드의 SLUG 동작을 정의합니다.
- **`DELETE`** - HTTP DELETE 메서드의 동작을 정의합니다.
- **`DELETE_SLUG`** - HTTP DELETE 메서드의 SLUG 동작을 정의합니다.
- **`PATCH`** - HTTP PATCH 메서드의 동작을 정의합니다.
- **`PATCH_SLUG`** - HTTP PATCH 메서드의 SLUG 동작을 정의합니다.
- **`NOTFOUND`** - 지정된 라우터가 없을 때 동작을 정의합니다.

### 파일 업로드 메서드
> multer 라이브러리를 사용한 파일 업로드 대응 기능입니다.
> https://github.com/expressjs/multer 를 참고하세요
```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter'
import { memoryStorage } from 'multer'
const router = new ExpressRouter();


const storage = memoryStorage();
router.POST_FIELD_FILE(storage, [
    {name: 'attachment', maxCount: 1},
    {name: 'images', maxCount: 5}
],(req, res, injected, repo, db) => {
    
    // multer를 사용하여 파일 업로드 처리
    // req.files는 fieldname을 키로 하는 객체입니다.
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    
    // attachment 파일 (단일 파일)
    const attachmentFiles = files['attachment'];
    if (attachmentFiles && attachmentFiles.length > 0) {
        const attachment = attachmentFiles[0];
        console.log('첨부파일:', {
            originalname: attachment.originalname,
            mimetype: attachment.mimetype,
            size: attachment.size,
            buffer: attachment.buffer // 메모리에 저장된 파일 데이터
        });
    }
    
    // images 파일들 (복수 파일)
    const imageFiles = files['images'];
    if (imageFiles && imageFiles.length > 0) {
        console.log(`업로드된 이미지 개수: ${imageFiles.length}`);
        imageFiles.forEach((image, index) => {
            console.log(`이미지 ${index + 1}:`, {
                originalname: image.originalname,
                mimetype: image.mimetype,
                size: image.size,
                buffer: image.buffer // 메모리에 저장된 파일 데이터
            });
        });
    }
    
    // 응답 반환
    res.json({
        success: true,
        message: '파일 업로드 완료',
        uploadedFiles: {
            attachment: attachmentFiles?.length || 0,
            images: imageFiles?.length || 0
        }
    });
})

```

- **`POST_SINGLE_FILE`** - 단일 파일 업로드를 처리합니다.
- **`POST_ARRAY_FILE`** - 배열 형태의 다중 파일 업로드를 처리합니다.
- **`POST_FIELD_FILE`** - 필드별 파일 업로드를 처리합니다.
- **`POST_ANY_FILE`** - 모든 형태의 파일 업로드를 처리합니다.
- **`PUT_SINGLE_FILE`** - PUT 방식 단일 파일 업로드를 처리합니다.
- **`PUT_ARRAY_FILE`** - PUT 방식 배열 형태의 다중 파일 업로드를 처리합니다.
- **`PUT_FIELD_FILE`** - PUT 방식 필드별 파일 업로드를 처리합니다.
- **`PUT_ANY_FILE`** - PUT 방식 모든 형태의 파일 업로드를 처리합니다.

### 미들웨어 메서드
```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter'
const router = new ExpressRouter();

// 미들웨어 체이닝 예시
router
    .WITH('corsHandler')
    .WITH('authJwtRequired')
    .MIDDLEWARE(customMiddleware)
    .GET(handler);
```

- **`USE`** - Express 기본 미들웨어를 등록합니다.
- **`MIDDLEWARE`** - 커스텀 미들웨어 함수를 등록합니다.
- **`WITH`** - Injectable 미들웨어를 등록합니다 (의존성 주입 지원). 첫 인자는 `injectable/` 에 등록된 미들웨어의 이름 문자열, 두 번째 인자는 옵션. arrow function 직접 전달은 지원하지 않음.
- **`USE_HANDLER`** _(deprecated)_ — `HandlerFunction` 타입의 미들웨어를 등록한다. next 함수가 없어 다음으로 넘어가지 못하므로 일반적으로 사용하지 않는다. 대부분의 경우 `MIDDLEWARE` 또는 `USE` 를 사용한다.

### 프록시 및 정적 파일 메서드
> Node `http`/`https` 기반 자체 구현 리버스 프록시입니다(외부 의존성 없음).
> 지원 옵션(`ProxyOptions`): `target`(필수), `changeOrigin`, `pathRewrite`(객체/함수),
> `headers`, `secure`(TLS 검증), `timeout`, 훅 `onProxyReq`/`onProxyRes`/`onError`.
> 표준 `X-Forwarded-For/Proto/Host` 헤더를 자동 부가하며, 전역 body-parser 가 소비한
> 본문(`req.body`)은 자동 재직렬화하여 전달합니다. 업스트림 실패 시 502/504(JSON:API)로 응답합니다.
> (WebSocket 업그레이드 프록시는 미지원.)
```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter'
const router = new ExpressRouter();

// 프록시 설정 예시
router.MIDDLE_PROXY_ROUTE({
    target: 'http://localhost:3001',
    changeOrigin: true
});
```

- **`MIDDLE_PROXY_ROUTE`** - 루트 경로에 프록시를 설정합니다.
- **`MIDDLE_PROXY_ROUTE_SLUG`** - 특정 슬러그 경로에 프록시를 설정합니다.

### 정적 HTTP 파일 제공 메서드
```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter'
const router = new ExpressRouter();

// 정적 파일 서빙 예시
router.STATIC('./public');
```

- **`STATIC`** - 루트 경로에서 정적 파일을 제공합니다.
- **`STATIC_SLUG`** - 특정 슬러그 경로에서 정적 파일을 제공합니다.

### 검증된 요청 메서드
```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter'
const router = new ExpressRouter();

// 검증된 요청 예시
router.POST_VALIDATED(
    { body: { name: { type: 'string', required: true } } },
    { 200: { success: { type: 'boolean', required: true } } },
    handler
);
```

- **`GET_VALIDATED`** - 검증된 GET 요청을 처리합니다.
- **`GET_SLUG_VALIDATED`** - 검증된 GET 슬러그 요청을 처리합니다.
- **`POST_VALIDATED`** - 검증된 POST 요청을 처리합니다.
- **`POST_SLUG_VALIDATED`** - 검증된 POST 슬러그 요청을 처리합니다.
- **`PUT_VALIDATED`** - 검증된 PUT 요청을 처리합니다.
- **`DELETE_VALIDATED`** - 검증된 DELETE 요청을 처리합니다.
- **`PATCH_VALIDATED`** - 검증된 PATCH 요청을 처리합니다.

### CRUD 메서드
```typescript
import { ExpressRouter } from '@lib/http/routing/expressRouter'
const router = new ExpressRouter();

// CRUD 자동 생성 예시
router.CRUD('user', 'User', {
    only: ['index', 'show', 'create', 'update', 'destroy']
});
```

- **`CRUD`** - 완전한 REST API CRUD 엔드포인트를 자동으로 생성합니다.











---

## 📖 문서 네비게이션

**◀️ 이전**: [🏗️ 핵심 아키텍처](./01-core-architecture.md)  
**▶️ 다음**: [🗄️ 데이터베이스 관리](./03-database-management.md)