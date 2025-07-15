# CRUD 라우터 가이드

CRUD 자동 생성 시스템을 이용한 REST API 엔드포인트 구현 가이드입니다.

## 1. CRUD 라우터 기본 사용법

### 기본 CRUD 생성
```typescript
// routes/users/route.ts
import { ExpressRouter } from '@lib/expressRouter';

const router = new ExpressRouter();

// 기본 사용법 - ID 기반 CRUD
router.CRUD('user', 'user');

export default router.build();
```

### UUID 기반 CRUD
```typescript
// UUID 기반 사용자 CRUD
router.CRUD('user', 'user', {
    primaryKey: 'uuid',
});
```

### 자동 생성되는 엔드포인트
CRUD 메서드는 다음과 같은 REST API 엔드포인트를 자동으로 생성합니다:

| 메서드 | 경로 | 작업 | 설명 |
|--------|------|------|------|
| `GET` | `/` | `index` | 리스트 조회 (필터링, 정렬, 페이징 지원) |
| `GET` | `/:identifier` | `show` | 단일 항목 조회 |
| `POST` | `/` | `create` | 새 항목 생성 |
| `PUT` | `/:identifier` | `update` | 항목 전체 수정 |
| `PATCH` | `/:identifier` | `update` | 항목 부분 수정 |
| `DELETE` | `/:identifier` | `destroy` | 항목 삭제 |
| `POST` | `/:identifier/recover` | `recover` | 항목 복구 (Soft Delete 시) |

## 2. CRUD 옵션 설정

### 특정 작업만 생성
```typescript
// 읽기 전용 API (index, show만)
router.CRUD('user', 'user', {
    only: ['index', 'show']
});

// 생성/수정 제외
router.CRUD('user', 'user', {
    except: ['create', 'update']
});
```

### Primary Key 설정
```typescript
// UUID Primary Key
router.CRUD('user', 'user', {
    primaryKey: 'uuid',
    primaryKeyParser: ExpressRouter.parseUuid
});

// 정수 Primary Key
router.CRUD('user', 'user', {
    primaryKey: 'id',
    primaryKeyParser: ExpressRouter.parseInt
});

// 문자열 Primary Key (기본값)
router.CRUD('user', 'user', {
    primaryKey: 'slug',
    primaryKeyParser: ExpressRouter.parseString
});
```

### 미들웨어 적용
```typescript
router.CRUD('user', 'user', {
    middleware: {
        index: [authMiddleware, logMiddleware],
        show: [authMiddleware],
        create: [authMiddleware, validationMiddleware],
        update: [authMiddleware, ownershipMiddleware],
        destroy: [authMiddleware, adminOnlyMiddleware],
        recover: [authMiddleware, adminOnlyMiddleware]
    }
});
```

### 유효성 검증
```typescript
router.CRUD('user', 'user', {
    validation: {
        create: {
            body: {
                name: { required: true, type: 'string' },
                email: { required: true, type: 'email' },
                age: { type: 'number', min: 18 }
            }
        },
        update: {
            body: {
                name: { type: 'string' },
                email: { type: 'email' },
                age: { type: 'number', min: 18 }
            }
        },
        recover: {
            params: {
                id: { required: true, type: 'uuid' }
            }
        }
    }
});
```

### 훅(Hooks) 설정
```typescript
router.CRUD('user', 'user', {
    hooks: {
        beforeCreate: async (data, req) => {
            // 생성 전 데이터 가공
            data.createdBy = req.user.id;
            return data;
        },
        afterCreate: async (result, req) => {
            // 생성 후 추가 작업
            console.log(`User created: ${result.id}`);
            return result;
        },
        beforeUpdate: async (data, req) => {
            // 수정 전 데이터 가공
            data.updatedBy = req.user.id;
            return data;
        },
        afterUpdate: async (result, req) => {
            // 수정 후 추가 작업
            console.log(`User updated: ${result.id}`);
            return result;
        },
        beforeDestroy: async (id, req) => {
            // 삭제 전 검증
            console.log(`Deleting user: ${id}`);
        },
        afterDestroy: async (id, req) => {
            // 삭제 후 정리 작업
            console.log(`User deleted: ${id}`);
        },
        beforeRecover: async (id, req) => {
            // 복구 전 검증
            console.log(`Recovering user: ${id}`);
        },
        afterRecover: async (result, req) => {
            // 복구 후 추가 작업
            console.log(`User recovered: ${result.id}`);
        }
    }
});
```

