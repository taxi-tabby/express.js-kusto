# JWTService - Database Callback Pattern

## 개요

JWTService는 데이터베이스 콜백 패턴을 사용하여 JWT 인증을 처리하는 서비스입니다. 이 패턴을 통해 인증 로직과 데이터베이스 연동을 분리하여 유연하고 테스트 가능한 코드를 작성할 수 있습니다.

## 주요 특징

- **콜백 기반 아키텍처**: 데이터베이스 연산을 콜백으로 위임하여 다양한 데이터베이스와 호환
- **완전한 인증 플로우**: 로그인, 회원가입, 토큰 갱신, 비밀번호 변경, 프로필 업데이트 등
- **미들웨어 지원**: Express.js 미들웨어로 인증 및 권한 검증
- **TypeScript 지원**: 완전한 타입 안전성
- **에러 처리**: 체계적인 에러 처리 및 콜백

## 핵심 인터페이스

### 데이터베이스 콜백 타입

```typescript
type UserLookupCallback = (email: string) => Promise<UserDbRecord | null>;
type UserCreateCallback = (userData: {
    email: string;
    hashedPassword: string;
    role?: string;
    [key: string]: any;
}) => Promise<UserDbRecord>;
type UserUpdateCallback = (userId: string, updates: Partial<UserDbRecord>) => Promise<UserDbRecord | null>;
```

### 사용자 데이터 인터페이스

```typescript
interface UserDbRecord {
    id: string;
    email: string;
    hashedPassword: string;
    role?: string;
    isActive?: boolean;
    [key: string]: any; // 추가 사용자 데이터
}
```

## 주요 메서드

### 1. 로그인 처리 (`handleSignIn`)

```typescript
await jwtService.handleSignIn(
    { email, password },
    userLookupCallback,
    // 성공 콜백
    async (result) => {
        // result.user, result.accessToken, result.refreshToken
        res.json(result);
    },
    // 실패 콜백
    async (error) => {
        res.status(401).json({ message: error });
    }
);
```

### 2. 회원가입 처리 (`handleSignUp`)

```typescript
await jwtService.handleSignUp(
    { email, password, role },
    userCreateCallback,
    userLookupCallback,
    // 성공 콜백
    async (result) => {
        // result.user, result.accessToken, result.refreshToken
        res.json(result);
    },
    // 실패 콜백
    async (error) => {
        res.status(400).json({ message: error });
    }
);
```

### 3. 토큰 갱신 (`handleRefresh`)

```typescript
await jwtService.handleRefresh(
    refreshToken,
    // 성공 콜백
    async (accessToken) => {
        res.json({ accessToken });
    },
    // 실패 콜백
    async (error) => {
        res.status(401).json({ message: error });
    }
);
```

### 4. 비밀번호 변경 (`handleChangePassword`)

```typescript
await jwtService.handleChangePassword(
    userId,
    currentPassword,
    newPassword,
    userLookupByIdCallback,
    userUpdateCallback,
    // 성공 콜백
    async () => {
        res.json({ message: '비밀번호 변경 완료' });
    },
    // 실패 콜백
    async (error) => {
        res.status(400).json({ message: error });
    }
);
```

### 5. 프로필 업데이트 (`handleUpdateProfile`)

```typescript
await jwtService.handleUpdateProfile(
    userId,
    updates,
    userUpdateCallback,
    // 성공 콜백
    async (updatedUser) => {
        res.json({ user: updatedUser });
    },
    // 실패 콜백
    async (error) => {
        res.status(400).json({ message: error });
    }
);
```

## 미들웨어 사용법

### 인증 미들웨어

```typescript
router.get('/protected',
    jwtService.authenticate({
        onSuccess: async (user) => {
            console.log('인증된 사용자:', user.email);
        },
        onFailure: async (error) => {
            console.log('인증 실패:', error);
        }
    }),
    (req, res) => {
        const user = jwtService.getCurrentUser(req);
        res.json({ user });
    }
);
```

### 권한 검증 미들웨어

```typescript
router.get('/admin-only',
    jwtService.authenticate(),
    jwtService.checkRole(
        'admin', // 또는 ['admin', 'moderator']
        // 성공 콜백
        async (user) => {
            console.log('관리자 접근:', user.email);
        },
        // 실패 콜백
        async (error) => {
            console.log('권한 부족:', error);
        }
    ),
    (req, res) => {
        res.json({ message: '관리자 전용 페이지' });
    }
);
```

### 토큰 자동 갱신 미들웨어

```typescript
router.use(jwtService.autoRefresh({
    minutesBefore: 5, // 5분 전 갱신
    onRefresh: async (newToken) => {
        console.log('새 토큰 발급:', newToken);
    }
}));
```

## 환경 변수

```env
JWT_ACCESS_SECRET=your-access-token-secret
JWT_REFRESH_SECRET=your-refresh-token-secret
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
BCRYPT_SALT_ROUNDS=10
```

## 데이터베이스 연동 예시

### MongoDB (Mongoose)

```typescript
const userLookupByEmail = async (email: string) => {
    return await User.findOne({ email }).exec();
};

const userCreate = async (userData: any) => {
    const user = new User(userData);
    return await user.save();
};

const userUpdate = async (userId: string, updates: any) => {
    return await User.findByIdAndUpdate(userId, updates, { new: true }).exec();
};
```

### PostgreSQL (Prisma)

```typescript
const userLookupByEmail = async (email: string) => {
    return await prisma.user.findUnique({ where: { email } });
};

const userCreate = async (userData: any) => {
    return await prisma.user.create({ data: userData });
};

const userUpdate = async (userId: string, updates: any) => {
    return await prisma.user.update({
        where: { id: userId },
        data: updates
    });
};
```

## 보안 고려사항

1. **환경 변수**: JWT 시크릿키는 반드시 환경 변수로 관리
2. **HTTPS**: 프로덕션에서는 반드시 HTTPS 사용
3. **토큰 만료**: 적절한 토큰 만료 시간 설정
4. **비밀번호 정책**: 강력한 비밀번호 정책 적용
5. **레이트 리미팅**: 로그인 시도 제한
6. **로깅**: 보안 이벤트 로깅

## 에러 처리

모든 메서드는 try-catch로 에러를 처리하고 적절한 에러 메시지를 콜백으로 전달합니다:

- 인증 실패: "이메일 또는 비밀번호가 올바르지 않습니다"
- 토큰 만료: "Access Token이 만료되었습니다"
- 권한 부족: "권한이 부족합니다"
- 사용자 없음: "사용자를 찾을 수 없습니다"

## 테스트

콜백 패턴을 사용하므로 모의(mock) 콜백을 제공하여 쉽게 테스트할 수 있습니다:

```typescript
const mockUserLookup = async (email: string) => {
    return mockUsers.find(user => user.email === email) || null;
};

// 테스트에서 사용
await jwtService.handleSignIn(
    credentials,
    mockUserLookup,
    successCallback,
    failureCallback
);
```

이 구조를 통해 JWTService는 데이터베이스에 의존하지 않으면서도 완전한 인증 기능을 제공합니다.
