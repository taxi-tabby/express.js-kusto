# CSRF 토큰 시스템 사용 가이드

## 📋 개요

이 CSRF 토큰 시스템은 **역 의존성 주입**을 통해 다양한 저장소(Memory, Redis, MongoDB, PostgreSQL 등)를 지원하는 확장 가능한 구조입니다.

### 🎯 주요 특징

- ✅ **세션별 독립 토큰** - 전역 토큰 문제 해결
- ✅ **역 의존성 주입** - 저장소 구현체를 외부에서 주입
- ✅ **Abstract Base Class** - 커스텀 저장소 구현이 매우 간단
- ✅ **자동 정리 기능** - 만료된 토큰 자동 삭제
- ✅ **완벽한 로깅** - 모든 작업에 대한 상세 로그
- ✅ **간편 헬퍼** - 빠른 설정을 위한 유틸리티

## 🚀 빠른 시작

### 1. 기본 사용법 (메모리 저장소)

```typescript
import CSRFHelper from './helper';

// 가장 간단한 설정 (이제 동기적!)
const { tokenMiddleware, referrerMiddleware } = CSRFHelper.setup({
    ttl: 30 * 60 * 1000, // 30분
});

app.use(tokenMiddleware);
app.use(referrerMiddleware);
```

### 2. ORM 기반 저장소 사용 (추천)

```typescript
import CSRFHelper from './helper';
import { prismaManager } from '@/src/core/lib/prismaManager';

// 기존 Prisma 클라이언트를 활용한 데이터베이스 저장소 (이제 동기적!)
const { tokenMiddleware, referrerMiddleware, storage } = CSRFHelper.setupWithORM(
    prismaManager.getClient('user'), // 또는 'admin'
    {
        tableName: 'csrf_tokens',
        ttl: 30 * 60 * 1000, // 30분
        cleanupInterval: 5 * 60 * 1000, // 5분마다 정리
    }
);

app.use(tokenMiddleware);
app.use(referrerMiddleware);

// 선택적: 저장소 상태 확인
console.log('CSRF Storage Stats:', await storage.getStats());
```

### 3. 커스텀 저장소 사용

```typescript
import CSRFHelper from './helper';
import { MemoryCSRFTokenStorage } from './memory';

const storage = new MemoryCSRFTokenStorage({
    ttl: 24 * 60 * 60 * 1000 // 24시간
});

const { tokenMiddleware, referrerMiddleware } = CSRFHelper.setupWithCustomStorage(storage);

app.use(tokenMiddleware);
app.use(referrerMiddleware);
```

**참고**: 메모리 저장소를 직접 사용하는 경우, `CSRFHelper.setup()`이 더 간단합니다!

## 🏗️ 저장소 구현 옵션

### Option 1: ORM 기반 저장소 (추천)

기존 ORM을 활용하여 외부 라이브러리 의존성 없이 데이터베이스를 사용할 수 있습니다.

```typescript
import { ORMCSRFTokenStorage } from './orm';
import { prismaManager } from '@/src/core/lib/prismaManager';

const storage = new ORMCSRFTokenStorage({
    ormClient: prismaManager.getClient('user'), // 또는 'admin'
    tableName: 'user_csrf_tokens', // 커스텀 테이블명
    ttl: 30 * 60 * 1000, // 30분
    autoCreateTable: true, // 자동 테이블 생성
    tableOptions: {
        sessionIdLength: 255,
        tokenLength: 255,
        useJsonColumn: true // 메타데이터용 JSONB 컬럼 사용
    }
});

await storage.initialize();
```

**특징:**
- ✅ 기존 Prisma 클라이언트 재사용
- ✅ 외부 라이브러리 의존성 없음  
- ✅ 자동 테이블/인덱스 생성
- ✅ 통계 정보 조회 지원
- ✅ 완벽한 로깅 및 에러 처리

### Option 2: 커스텀 저장소 구현

BaseCSRFTokenStorage를 상속받으면 **단 5개의 메서드만 구현**하면 됩니다!