## 3. 실제 사용 예제

### 블로그 포스트 라우터
```typescript
// routes/posts/route.ts
import { ExpressRouter } from '@lib/expressRouter';

const router = new ExpressRouter();

// UUID 기반 포스트 CRUD
router.CRUD('user', 'post', {
    primaryKey: 'uuid',
    primaryKeyParser: ExpressRouter.parseUuid,
    middleware: {
        index: [logMiddleware],
        create: [authMiddleware, validationMiddleware],
        update: [authMiddleware, ownershipMiddleware],
        destroy: [authMiddleware, ownershipMiddleware]
    },
    validation: {
        create: {
            body: {
                title: { required: true, type: 'string', maxLength: 200 },
                content: { required: true, type: 'string' },
                categoryId: { required: true, type: 'uuid' }
            }
        },
        update: {
            body: {
                title: { type: 'string', maxLength: 200 },
                content: { type: 'string' },
                categoryId: { type: 'uuid' }
            }
        }
    }
});

export default router.build();
```

### 사용자 관리 라우터
```typescript
// routes/users/route.ts
import { ExpressRouter } from '@lib/expressRouter';

const router = new ExpressRouter();

// UUID 기반 사용자 CRUD
router.CRUD('user', 'user', {
    primaryKey: 'uuid',
    primaryKeyParser: ExpressRouter.parseUuid,
    middleware: {
        index: [authMiddleware, adminOnlyMiddleware],
        show: [authMiddleware],
        create: [authMiddleware, adminOnlyMiddleware],
        update: [authMiddleware, selfOrAdminMiddleware],
        destroy: [authMiddleware, adminOnlyMiddleware]
    },
    except: ['destroy'], // 사용자 삭제는 별도 soft delete 로직 사용
    validation: {
        create: {
            body: {
                email: { required: true, type: 'email' },
                name: { required: true, type: 'string', minLength: 2 },
                role: { type: 'string', enum: ['user', 'admin'] }
            }
        }
    },
    hooks: {
        beforeCreate: async (data, req) => {
            data.createdBy = req.user.id;
            data.createdAt = new Date();
            return data;
        },
        afterCreate: async (result, req) => {
            // 환영 이메일 발송 등
            await sendWelcomeEmail(result.email);
            return result;
        }
    }
});

export default router.build();
```

### 읽기 전용 API
```typescript
// routes/categories/route.ts
import { ExpressRouter } from '@lib/expressRouter';

const router = new ExpressRouter();

// 카테고리는 읽기 전용
router.CRUD('user', 'category', {
    only: ['index', 'show'],
    primaryKey: 'id',
    primaryKeyParser: ExpressRouter.parseInt
});

export default router.build();
```

### 정수 ID 기반 CRUD
```typescript
// routes/comments/route.ts
import { ExpressRouter } from '@lib/expressRouter';

const router = new ExpressRouter();

// 정수 ID 기반 댓글 CRUD
router.CRUD('user', 'comment', {
    primaryKey: 'id',
    primaryKeyParser: ExpressRouter.parseInt,
    middleware: {
        create: [authMiddleware, rateLimitMiddleware],
        update: [authMiddleware, ownershipMiddleware],
        destroy: [authMiddleware, ownershipOrAdminMiddleware]
    }
});

export default router.build();
```

## 4. Primary Key 파서 종류

CRUD 라우터에서 제공하는 기본 파서들:

### ExpressRouter.parseUuid
```typescript
// UUID 형식 검증 (예: 123e4567-e89b-12d3-a456-426614174000)
router.CRUD('user', 'user', {
    primaryKey: 'uuid',
    primaryKeyParser: ExpressRouter.parseUuid
});
```

### ExpressRouter.parseInt
```typescript
// 정수 형식 검증 (예: 123, 456)
router.CRUD('user', 'comment', {
    primaryKey: 'id',
    primaryKeyParser: ExpressRouter.parseInt
});
```

### ExpressRouter.parseString
```typescript
// 문자열 그대로 사용 (기본값)
router.CRUD('user', 'product', {
    primaryKey: 'slug',
    primaryKeyParser: ExpressRouter.parseString
});
```

