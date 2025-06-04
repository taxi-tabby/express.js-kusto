# Express.js-Kusto

Express.js-Kusto는 타입스크립트 기반 엔터프라이즈급 백엔드 프레임워크입니다. Express.js의 확장성과 유연성을 기반으로 하되, 타입 안전성, 모듈화, 자동 통합 기능을 추가하여 대규모 애플리케이션 개발에 최적화되어 있습니다.

## 주요 기능

- **타입 안전성**: TypeScript의 강력한 타입 시스템을 활용한 엔드-투-엔드 타입 안전성
- **멀티 데이터베이스 지원**: 여러 데이터베이스를 동시에 관리하는 기능
- **자동 문서화**: API 엔드포인트 자동 문서화 및 테스트 케이스 생성
- **의존성 주입**: 모듈 간의 결합도를 낮추는 의존성 주입 시스템
- **보안 중심 설계**: 기본적인 보안 위협 탐지 및 방어 매커니즘
- **자동화된 통합**: 네 가지 핵심 폴더(db, repos, injectable, routes) 간의 자동 통합

## 시작하기

### 1. 설치

```bash
# 클론 후 의존성 설치
git clone <repository-url>
cd express.js-kusto
npm install

# 개발 모드 시작
npm run dev
```

### 2. 환경 설정

`.env` 파일을 프로젝트 루트에 생성하고 필요한 환경 변수를 설정하세요:

```
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
RDS_DEFAULT_URL=postgresql://username:password@localhost:5432/your_database
AUTO_DOCS=true
```

## 아키텍처와 사용법

Express.js-Kusto는 네 개의 핵심 폴더를 통해 작동합니다:

### 1. 데이터베이스 설정 (`app/db/`)

각 데이터베이스는 자체 폴더와 Prisma 스키마를 가지며, 자동으로 통합됩니다.

```
app/db/
├── admin/           # 관리자용 데이터베이스
│   ├── schema.prisma
│   └── client/      # Prisma가 자동 생성
└── user/            # 사용자용 데이터베이스
    ├── schema.prisma
    └── client/      # Prisma가 자동 생성
```

#### 데이터베이스 추가 예시:

1. 새로운 데이터베이스 폴더 생성:

```bash
mkdir -p src/app/db/product
```

2. Prisma 스키마 파일 생성:

```prisma
// src/app/db/product/schema.prisma
generator client {
  provider = "prisma-client-js"
  output   = "client"
}

datasource db {
  provider = "postgresql"
  url      = env("RDS_PRODUCT_URL")
}

model Product {
  id          BigInt   @id @default(autoincrement())
  name        String
  description String?
  price       Decimal
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

3. 클라이언트 생성:

```bash
npx prisma generate --schema=./src/app/db/product/schema.prisma
```

4. 타입 자동 생성:

```bash
npm run generate-db-types
```

### 2. 리포지토리 구현 (`app/repos/`)

데이터베이스 액세스 계층으로, 각 리포지토리는 특정 도메인 모델에 대한 CRUD 작업을 캡슐화합니다.

```typescript
// src/app/repos/product/product.repository.ts
import { BaseRepository } from '@core/lib/baseRepository';

export default class ProductRepository extends BaseRepository {
  private getProductDb() {
    return this.db.getWrap('product');
  }
  
  async findById(id: bigint): Promise<any> {
    return this.getProductDb().product.findUnique({
      where: { id }
    });
  }
  
  async findAll(page: number = 1, limit: number = 10): Promise<any[]> {
    return this.getProductDb().product.findMany({
      skip: (page - 1) * limit,
      take: limit
    });
  }
  
  async create(data: any): Promise<any> {
    return this.getProductDb().product.create({
      data
    });
  }
}
```

이후 `npm run generate-repositories` 명령어를 실행하면, 리포지토리가 자동으로 통합됩니다.

### 3. 인젝터블 모듈 구현 (`app/injectable/`)

비즈니스 로직이나 서비스를 포함하는 주입 가능한 모듈입니다.

```typescript
// src/app/injectable/product/productService.module.ts
export default class ProductServiceModule {
  async calculateDiscount(price: number, discountPercentage: number): Promise<number> {
    return price * (1 - discountPercentage / 100);
  }
  
  async validateProduct(product: any): Promise<boolean> {
    // 검증 로직
    return price > 0 && product.name.length > 0;
  }
}
```

이후 `npm run generate-injectables` 명령어를 실행하면, 모듈이 자동으로 통합됩니다.

### 4. 라우트 설정 (`app/routes/`)

API 엔드포인트와 처리 로직을 정의합니다.

```typescript
// src/app/routes/products/route.ts
import { ExpressRouter } from '@core/lib/expressRouter';

const router = new ExpressRouter();

// 모든 상품 조회
router.GET(async (req, res, injected, repo, db) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  
  const productRepo = repo.getRepository('productProduct');
  const products = await productRepo.findAll(page, limit);
  
  res.json({
    success: true,
    data: products
  });
});

// 상품 상세 조회
router.GET(':id', async (req, res, injected, repo, db) => {
  const id = BigInt(req.params.id);
  const productRepo = repo.getRepository('productProduct');
  
  const product = await productRepo.findById(id);
  
  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }
  
  res.json({
    success: true,
    data: product
  });
});

// 상품 생성
router.POST({
  body: {
    name: { type: 'string', required: true },
    description: { type: 'string' },
    price: { type: 'number', required: true, min: 0 }
  },
  response: {
    201: {
      success: { type: 'boolean' },
      data: { type: 'object' }
    }
  }
}, async (req, res, injected, repo, db) => {
  const { name, description, price } = req.validatedBody;
  
  const productRepo = repo.getRepository('productProduct');
  const productService = injected.productProductService;
  
  const isValid = await productService.validateProduct({ name, price });
  
  if (!isValid) {
    return res.status(400).json({
      success: false,
      message: 'Invalid product data'
    });
  }
  
  const product = await productRepo.create({
    name,
    description,
    price
  });
  
  res.status(201).json({
    success: true,
    data: product
  });
});

export default router.build();
```

## 자동 문서화

개발 모드에서 `AUTO_DOCS=true` 설정 시, 다음 URL에서 자동 생성된 문서를 확인할 수 있습니다:

- API 문서: `http://localhost:3000/docs`
- 개발자 대시보드: `http://localhost:3000/docs/dev`
- OpenAPI 스펙: `http://localhost:3000/docs/openapi.json`
- 테스트 리포트: `http://localhost:3000/docs/test-report`

## 개발 명령어

```bash
# 개발 모드 (자동 타입 생성 및 서버 재시작)
npm run dev

# 빌드
npm run build

# 타입 생성 명령어들
npm run generate-db-types
npm run generate-repositories
npm run generate-injectables
npm run generate-routes-map
```

## 프로젝트 구조

```
src/
 ├── app/                # 개발자 작업 영역
 │   ├── db/             # 데이터베이스 정의
 │   ├── repos/          # 리포지토리 패턴 구현
 │   ├── injectable/     # 의존성 주입 모듈
 │   ├── routes/         # API 엔드포인트
 │   └── views/          # 템플릿 뷰
 └── core/               # 프레임워크 코어
     ├── scripts/        # 자동화 스크립트
     ├── lib/            # 핵심 라이브러리
     └── external/       # 외부 통합
```

## 라이선스

ISC