```typescript
import { BaseCSRFTokenStorage } from './storage.base';
import { CSRFTokenData, StorageConfig } from './storage.interface';

export class MyCustomStorage extends BaseCSRFTokenStorage {
    constructor(config: StorageConfig) {
        super(config);
        // 커스텀 설정...
    }

    // 필수 구현 메서드 (5개)
    protected async doSaveToken(sessionId: string, tokenData: CSRFTokenData): Promise<boolean> {
        // 토큰 저장 로직
        return true;
    }

    protected async doGetToken(sessionId: string): Promise<CSRFTokenData | null> {
        // 토큰 조회 로직
        return null;
    }

    protected async doDeleteToken(sessionId: string): Promise<boolean> {
        // 토큰 삭제 로직
        return true;
    }

    protected async doCleanupExpiredTokens(): Promise<number> {
        // 만료 토큰 정리 로직
        return 0;
    }

    async isHealthy(): Promise<boolean> {
        // 저장소 상태 확인
        return true;
    }

    // 선택적 구현 메서드들
    protected async doInitialize(): Promise<void> {
        // 초기화 로직 (DB 연결, 테이블 생성 등)
    }

    protected async doCleanup(): Promise<void> {
        // 정리 로직 (연결 해제 등)
    }
}
```

### 🎁 BaseCSRFTokenStorage가 자동으로 제공하는 기능

- **로깅**: 모든 작업에 대한 상세 로그 (성공/실패/에러)
- **에러 처리**: try-catch 및 에러 로깅 자동 처리
- **토큰 만료 검사**: getToken 시 자동 만료 확인 및 삭제
- **자동 정리**: 설정 가능한 간격으로 만료 토큰 자동 정리
- **초기화/종료 관리**: 리소스 관리 생명주기
- **유틸리티 메서드**: 만료 시간 계산, 세션 ID 마스킹 등

## 📚 실제 구현 예시

### ORM 저장소 (추천)

```typescript
import { ORMCSRFTokenStorage } from './orm';
import { prismaManager } from '@/src/core/lib/prismaManager';

// 실제 사용 예시
const ormStorage = new ORMCSRFTokenStorage({
    ormClient: prismaManager.getClient('user'),
    tableName: 'csrf_tokens',
    ttl: 30 * 60 * 1000, // 30분
    autoCreateTable: true,
    tableOptions: {
        sessionIdLength: 255,
        tokenLength: 255,
        useJsonColumn: true
    }
});

await ormStorage.initialize();

// 통계 정보 확인
const stats = await ormStorage.getStats();
console.log('CSRF Storage Stats:', stats);
// 출력: { totalTokens: 150, expiredTokens: 20, validTokens: 130 }
```

### 메모리 저장소

```typescript
import { MemoryCSRFTokenStorage } from './memory';

const memoryStorage = new MemoryCSRFTokenStorage({
    ttl: 30 * 60 * 1000 // 30분
});

// 메모리 저장소는 지연 초기화되므로 별도 initialize() 호출 불필요
// 메모리 사용량 확인
const stats = memoryStorage.getStats();
console.log('Memory Stats:', stats);

// 또는 더 간단하게 CSRFHelper 사용
const { tokenMiddleware, referrerMiddleware } = CSRFHelper.setup({
    ttl: 30 * 60 * 1000 // 30분
});
```

### 외부 저장소 예시 (PostgreSQL)