### 커스텀 파서
```typescript
// 커스텀 파서 예시
const parseCustomId = (value: string): string => {
    if (!/^[A-Z]{3}-\d{6}$/.test(value)) {
        throw new Error(`Invalid custom ID format: ${value}`);
    }
    return value;
};

router.CRUD('user', 'order', {
    primaryKey: 'orderCode',
    primaryKeyParser: parseCustomId
});
```

## 5. 옵션 우선순위

### only vs except
```typescript
// only와 except를 동시에 사용하면 경고가 출력되고 only가 우선됩니다
router.CRUD('user', 'user', {
    only: ['index', 'show'],    // 이것이 우선됨
    except: ['destroy']         // 이것은 무시됨 (경고 출력)
});
```

### 기본 액션
지정하지 않으면 모든 액션이 활성화됩니다:
- `index`, `show`, `create`, `update`, `destroy`, `recover`

## 3. 관계 필터링 (Relationship Filtering)

### 기본 관계 필터링
```bash
# 특정 작성자 이름으로 포스트 검색
GET /posts?filter[author.name_like]=%김%

# 특정 카테고리의 포스트 검색
GET /posts?filter[category.name_eq]=기술

# 특정 태그들을 가진 포스트 검색
GET /posts?filter[tags.name_in]=javascript,typescript
```

### 배열 관계 조건
```bash
# 모든 태그가 조건을 만족하는 포스트 (every)
GET /posts?filter[tags.name_every_in]=javascript,react

# 일부 태그가 조건을 만족하는 포스트 (some) - 기본값
GET /posts?filter[tags.name_some_in]=javascript,react
```

### 중첩 관계 필터링
```bash
# 작성자의 프로필 정보로 필터링
GET /posts?filter[author.profile.bio_contains]=개발자

# 댓글 작성자로 필터링
GET /posts?filter[comments.author.name_like]=%김%
```

## 2. 관계 정렬 (Relationship Sorting)

### 관계 필드로 정렬
```bash
# 작성자 이름순 정렬
GET /posts?sort=author.name

# 작성자 이름 역순 정렬
GET /posts?sort=-author.name

# 카테고리 이름 + 생성일 정렬
GET /posts?sort=category.name,createdAt
```

## 3. 관계 포함 (Include Relationships)

### 기본 관계 포함
```bash
# 작성자 정보 포함
GET /posts?include=author

# 여러 관계 포함
GET /posts?include=author,category,tags
```

### 중첩 관계 포함
```bash
# 작성자와 작성자의 프로필 포함
GET /posts?include=author.profile

# 댓글과 댓글 작성자 포함
GET /posts?include=comments.author
```

## 4. 선택적 필드 로딩 (Select Fields)

### 기본 필드 선택
```bash
# 특정 필드만 선택
GET /posts?select=id,title,createdAt

# 관계 필드의 특정 필드만 선택
GET /posts?select=id,title,author.name,author.email
```

### 중첩 관계 필드 선택
```bash
# 중첩된 관계에서 특정 필드만 선택
GET /posts?select=id,title,author.name,author.profile.bio
```

## 5. 복합 쿼리 예제

### 고급 쿼리 조합
```bash
# 복합 조건: 특정 카테고리 + 작성자 이름 + 정렬 + 필드 선택
GET /posts?filter[category.name_eq]=기술&filter[author.name_like]=%김%&sort=author.name&select=id,title,author.name,category.name

# 페이징과 함께 관계 쿼리
GET /posts?filter[tags.name_in]=javascript,react&include=author,tags&page[number]=2&page[size]=10&sort=-createdAt
```

## 6. 지원되는 필터 연산자

### 텍스트 연산자
- `eq` (equals): 정확히 일치
- `ne` (not equals): 일치하지 않음
- `like`: 부분 일치 (LIKE %value%)
- `ilike`: 대소문자 무시 부분 일치
- `in`: 값 목록 중 하나
- `notin`: 값 목록에 없음
- `contains`: 포함 (문자열)
- `startswith`: 시작 문자열
- `endswith`: 끝 문자열

### 숫자/날짜 연산자
- `gt` (greater than): 초과
- `gte` (greater than or equal): 이상
- `lt` (less than): 미만
- `lte` (less than or equal): 이하

### 기타 연산자
- `null`: null 값
- `notnull`: null이 아닌 값

## 7. 실제 사용 예제

