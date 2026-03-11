# CRUD Schema API

Express.js 기반 프로젝트에서 Prisma CRUD 메서드 사용 시 개발 모드에서만 자동으로 스키마 정보를 등록하고 조회할 수 있는 API를 제공합니다.

## 특징

- **개발 모드 전용**: `NODE_ENV=development` 또는 `ENABLE_SCHEMA_API=true`일 때만 활성화
- **자동 스키마 등록**: `ExpressRouter.CRUD()` 메서드 호출 시 자동으로 스키마 정보 등록
- **Prisma 기반**: Prisma DMMF(Data Model Meta Format)를 분석하여 정확한 스키마 정보 제공
- **보안**: 로컬호스트에서만 접근 가능 (프로덕션 환경에서 추가 보안)

## 설정

### 1. 환경 변수 설정

```bash
# 개발 모드 활성화
NODE_ENV=development

# 또는 명시적으로 스키마 API 활성화
ENABLE_SCHEMA_API=true
```

### 2. Express 애플리케이션에 스키마 API 등록

```typescript
import express from 'express';
import { SchemaApiSetup } from '@core/lib/schemaApiSetup';

const app = express();

// 스키마 API 등록 (개발 모드에서만)
SchemaApiSetup.registerSchemaApi(app, '/api/schema');

app.listen(3000, () => {
  console.log('서버가 시작되었습니다');
});
```

### 3. CRUD 라우터 사용

```typescript
import { ExpressRouter } from '@core/lib/expressRouter';

const router = new ExpressRouter();

// CRUD 메서드 사용 시 자동으로 스키마가 등록됩니다
router.CRUD('default', 'User', {
  only: ['index', 'show', 'create', 'update'],
  softDelete: {
    enabled: true,
    field: 'deletedAt'
  },
  validation: {
    create: {
      body: {
        email: { type: 'email', required: true },
        name: { type: 'string', required: true }
      }
    }
  }
});

export default router.build();
```

## API 엔드포인트

### 모든 스키마 목록 조회
```http
GET /api/schema/
```

**응답 예시:**
```json
{
  "success": true,
  "data": {
    "schemas": [
      {
        "databaseName": "default",
        "modelName": "User",
        "basePath": "/user",
        "primaryKey": "id",
        "primaryKeyType": "string",
        "enabledActions": ["index", "show", "create", "update"],
        "endpoints": [
          {
            "method": "GET",
            "path": "/user",
            "action": "index",
            "description": "리스트 조회 (필터링, 정렬, 페이징 지원)"
          }
        ],
        "model": {
          "name": "User",
          "fields": [
            {
              "name": "id",
              "type": "String",
              "jsType": "string",
              "isId": true,
              "isOptional": false
            }
          ]
        },
        "createdAt": "2025-08-03T10:30:00.000Z"
      }
    ],
    "models": [...],
    "databases": ["default"],
    "totalSchemas": 1,
    "environment": "development"
  }
}
```

### 특정 데이터베이스의 스키마들 조회
```http
GET /api/schema/database/{databaseName}
```

### 특정 스키마 상세 조회
```http
GET /api/schema/{databaseName}/{modelName}
```

### 스키마 통계 정보
```http
GET /api/schema/meta/stats
```

**응답 예시:**
```json
{
  "success": true,
  "data": {
    "totalSchemas": 5,
    "totalDatabases": 2,
    "totalModels": 5,
    "actionStats": {
      "index": 5,
      "show": 5,
      "create": 4,
      "update": 4,
      "destroy": 3
    },
    "databaseStats": {
      "default": 3,
      "analytics": 2
    },
    "recentlyRegistered": [...]
  }
}
```

### 헬스체크
```http
GET /api/schema/meta/health
```

## 보안

### 개발 모드 제한
- `NODE_ENV=development` 또는 `ENABLE_SCHEMA_API=true`일 때만 활성화
- 프로덕션 환경에서는 자동으로 비활성화

### IP 접근 제한
- 기본적으로 로컬호스트(127.0.0.1, ::1)에서만 접근 가능
- `ENABLE_SCHEMA_API=true`로 설정하면 모든 IP에서 접근 가능 (주의 필요)

### 오류 응답 예시
```json
{
  "success": false,
  "error": {
    "code": "SCHEMA_API_DISABLED",
    "message": "스키마 API는 개발 환경에서만 사용할 수 있습니다.",
    "hint": "NODE_ENV=development로 설정하거나 ENABLE_SCHEMA_API=true 환경변수를 설정하세요."
  }
}
```

## 프로그래밍 방식 접근

### 스키마 레지스트리 직접 사용
```typescript
import { CrudSchemaRegistry } from '@core/lib/crudSchemaRegistry';

const registry = CrudSchemaRegistry.getInstance();

// 스키마 API 활성화 여부 확인
if (registry.isSchemaApiEnabled()) {
  // 모든 스키마 조회
  const allSchemas = registry.getAllSchemas();
  
  // 특정 스키마 조회
  const userSchema = registry.getSchema('default', 'User');
}
```

### Prisma 스키마 분석기 사용
```typescript
import { PrismaSchemaAnalyzer } from '@core/lib/prismaSchemaAnalyzer';
import { prismaManager } from '@lib/prismaManager';

const client = prismaManager.getClient('default');
const analyzer = PrismaSchemaAnalyzer.getInstance(client);

// 모든 모델 정보 조회
const models = analyzer.getAllModels();

// 특정 모델 조회
const userModel = analyzer.getModel('User');

// 기본 키 필드 조회
const primaryKey = analyzer.getPrimaryKeyField('User');

// 필수 필드들 조회
const requiredFields = analyzer.getRequiredFields('User');
```

## 개발 팁

### 1. 개발 서버 시작 시 확인
```bash
npm run dev
```

서버 시작 시 다음과 같은 로그를 확인할 수 있습니다:
```
🔧 CRUD Schema API가 개발 모드에서 활성화되었습니다.
🔍 Prisma 스키마 분석기가 초기화되었습니다.
📋 CRUD 스키마 API가 등록되었습니다:
   GET /api/schema/ - 모든 스키마 목록
   ...
✅ CRUD 스키마 등록: default.User (4개 액션)
```

### 2. 브라우저에서 확인
개발 중에 `http://localhost:3000/api/schema/`로 접속하여 등록된 스키마들을 확인할 수 있습니다.

### 3. API 도구 사용
Postman, Insomnia, 또는 VS Code REST Client를 사용하여 스키마 API를 테스트할 수 있습니다.

## 제한사항

1. **개발 모드 전용**: 프로덕션 환경에서는 사용할 수 없습니다.
2. **Prisma 종속**: Prisma를 사용하는 프로젝트에서만 작동합니다.
3. **메모리 저장**: 스키마 정보는 메모리에 저장되므로 서버 재시작 시 초기화됩니다.

## 트러블슈팅

### 스키마 API가 활성화되지 않는 경우
1. `NODE_ENV=development` 또는 `ENABLE_SCHEMA_API=true` 설정 확인
2. `SchemaApiSetup.registerSchemaApi()` 호출 확인
3. Prisma 클라이언트 초기화 상태 확인

### 스키마가 등록되지 않는 경우
1. `ExpressRouter.CRUD()` 메서드 호출 확인
2. 모델명이 Prisma 스키마와 일치하는지 확인
3. 콘솔 로그에서 오류 메시지 확인

### 403 Forbidden 오류
1. 로컬호스트에서 접근하고 있는지 확인
2. 개발 모드 설정 확인
3. `ENABLE_SCHEMA_API=true` 설정으로 IP 제한 해제 고려
