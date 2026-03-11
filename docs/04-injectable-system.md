# 04. Injectable System

Injectable 시스템은 Express.js 애플리케이션에서 의존성 주입을 통해 미들웨어와 서비스를 관리하는 시스템입니다. 이 시스템은 `app/routes`의 `route.ts` 파일에서 `WITH` 메서드를 통해 사용됩니다.

Injectable 폴더의 파일들은 camelCase로 자동 변환되어 타입으로 생성되며, IDE에서 자동 완성 힌트를 제공합니다. `npm run dev` 및 `npm run dev:serve` 실행 시 nodemon에 의해 타입 생성 스크립트가 자동으로 실행되어 즉시 적용됩니다.

## 시스템 구조

Injectable 시스템은 세 가지 주요 파일 유형으로 구성됩니다:

### 1. `*.middleware.ts` - 미들웨어 구현체
- EXPRESS 미들웨어 함수들을 정의
- `WITH` 메서드에서 사용되는 실제 미들웨어 로직
- 팩토리 함수 패턴으로 구현

### 2. `*.middleware.interface.ts` - 미들웨어 파라미터 인터페이스
- `WITH` 메서드에 주입되는 파라미터의 타입 정의
- TypeScript 인터페이스로 구현

### 3. `*.module.ts` - Injectable 모듈
- 비즈니스 로직을 담은 서비스 클래스
- injectable 시스템에 로드되어 route 핸들러에서 `injected` 파라미터를 통해 접근

## 구현 예시

### 1. Middleware Interface (`*.middleware.interface.ts`)

```typescript
// auth/rateLimiter/option.middleware.interface.ts
import { RepositoryName } from '@lib/types/generated-repository-types'

export interface RateLimiterOptionMiddlewareParams {
    /**
     * 요청 제한을 위한 최대 요청 수
     * - 기본값은 100
     */
    maxRequests: number;

    /**
     * 시간 윈도우 길이 (밀리초 단위)
     * - 기본값은 60000 (1분)
     */
    windowMs: number;

    /**
     * 제한 초과 시 반환할 메시지
     */
    message?: string;

    /**
     * 사용할 레포지토리 이름
     */
    repositoryName: RepositoryName;
}
```

```typescript
// auth/guide.middleware.interface.ts
export interface AuthTryMiddlewareParams {
    requiredRoles: string[];
}
```

### 2. Middleware Implementation (`*.middleware.ts`)

```typescript
// auth/jwt/noLoginOnly.middleware.ts
import { Request, Response, NextFunction } from 'express';
import JWTService from './export.module';
import { TokenPayload } from './type';

export default () => {
    const jwt = new JWTService();
    let user: TokenPayload | undefined = undefined;
    
    const authenticate = (req: Request, res: Response, next: NextFunction) => {
        const token = jwt.extractTokenFromHeader(req.headers.authorization);

        // 토큰이 없으면 통과 (로그인하지 않은 상태여야 함)
        if (token === null) {
            return next();
        }

        try {
            // 토큰이 유효하면 이미 로그인된 상태이므로 접근 거부
            if (user = jwt.verifyAccessToken(token ?? '')) {
                return res.status(403).json({ 
                    error: 'Already logged in. Please logout first.' 
                });
            } else {
                return next();
            }
        } catch (error) {
            return next();
        }
    };

    return {
        authenticate,
    };
};
```

```typescript
// auth/rateLimiter/default.middleware.ts
import { Request, Response, NextFunction } from 'express';

export default () => {
    var token: string | null = null;

    return [        
        (req: Request, res: Response, next: NextFunction) => {
            const jwt = req.kusto.injectable.authJwtExport;
            token = jwt.extractTokenFromHeader(req.headers.authorization);
            next();
        },
        async (req: Request, res: Response, next: NextFunction) => {
            const jwt = req.kusto.injectable.authJwtExport;
            const param = req.with.authRateLimiterOption;
            var adminUUID: string | undefined = undefined;
            
            // Rate limiting 로직 구현...
            next();
        }
    ];
};
```

### 3. Module Implementation (`*.module.ts`)