\`\`\`typescript
export class PostgreSQLCSRFTokenStorage extends BaseCSRFTokenStorage {
    private pool: Pool;

    constructor(config: StorageConfig) {
        super(config);
        this.pool = new Pool({ connectionString: config.connectionString });
    }

    protected async doInitialize(): Promise<void> {
        await this.pool.query(\`
            CREATE TABLE IF NOT EXISTS csrf_tokens (
                session_id VARCHAR(255) PRIMARY KEY,
                token VARCHAR(255) NOT NULL,
                expires_at BIGINT NOT NULL,
                metadata JSONB
            )
        \`);
    }

    protected async doSaveToken(sessionId: string, tokenData: CSRFTokenData): Promise<boolean> {
        const result = await this.pool.query(
            'INSERT INTO csrf_tokens (session_id, token, expires_at, metadata) VALUES ($1, $2, $3, $4) ON CONFLICT (session_id) DO UPDATE SET token = $2, expires_at = $3',
            [sessionId, tokenData.token, tokenData.expiresAt, JSON.stringify(tokenData.metadata)]
        );
        return result.rowCount > 0;
    }

    // ... 나머지 3개 메서드 구현
}
\`\`\`

### Redis 저장소

\`\`\`typescript
export class RedisCSRFTokenStorage extends BaseCSRFTokenStorage {
    private client: RedisClientType;

    protected async doSaveToken(sessionId: string, tokenData: CSRFTokenData): Promise<boolean> {
        const ttlSeconds = Math.ceil((tokenData.expiresAt - Date.now()) / 1000);
        await this.client.setEx(\`csrf:\${sessionId}\`, ttlSeconds, JSON.stringify(tokenData));
        return true;
    }

    protected async doGetToken(sessionId: string): Promise<CSRFTokenData | null> {
        const data = await this.client.get(\`csrf:\${sessionId}\`);
        return data ? JSON.parse(data) : null;
    }

    // Redis는 TTL로 자동 만료되므로 수동 정리 불필요
    protected shouldAutoCleanup(): boolean {
        return false;
    }
}
\`\`\`

## ⚙️ 설정 옵션

### ORMStorageConfig

```typescript
interface ORMStorageConfig {
    ormClient: ORMClient;              // ORM 클라이언트 (예: Prisma)
    tableName?: string;                // 테이블명 (기본: 'csrf_tokens')
    ttl?: number;                      // 토큰 수명 (밀리초)
    autoCreateTable?: boolean;         // 자동 테이블 생성 (기본: true)
    cleanupInterval?: number;          // 정리 간격 (밀리초)
    tableOptions?: {
        sessionIdLength?: number;      // 세션 ID 컬럼 길이 (기본: 255)
        tokenLength?: number;          // 토큰 컬럼 길이 (기본: 255)
        useJsonColumn?: boolean;       // JSON 메타데이터 컬럼 사용 (기본: true)
    };
}
```

### StorageConfig (일반)

```typescript
interface StorageConfig {
    connectionString?: string;         // DB 연결 문자열
    options?: Record<string, any>;     // 저장소별 옵션
    ttl?: number;                      // 토큰 수명 (밀리초)
    cleanupInterval?: number;          // 정리 간격 (밀리초)
}
```

## 🔧 고급 사용법

### 환경별 저장소 선택

```typescript
import CSRFHelper from './helper';
import { prismaManager } from '@/src/core/lib/prismaManager';

function createCSRFStorageForEnvironment() {
    switch (process.env.NODE_ENV) {
        case 'development':
            // 개발환경: 메모리 저장소 (동기적!)
            return CSRFHelper.setup({ ttl: 60 * 60 * 1000 }); // 1시간
        
        case 'production':
            // 프로덕션: 데이터베이스 저장소 (이제 동기적!)
            return CSRFHelper.setupWithORM(
                prismaManager.getClient('user'),
                {
                    tableName: 'csrf_tokens',
                    ttl: 30 * 60 * 1000, // 30분
                    cleanupInterval: 5 * 60 * 1000 // 5분마다 정리
                }
            );
        
        default:
            // 기본값: 메모리 저장소 (동기적!)
            return CSRFHelper.setup({ ttl: 12 * 60 * 60 * 1000 }); // 12시간
    }
}

// 사용 (모든 환경에서 동기적!)
const { tokenMiddleware, referrerMiddleware } = createCSRFStorageForEnvironment();
```

### 헬스체크 엔드포인트

```typescript
import { CSRFStorageManager } from './factory';

