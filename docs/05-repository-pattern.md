# 05. Repository Pattern

Repository Pattern은 데이터 액세스 로직을 추상화하여 비즈니스 로직과 분리하는 설계 패턴입니다. 이 프레임워크에서는 `app/repos` 폴더를 통해 구현되며, route 핸들러에서 `repo` 파라미터를 통해 접근할 수 있습니다.

## 시스템 구조

Repository 시스템은 다음과 같은 구조로 구성됩니다:

### 1. `*.repository.ts` - Repository 구현체
- `BaseRepository`를 상속받은 데이터 액세스 클래스
- **단일 데이터베이스 담당**: 각 Repository는 1개의 데이터베이스만 담당
- 각 도메인별로 데이터베이스 CRUD 및 비즈니스 로직 구현
- Prisma Client를 통한 타입 안전한 데이터베이스 접근
- 파일명이 camelCase로 변환되어 자동 타입 생성
- **필수 구조**: BaseRepository 제네릭과 getDatabaseName() 메서드 구현 필수

### 2. `*.types.ts` - Repository 타입 정의
- Repository에서 사용되는 인터페이스와 타입 정의
- 입력 데이터, 출력 데이터, 필터 옵션 등의 타입
- Repository 클래스에서 import하여 사용

## Repository 필수 구조

모든 `*.repository.ts` 파일은 다음 구조를 반드시 지켜야 합니다:

```typescript
import { BaseRepository } from '@lib/data/database/baseRepository';

export default class XXXRepository extends BaseRepository<'xxx'> {
    protected getDatabaseName(): 'xxx' {
        return 'xxx';
    }
    
    // 메서드 구현...
}
```

### 구조 설명

1. **BaseRepository 제네릭**: 데이터베이스 이름을 문자열로 지정 (단일 DB만 지정)
2. **getDatabaseName() 메서드**: 반드시 구현해야 하는 추상 메서드
3. **반환값 강제**: getDatabaseName()의 반환값은 BaseRepository 제네릭과 동일해야 함
4. **단일 DB 원칙**: 각 Repository는 하나의 데이터베이스에만 접근

이 구조는 TypeScript의 타입 시스템에 의해 강제되므로 잘못 설정할 수 없습니다.

## 구현 예시

### 1. Repository Types (`*.types.ts`)

```typescript
// repos/product/item.types.ts

export interface ItemBase {
    id: bigint;
    uuid: string;
    name: string;
    description: string | null;
    price: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface ItemCreateData {
    name: string;
    description?: string;
    price: number;
    categoryId: bigint;
}

export interface ItemUpdateData {
    name?: string;
    description?: string;
    price?: number;
    isActive?: boolean;
}
```

### 2. Repository Implementation (`*.repository.ts`)

```typescript
// repos/product/item.repository.ts
import { BaseRepository } from '@lib/data/database/baseRepository';
import { ItemBase, ItemCreateData, ItemUpdateData } from './item.types';

export default class ItemRepository extends BaseRepository<'product'> {
    
    protected getDatabaseName(): 'product' {
        return 'product';
    }

    ...
}
```


#### BaseRepository 주요 기능

| 메서드 | 접근 제한자 | 설명 | 사용 예시 |
|--------|-------------|------|-----------|
| `getDatabaseName()` | `protected abstract` | 데이터베이스 이름 반환 (필수 구현) | `return 'user';` |
| `client` | `protected get` | 타입 안전한 Prisma 클라이언트 접근 | `this.client.user.findMany()` |
| `$transaction()` | `public async` | 고급 트랜잭션 처리 (재시도, 모니터링) | `await this.$transaction(async (tx) => {...})` |
| `$createDistributedOperation()` | `public` | 타입 안전한 분산 트랜잭션 작업 객체 생성 헬퍼 | `this.$createDistributedOperation('user', operation)` |
| `$runDistributedTransaction()` | `public async` | 분산 트랜잭션 실행, 실패 시 자동 롤백 처리 (⚠️ 사용 권장하지 않음) | `await this.$runDistributedTransaction(operations)` |
| `$batchOperation()` | `public async` | 배치 작업 처리 | `await this.$batchOperation(items, processor)` |

#### 분산 트랜잭션 제약사항

`$runDistributedTransaction()` 메서드는 다중 DB 환경에서 수동 회귀(rollback) 구현을 위해 제공되지만, **실제 사용을 권장하지 않습니다**:

- **Prisma 제약**: Prisma의 강제적인 connection pool 관리로 인한 한계
- **신뢰성 부족**: 저수준 트랜잭션 관리가 불가능하여 신뢰 가능한 다중 DB 관리 불가
- **대안 권장**: 단일 DB 내 트랜잭션 또는 애플리케이션 레벨 보상 트랜잭션 사용 권장

## 주요 특징

1. **필수 구조 강제**: BaseRepository 제네릭과 getDatabaseName() 메서드로 타입 안전성 보장
2. **자동 타입 생성**: `*.repository.ts` 파일명이 camelCase로 변환되어 IDE에서 자동 완성
3. **코드 재사용**: BaseRepository를 통한 공통 기능 상속
4. **확장성**: 새로운 Repository를 쉽게 추가 가능
5. **의존성 주입**: Route 핸들러에서 `repo` 파라미터를 통한 Repository 접근

---

## 📖 문서 네비게이션

**◀️ 이전**: [🔌 의존성 주입 시스템](./04-injectable-system.md)  
**▶️ 다음**: [🔄 CRUD 라우터](./06-crud-router.md)