### 블로그 시스템 라우터 구성
```typescript
// routes/posts/route.ts
import { ExpressRouter } from '@lib/expressRouter';

const router = new ExpressRouter();

// UUID 기반 포스트 CRUD
router.CRUD('user', 'post', {
    primaryKey: 'uuid',
    middleware: {
        index: [logMiddleware],
        create: [authMiddleware, validationMiddleware],
        update: [authMiddleware, ownershipMiddleware],
        destroy: [authMiddleware, ownershipMiddleware]
    },
    validation: {
        create: {
            body: {
                title: { required: true, type: 'string', maxLength: 200 },
                content: { required: true, type: 'string' },
                categoryId: { required: true, type: 'uuid' }
            }
        },
        update: {
            body: {
                title: { type: 'string', maxLength: 200 },
                content: { type: 'string' },
                categoryId: { type: 'uuid' }
            }
        }
    }
});

export default router.build();
```

### 사용자 관리 라우터
```typescript
// routes/users/route.ts
import { ExpressRouter } from '@lib/expressRouter';

const router = new ExpressRouter();

// UUID 기반 사용자 CRUD (관리자 전용)
router.CRUD('user', 'user', {
    primaryKey: 'uuid',
    middleware: {
        index: [authMiddleware, adminOnlyMiddleware],
        show: [authMiddleware],
        create: [authMiddleware, adminOnlyMiddleware],
        update: [authMiddleware, selfOrAdminMiddleware],
        destroy: [authMiddleware, adminOnlyMiddleware]
    },
    except: ['destroy'], // 사용자 삭제는 별도 soft delete 로직 사용
    validation: {
        create: {
            body: {
                email: { required: true, type: 'email' },
                name: { required: true, type: 'string', minLength: 2 },
                role: { type: 'string', enum: ['user', 'admin'] }
            }
        }
    }
});

export default router.build();
```

### 읽기 전용 API
```typescript
// routes/categories/route.ts
import { ExpressRouter } from '@lib/expressRouter';

const router = new ExpressRouter();

// 카테고리는 읽기 전용
router.CRUD('user', 'category', {
    only: ['index', 'show'],
    primaryKey: 'id'
});

export default router.build();
```

### 사용 가능한 쿼리들:
```bash
# 1. 특정 사용자의 모든 포스트
GET /posts?filter[authorId_eq]=123e4567-e89b-12d3-a456-426614174000

# 2. 제목에 "React"가 포함된 포스트, 작성자 정보 포함
GET /posts?filter[title_contains]=React&include=author

# 3. JavaScript 또는 TypeScript 태그가 있는 포스트
GET /posts?filter[tags.name_in]=JavaScript,TypeScript&include=tags

# 4. 최근 한 달간의 포스트, 작성자명으로 정렬
GET /posts?filter[createdAt_gte]=2024-01-01&sort=author.name&include=author

# 5. 특정 카테고리의 포스트, 제목과 작성자명만 선택
GET /posts?filter[category.name_eq]=기술&select=title,author.name
```

## 8. 에러 처리

관계 쿼리에서 발생할 수 있는 에러들과 환경별 응답:

### 개발 환경에서의 에러 응답
```json
{
  "error": {
    "message": "Invalid `client[modelName].findUnique()` invocation...",
    "code": "VALIDATION_ERROR",
    "status": 400,
    "timestamp": "2025-07-14T07:47:16.694Z",
    "path": "/users/invalid-id",
    "details": {
      "type": "VALIDATION_ERROR",
      "invalidField": "xzcxcz",
      "prismaVersion": "6.11.0"
    },
    "stack": "PrismaClientValidationError: ..."
  },
  "success": false
}
```

### 프로덕션 환경에서의 에러 응답
```json
{
  "error": {
    "message": "입력 데이터가 올바르지 않습니다.",
    "code": "VALIDATION_ERROR",
    "status": 400,
    "timestamp": "2025-07-14T07:47:16.694Z"
  },
  "success": false
}
```

### 주요 에러 코드들
- `VALIDATION_ERROR`: 잘못된 쿼리 파라미터
- `NOT_FOUND`: 리소스를 찾을 수 없음
- `INVALID_UUID`: 잘못된 UUID 형식
- `DATABASE_ERROR`: 데이터베이스 처리 오류

---

## 📖 문서 네비게이션

**◀️ 이전**: [🗂️ 리포지터리 패턴](./05-repository-pattern.md)  
**▶️ 다음**: [🔄 업데이트 시스템](./07-update-system.md)