app.get('/health/csrf', async (req, res) => {
    const manager = CSRFStorageManager.getInstance();
    
    if (!manager.hasStorage()) {
        return res.status(503).json({
            service: 'csrf-storage',
            status: 'not-configured'
        });
    }
    
    const isHealthy = await manager.healthCheck();
    const storage = manager.getStorage();
    
    // ORM 저장소인 경우 통계 정보도 포함
    let stats = undefined;
    if ('getStats' in storage) {
        try {
            stats = await (storage as any).getStats();
        } catch (error) {
            // 통계 조회 실패는 무시
        }
    }
    
    res.status(isHealthy ? 200 : 503).json({
        service: 'csrf-storage',
        status: isHealthy ? 'healthy' : 'unhealthy',
        stats
    });
});
```

### 커스텀 토큰 제공자

```typescript
const customTokenProvider: CSRFTokenProvider = {
    getCurrentToken: async (req) => {
        // 커스텀 토큰 조회 로직
        return req.session?.csrfToken || null;
    },
    generateNewToken: async (req) => {
        // 커스텀 토큰 생성 로직
        return `custom-${crypto.randomUUID()}`;
    },
    validateToken: async (token, req) => {
        // 커스텀 검증 로직
        const currentToken = await req.session?.csrfToken;
        return currentToken === token;
    }
};
        return req.headers['x-csrf-token'] || 
               req.cookies.csrfToken || 
               req.body._token;
    }
};
\`\`\`

### 다중 저장소 설정

\`\`\`typescript
// 주 저장소: Redis (빠른 액세스)
// 백업 저장소: PostgreSQL (영속성)
class HybridCSRFTokenStorage extends BaseCSRFTokenStorage {
    constructor(
        private redis: RedisCSRFTokenStorage,
        private postgres: PostgreSQLCSRFTokenStorage
    ) {
        super({});
    }

    protected async doSaveToken(sessionId: string, tokenData: CSRFTokenData): Promise<boolean> {
        // 두 저장소에 모두 저장
        const redisResult = await this.redis.doSaveToken(sessionId, tokenData);
        const pgResult = await this.postgres.doSaveToken(sessionId, tokenData);
        return redisResult && pgResult;
    }

    protected async doGetToken(sessionId: string): Promise<CSRFTokenData | null> {
        // Redis에서 먼저 조회, 없으면 PostgreSQL에서 조회
        let token = await this.redis.doGetToken(sessionId);
        if (!token) {
            token = await this.postgres.doGetToken(sessionId);
            if (token) {
                // Redis에 캐시
                await this.redis.doSaveToken(sessionId, token);
            }
        }
        return token;
    }
}
\`\`\`

## 🎯 모범 사례

### 1. ORM 기반 저장소 사용 (추천)

```typescript
import CSRFHelper from './helper';
import { prismaManager } from '@/src/core/lib/prismaManager';

// 프로덕션 환경에 최적화된 설정
const { tokenMiddleware, referrerMiddleware, storage } = await CSRFHelper.setupWithORM(
    prismaManager.getClient('user'),
    {
        tableName: 'csrf_tokens',
        ttl: 30 * 60 * 1000,        // 30분 토큰 수명
        cleanupInterval: 5 * 60 * 1000,  // 5분마다 만료 토큰 정리
        autoCreateTable: true,      // 자동 테이블 생성
        tableOptions: {
            sessionIdLength: 255,   // 충분한 세션 ID 길이
            tokenLength: 255,       // 충분한 토큰 길이
            useJsonColumn: true     // 메타데이터용 JSONB 컬럼
        }
    }
);

// 미들웨어 적용
app.use(tokenMiddleware);
app.use(referrerMiddleware);

// 주기적 상태 확인
setInterval(async () => {
    const stats = await storage.getStats();
    if (stats.expiredTokens > 100) {
        console.warn('많은 만료 토큰이 감지됨:', stats);
    }
}, 10 * 60 * 1000); // 10분마다
```

### 2. 환경별 저장소 선택

```typescript
async function createCSRFForEnvironment() {
    const env = process.env.NODE_ENV;
    
    switch (env) {
        case 'development':
            // 개발: 빠른 메모리 저장소
            return await CSRFHelper.setup({ 
                ttl: 60 * 60 * 1000 // 1시간
            });
        
        case 'test':
            // 테스트: 격리된 메모리 저장소
            return await CSRFHelper.setup({ 
                ttl: 5 * 60 * 1000 // 5분 (빠른 테스트)
            });
        
        case 'production':
            // 프로덕션: 안정적인 데이터베이스 저장소
            return await CSRFHelper.setupWithORM(
                prismaManager.getClient('user'),
                {
                    tableName: 'csrf_tokens',
                    ttl: 30 * 60 * 1000,
                    cleanupInterval: 10 * 60 * 1000
                }
            );
        
        default:
            throw new Error(`Unknown environment: ${env}`);
    }
}
```

### 2. 헬스체크 엔드포인트

\`\`\`typescript
app.get('/health/csrf', async (req, res) => {
    const isHealthy = await storage.isHealthy();
    res.status(isHealthy ? 200 : 503).json({
        service: 'csrf-storage',
        status: isHealthy ? 'healthy' : 'unhealthy'
    });
});
\`\`\`

}
```