```typescript
// auth/jwt/export.module.ts
// 필요한 패키지를 import하여 사용 (npm install 필요)

export default class JWTService {
    /**
     * 토큰에서 헤더 추출
     */
    public extractTokenFromHeader(authHeader?: string): string | null {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }
        return authHeader.substring(7);
    }

    // 비즈니스 로직 메서드 구현...
}
```

## Route에서의 사용법

```typescript
// app/routes/authorities/signin/route.ts
import { ExpressRouter } from '@lib/expressRouter';
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
    // validation schema...
    async (req, res, injected, repo, db) => {
        // injected 파라미터를 통해 module에 접근
        const jwt = injected.authJwtExport;                  
        const userRepo = repo.getRepository('accountUser');   
        const data = req.validatedData;
        
        // 비즈니스 로직...
        
        const accessToken = jwt.generateAccessToken({
            uuid: userInfo.uuid,
            email: userInfo.email,
            role: roles
        });
        
        return { accessToken };
    }
);
```

### Injectable 모듈 접근 방법

Route 핸들러에서 injectable 모듈은 `injected` 파라미터를 통해 접근할 수 있습니다:

```typescript
async (req, res, injected, repo, db) => {    
    const module = injected.exampleModule;  // 모듈명으로 접근
    // 모듈의 메서드 사용
    const result = await module.someMethod();
}    
```

## 주요 특징

1. **의존성 주입**: `WITH` 메서드를 통해 미들웨어 파라미터 주입
2. **타입 안전성**: TypeScript 인터페이스를 통한 타입 체크
3. **모듈화**: 각 기능별로 분리된 모듈 구조
4. **재사용성**: 여러 라우트에서 동일한 미들웨어 재사용 가능
5. **확장성**: 새로운 미들웨어와 모듈을 쉽게 추가 가능

## 네이밍 규칙

#### 모듈
- **Module**: `{기능명}.module.ts` 또는 `export.module.ts`


#### 미들웨어
- **Middleware**: `{기능명}.middleware.ts`
- **Middleware Interface**: `{파라미터명}.middleware.interface.ts`  


## 파일 위치

```
src/app/injectable/
├── auth/
│   ├── guide.middleware.interface.ts
│   ├── try.middleware.ts
│   ├── jsonWebToken.module.ts
│   ├── jwt/
│   │   ├── guide.middleware.interface.ts
│   │   ├── role.middleware.ts
│   │   ├── noLoginOnly.middleware.ts
│   │   └── export.module.ts
│   ├── rateLimiter/
│   │   ├── option.middleware.interface.ts
│   │   └── default.middleware.ts
│   └── csrf/
│       ├── referrer.middleware.ts
│       ├── middleware.module.ts
│       └── helper.module.ts
```

## 타입 생성 및 자동 완성

### 자동 타입 생성
Injectable 폴더의 파일명은 자동으로 camelCase로 변환되어 TypeScript 타입으로 생성됩니다:

- `auth/jwt/export.module.ts` → `authJwtExport`
- `auth/rateLimiter/default.middleware.ts` → `authRateLimiterDefault`
- `auth/jwt/noLoginOnly.middleware.ts` → `authJwtNoLoginOnly`

### 개발 환경 자동 적용
```bash
# 개발 서버 실행 시 자동으로 타입 생성
npm run dev        # nodemon으로 개발 서버 실행
npm run dev:serve  # nodemon으로 서브 서버 실행
```

nodemon이 파일 변경을 감지하면 타입 생성 스크립트가 자동으로 실행되어 IDE에서 즉시 자동 완성 힌트를 사용할 수 있습니다.

### IDE 자동 완성 예시
```typescript
// WITH 메서드에서 자동 완성
router.WITH('authJwtNoLoginOnly')  // IDE가 자동 완성 제안
router.WITH('authRateLimiterDefault', { ... })

// injected 파라미터에서 자동 완성
async (req, res, injected, repo, db) => {
    const jwt = injected.authJwtExport;  // IDE가 타입 힌트 제공
}
```

---

## 📖 문서 네비게이션

**◀️ 이전**: [🗄️ 데이터베이스 관리](./03-database-management.md)  
**▶️ 다음**: [🗂️ 리포지터리 패턴](./05-repository-pattern.md)
