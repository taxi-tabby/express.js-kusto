# 검증된 라우터 사용법

## 개요

이 시스템은 Express.js 라우터에서 자동으로 요청 검증, 응답 필터링, 에러 처리를 수행하는 기능을 제공합니다.

## 주요 기능

1. **자동 요청 검증**: body, query, params 데이터를 스키마에 따라 검증
2. **자동 응답 필터링**: 응답 데이터에서 정의된 필드만 반환
3. **타입 변환**: 문자열을 숫자나 불린으로 자동 변환
4. **에러 처리**: 검증 실패 시 표준화된 에러 응답
5. **추가 필드 제거**: 스키마에 없는 필드는 자동으로 제거

## 기본 사용법

### 1. 요청 검증만 사용

```typescript
router.GET_WITH_VALIDATION(
    {
        query: {
            name: { type: 'string', required: true },
            age: { type: 'number', required: false, min: 0 }
        }
    },
    async (req, res) => {
        const data = req.validatedData?.query;
        // data는 이미 검증된 상태
        return { message: `Hello ${data.name}` };
    }
);
```

### 2. 요청 + 응답 검증 사용

```typescript
router.POST_VALIDATED(
    {
        // 요청 검증
        body: {
            name: { type: 'string', required: true, min: 2, max: 50 },
            email: { type: 'email', required: true }
        }
    },
    {
        // 응답 검증 (상태코드별)
        200: {
            id: { type: 'number', required: true },
            name: { type: 'string', required: true },
            createdAt: { type: 'string', required: true }
        }
    },
    async (req, res) => {
        const userData = req.validatedData?.body;
        
        return {
            id: 123,
            name: userData.name,
            email: userData.email, // 응답 스키마에 없으므로 제거됨
            createdAt: new Date().toISOString()
        };
    }
);
```

## 스키마 정의

### 지원하는 데이터 타입

- `string`: 문자열
- `number`: 숫자 (자동 변환 지원)
- `boolean`: 불린 (자동 변환 지원)
- `array`: 배열
- `object`: 객체
- `email`: 이메일 형식
- `url`: URL 형식

### 검증 옵션

```typescript
interface FieldSchema {
    type: ValidatorType;
    required?: boolean;        // 필수 여부
    min?: number;             // 최소값/길이
    max?: number;             // 최대값/길이
    pattern?: RegExp;         // 정규식 패턴
    enum?: any[];            // 허용된 값들
    custom?: (value: any) => boolean | string;  // 커스텀 검증
}
```

### 스키마 예시

```typescript
const userSchema = {
    // 필수 문자열, 2-50자
    name: { 
        type: 'string', 
        required: true, 
        min: 2, 
        max: 50 
    },
    
    // 필수 이메일
    email: { 
        type: 'email', 
        required: true 
    },
    
    // 선택적 숫자, 0-120
    age: { 
        type: 'number', 
        required: false, 
        min: 0, 
        max: 120 
    },
    
    // 선택적 열거형
    role: { 
        type: 'string', 
        required: false, 
        enum: ['user', 'admin', 'moderator'] 
    },
    
    // 패턴 검증
    phone: {
        type: 'string',
        required: false,
        pattern: /^[0-9-]+$/
    },
    
    // 커스텀 검증
    password: {
        type: 'string',
        required: true,
        custom: (value) => {
            if (value.length < 8) return '8자 이상이어야 합니다';
            if (!/[A-Z]/.test(value)) return '대문자가 포함되어야 합니다';
            return true;
        }
    }
};
```

## 라우터 메서드

### 완전 검증 메서드 (요청 + 응답)

- `GET_VALIDATED(requestConfig, responseConfig, handler)`
- `POST_VALIDATED(requestConfig, responseConfig, handler)`
- `PUT_VALIDATED(requestConfig, responseConfig, handler)`
- `DELETE_VALIDATED(requestConfig, responseConfig, handler)`
- `PATCH_VALIDATED(requestConfig, responseConfig, handler)`

### 슬러그 포함 메서드

- `GET_SLUG_VALIDATED(slug, requestConfig, responseConfig, handler)`
- `POST_SLUG_VALIDATED(slug, requestConfig, responseConfig, handler)`

### 요청 검증만 하는 메서드

- `GET_WITH_VALIDATION(requestConfig, handler)`
- `POST_WITH_VALIDATION(requestConfig, handler)`

## 에러 응답 형식

검증 실패 시 자동으로 다음 형식의 에러 응답이 반환됩니다:

```json
{
    "success": false,
    "error": {
        "message": "Validation failed",
        "details": [
            {
                "field": "email",
                "message": "email is required",
                "source": "body"
            },
            {
                "field": "age",
                "message": "age must be a number",
                "source": "query"
            }
        ]
    },
    "timestamp": "2025-05-27T10:30:00.000Z"
}
```

## 성공 응답 형식

성공 시 다음 형식으로 응답됩니다:

```json
{
    "success": true,
    "data": {
        // 실제 데이터
    },
    "timestamp": "2025-05-27T10:30:00.000Z"
}
```

## 실제 사용 예시

### 사용자 생성 API

```typescript
// POST /api/users
router.POST_VALIDATED(
    {
        body: {
            name: { type: 'string', required: true, min: 2, max: 50 },
            email: { type: 'email', required: true },
            age: { type: 'number', required: false, min: 18, max: 100 }
        }
    },
    {
        200: {
            id: { type: 'number', required: true },
            name: { type: 'string', required: true },
            email: { type: 'string', required: true },
            createdAt: { type: 'string', required: true }
        }
    },
    async (req, res) => {
        const { name, email, age } = req.validatedData.body;
        
        // 비즈니스 로직
        const user = await createUser({ name, email, age });
        
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            age: user.age,        // 응답 스키마에 없으므로 제거됨
            password: '****',     // 응답 스키마에 없으므로 제거됨
            createdAt: user.createdAt
        };
    }
);
```

### 사용자 검색 API

```typescript
// GET /api/users/search?name=john&page=1&limit=10&active=true
router.GET_WITH_VALIDATION(
    {
        query: {
            name: { type: 'string', required: false, min: 1 },
            page: { type: 'number', required: false, min: 1 },
            limit: { type: 'number', required: false, min: 1, max: 100 },
            active: { type: 'boolean', required: false }
        }
    },
    async (req, res) => {
        const { name, page = 1, limit = 10, active } = req.validatedData.query;
        
        const users = await searchUsers({ name, active, page, limit });
        
        return {
            users,
            pagination: { page, limit, total: users.length }
        };
    }
);
```

## 하위 경로 매칭 제어

### 문제점
기본적으로 Express.js 라우터는 하위 경로도 매칭합니다. 예를 들어:
- `GET /users/:id` 는 `/users/123`뿐만 아니라 `/users/123/profile`, `/users/123/settings` 등도 매칭합니다.

### 해결책
`exact: true` 옵션을 사용하여 정확한 경로 매칭만 허용할 수 있습니다.

```typescript
// 하위 경로 매칭 방지
router.GET_SLUG_VALIDATED(
    ['id'],
    {
        params: {
            id: { type: 'number', required: true }
        }
    },
    {
        200: {
            id: { type: 'number', required: true },
            name: { type: 'string', required: true }
        }
    },
    async (req, res) => {
        return { id: req.validatedData.params.id, name: 'User' };
    },
    { exact: true } // 이 옵션으로 하위 경로 매칭 방지
);
```

### 동작 비교

```typescript
// exact: false (기본값) - 하위 경로도 매칭
router.GET_SLUG_VALIDATED(['category'], requestConfig, responseConfig, handler);
// 매칭: /electronics, /electronics/phones, /electronics/phones/samsung

// exact: true - 정확한 경로만 매칭
router.GET_SLUG_VALIDATED(['category'], requestConfig, responseConfig, handler, { exact: true });
// 매칭: /electronics 만
// 매칭 안됨: /electronics/phones, /electronics/phones/samsung
```

### 지원 메서드
- `GET_SLUG_VALIDATED(slug, requestConfig, responseConfig, handler, { exact: true })`
- `POST_SLUG_VALIDATED(slug, requestConfig, responseConfig, handler, { exact: true })`
- `PUT_SLUG_VALIDATED` (곧 추가 예정)
- `DELETE_SLUG_VALIDATED` (곧 추가 예정)

## 주의사항

1. **필드 누락**: 스키마에 정의되지 않은 필드는 자동으로 제거됩니다.
2. **타입 변환**: query parameters는 문자열로 전달되므로 자동 타입 변환이 수행됩니다.
3. **에러 처리**: 핸들러에서 throw한 에러는 자동으로 표준 에러 응답으로 변환됩니다.
4. **응답 검증**: 응답 스키마는 상태코드별로 정의할 수 있습니다.

이 시스템을 사용하면 일관된 API 응답 형식과 강력한 입력 검증을 통해 안전하고 예측 가능한 API를 구축할 수 있습니다.