### 3. 모니터링 및 통계

```typescript
import { CSRFStorageManager } from './factory';

// 주기적 모니터링
async function monitorCSRFStorage() {
    const manager = CSRFStorageManager.getInstance();
    
    if (!manager.hasStorage()) {
        console.warn('CSRF storage not configured');
        return;
    }
    
    const storage = manager.getStorage();
    const isHealthy = await storage.isHealthy();
    
    if (!isHealthy) {
        console.error('CSRF storage is unhealthy!');
        // 알림 전송 로직 등...
        return;
    }
    
    // ORM 저장소인 경우 상세 통계 확인
    if ('getStats' in storage) {
        const stats = await (storage as any).getStats();
        console.log('CSRF Storage Stats:', {
            total: stats.totalTokens,
            valid: stats.validTokens,
            expired: stats.expiredTokens,
            expiredRatio: (stats.expiredTokens / stats.totalTokens * 100).toFixed(2) + '%'
        });
        
        // 만료된 토큰이 많으면 경고
        if (stats.expiredTokens > stats.totalTokens * 0.3) {
            console.warn('Too many expired tokens detected. Consider reducing cleanup interval.');
        }
    }
}

// 5분마다 모니터링
setInterval(monitorCSRFStorage, 5 * 60 * 1000);
```

## 🚨 주의사항

1. **프로덕션 환경**: 
   - 메모리 저장소는 단일 서버 환경에서만 사용
   - 다중 서버 환경에서는 반드시 데이터베이스 저장소 사용

2. **ORM 클라이언트 요구사항**:
   - `$queryRawUnsafe()` 및 `$executeRawUnsafe()` 메서드 지원 필요
   - Prisma, TypeORM 등 대부분의 ORM과 호환

3. **테이블 관리**:
   - `autoCreateTable: true`로 설정하면 자동으로 테이블/인덱스 생성
   - 수동 관리 시 적절한 인덱스 설정 필요 (expires_at 컬럼)

4. **TTL 설정**: 
   - 너무 긴 TTL: 메모리/저장소 사용량 증가
   - 너무 짧은 TTL: 사용자 경험 저하 (토큰 만료 빈발)

5. **정리 주기**: 
   - 저장소 성능에 맞게 `cleanupInterval` 조정
   - 트래픽이 많은 환경에서는 더 자주 정리

6. **보안**: 
   - 데이터베이스 연결 정보는 환경 변수로 관리
   - 토큰은 XSS 공격을 고려하여 HttpOnly 쿠키 권장

7. **에러 처리**: 
   - `isHealthy()` 메서드로 정기적인 상태 확인
   - 저장소 오류 시 적절한 fallback 로직 구현

## 🎉 결론

이제 여러분은 다음과 같은 강력한 CSRF 토큰 시스템을 갖게 되었습니다:

✅ **세션별 독립 토큰** - 브라우저 간 토큰 공유 문제 해결  
✅ **ORM 기반 저장소** - 기존 인프라 재사용, 외부 의존성 최소화  
✅ **역 의존성 주입** - 확장 가능한 아키텍처  
✅ **자동 관리** - 테이블 생성, 만료 토큰 정리 자동화  
✅ **완벽한 모니터링** - 상태 확인, 통계, 로깅 기능  

안전하고 확장 가능한 웹 애플리케이션을 구축하세요! 🚀
