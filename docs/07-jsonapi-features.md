# JSON:API 기능 가이드

CRUD 라우터는 [JSON:API v1.1 스펙](https://jsonapi.org/format/)을 완전히 지원합니다.

## 1. JSON:API 기본 구조

### 표준 응답 형식
```json
{
  "data": {
    "type": "user",
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "attributes": {
      "name": "John Doe",
      "email": "john@example.com",
      "createdAt": "2025-07-20T10:30:00Z"
    },
    "relationships": {
      "posts": {
        "data": [
          { "type": "post", "id": "1" },
          { "type": "post", "id": "2" }
        ],
        "links": {
          "self": "/users/123e4567-e89b-12d3-a456-426614174000/relationships/posts",
          "related": "/users/123e4567-e89b-12d3-a456-426614174000/posts"
        }
      }
    },
    "links": {
      "self": "/users/123e4567-e89b-12d3-a456-426614174000"
    }
  },
  "jsonapi": {
    "version": "1.1"
  }
}
```

## 2. 관계 포함 (Compound Documents)

### Include 파라미터
```bash
# 단일 관계 포함
GET /users?include=posts

# 여러 관계 포함
GET /users?include=posts,profile,comments

# 중첩 관계 포함
GET /users?include=posts.comments,posts.author
```

### 응답 예시 (Included 섹션)
```json
{
  "data": [
    {
      "type": "user",
      "id": "1",
      "attributes": { "name": "John" },
      "relationships": {
        "posts": {
          "data": [{ "type": "post", "id": "1" }]
        }
      }
    }
  ],
  "included": [
    {
      "type": "post",
      "id": "1",
      "attributes": {
        "title": "Hello World",
        "content": "This is my first post"
      }
    }
  ],
  "jsonapi": { "version": "1.1" }
}
```

## 3. Sparse Fieldsets

특정 필드만 선택하여 응답 크기를 최적화할 수 있습니다.

### 필드 선택
```bash
# 사용자 정보에서 이름과 이메일만
GET /users?fields[users]=name,email

# 여러 리소스 타입의 필드 선택
GET /users?include=posts&fields[users]=name,email&fields[posts]=title,createdAt

# 관계 포함 + 필드 선택
GET /users?include=posts.author&fields[users]=name&fields[posts]=title&fields[authors]=name
```

### 응답 예시
```json
{
  "data": [
    {
      "type": "user",
      "id": "1",
      "attributes": {
        "name": "John Doe",
        "email": "john@example.com"
        // age, createdAt 등 다른 필드는 제외됨
      }
    }
  ]
}
```

## 4. 관계 전용 엔드포인트

### 관계 자체 관리
```bash
# 관계 정보 조회
GET /users/1/relationships/posts

# 응답 예시
{
  "data": [
    { "type": "post", "id": "1" },
    { "type": "post", "id": "2" }
  ],
  "links": {
    "self": "/users/1/relationships/posts",
    "related": "/users/1/posts"
  }
}
```

### 관련 리소스 조회
```bash
# 사용자의 모든 포스트 조회
GET /users/1/posts

# 필터링과 페이지네이션 지원
GET /users/1/posts?filter[status_eq]=published&page[size]=10
```

## 5. 페이지네이션 링크

### 표준 페이지네이션
```bash
GET /users?page[number]=2&page[size]=10
```

### 응답 링크
```json
{
  "data": [...],
  "links": {
    "self": "/users?page[number]=2&page[size]=10",
    "first": "/users?page[number]=1&page[size]=10",
    "prev": "/users?page[number]=1&page[size]=10",
    "next": "/users?page[number]=3&page[size]=10",
    "last": "/users?page[number]=10&page[size]=10"
  },
  "meta": {
    "total": 100,
    "count": 10,
    "page": {
      "current": 2,
      "size": 10,
      "total": 10
    }
  }
}
```

## 6. 에러 처리

### JSON:API 에러 형식
```json
{
  "jsonapi": { "version": "1.1" },
  "errors": [
    {
      "status": "404",
      "code": "NOT_FOUND",
      "title": "Not Found",
      "detail": "User not found",
      "source": {
        "pointer": "/users/invalid-id"
      },
      "meta": {
        "timestamp": "2025-07-20T10:30:00Z"
      }
    }
  ]
}
```

## 7. 생성 및 수정 요청

### JSON:API 요청 형식
```bash
# 사용자 생성
POST /users
Content-Type: application/vnd.api+json

{
  "data": {
    "type": "user",
    "attributes": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

### 수정 요청
```bash
# 사용자 수정
PATCH /users/1
Content-Type: application/vnd.api+json

{
  "data": {
    "type": "user",
    "id": "1",
    "attributes": {
      "name": "Jane Doe"
    }
  }
}
```

## 8. 고급 쿼리 예시

### 복합 쿼리
```bash
# 완전한 JSON:API 쿼리
GET /users?include=posts.comments,profile&fields[users]=name,email&fields[posts]=title,createdAt&fields[comments]=content&filter[status_eq]=active&sort=-createdAt&page[number]=1&page[size]=20
```

### 응답 구조
- **data**: 주요 리소스 데이터
- **included**: 포함된 관련 리소스들
- **links**: 페이지네이션 및 관계 링크
- **meta**: 메타데이터 (총 개수, 페이지 정보 등)
- **jsonapi**: JSON:API 버전 정보

## 9. 지원되는 기능 목록

✅ **완전 구현됨**
- JSON:API 1.1 스펙 준수
- Resource Objects (type, id, attributes, relationships, links)
- Compound Documents (included 섹션)
- Sparse Fieldsets (fields[type] 파라미터)
- Relationship 전용 엔드포인트
- 페이지네이션 링크
- 표준 에러 형식
- Content-Type 헤더 (`application/vnd.api+json`)

✅ **기존 기능과 호환**
- 필터링 (filter[field_op] 형식)
- 정렬 (sort 파라미터)
- 페이지네이션 (page[number], page[size])
- Soft Delete 지원
- 미들웨어 통합
- 유효성 검증

## 10. 마이그레이션 가이드

기존 CRUD 라우터를 사용하고 있다면 자동으로 JSON:API 형식이 적용됩니다:

```typescript
// 기존 코드 (변경 없음)
router.CRUD('user', 'user', {
    primaryKey: 'uuid',
    softDelete: {
        enabled: true,
        field: 'deletedAt'
    }
});

// 이제 자동으로 JSON:API 스펙을 지원합니다:
// - GET /users (컬렉션 조회)
// - GET /users/:uuid (단일 조회) 
// - GET /users/:uuid/relationships/:relation (관계 조회)
// - GET /users/:uuid/:relation (관련 리소스 조회)
// - POST /users (생성)
// - PATCH /users/:uuid (수정)
// - DELETE /users/:uuid (삭제)
```
