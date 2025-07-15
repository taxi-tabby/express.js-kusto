import { CSRFTokenData, StorageConfig } from './storage.interface';
import { BaseCSRFTokenStorage } from './storage.base';
import { log } from '@/src/core/external/winston';

/**
 * ORM 클라이언트를 위한 최소 인터페이스
 * 이 인터페이스를 구현하는 어떤 ORM/데이터베이스 클라이언트든 사용 가능
 */
export interface ORMClient {
    /**
     * 원시 SQL 쿼리 실행
     * @param query SQL 쿼리 문자열 (매개변수 플레이스홀더 포함)
     * @param params 쿼리 매개변수 배열
     * @returns 쿼리 실행 결과
     */
    $queryRaw<T = unknown>(query: TemplateStringsArray, ...params: unknown[]): Promise<T>;
    
    /**
     * 안전하지 않은 원시 SQL 쿼리 실행
     * @param query SQL 쿼리 문자열
     * @param params 쿼리 매개변수 배열
     * @returns 쿼리 실행 결과
     */
    $queryRawUnsafe<T = unknown>(query: string, ...params: unknown[]): Promise<T>;
    
    /**
     * DDL 또는 DML 쿼리 실행 (결과 반환 없음)
     * @param query SQL 쿼리 문자열 (매개변수 플레이스홀더 포함)
     * @param params 쿼리 매개변수 배열
     * @returns 영향받은 행의 수
     */
    $executeRaw<T = unknown>(query: TemplateStringsArray, ...params: unknown[]): Promise<number>;
    
    /**
     * 안전하지 않은 DDL 또는 DML 쿼리 실행
     * @param query SQL 쿼리 문자열
     * @param params 쿼리 매개변수 배열
     * @returns 영향받은 행의 수
     */
    $executeRawUnsafe(query: string, ...params: unknown[]): Promise<number>;
}

/**
 * ORM 기반 CSRF 토큰 저장소 설정
 */
export interface ORMStorageConfig extends Omit<StorageConfig, 'connectionString'> {
    /** ORM 클라이언트 인스턴스 */
    ormClient: ORMClient;
    /** CSRF 토큰을 저장할 테이블명 (기본값: 'csrf_tokens') */
    tableName?: string;
    /** 테이블 자동 생성 여부 (기본값: true) */
    autoCreateTable?: boolean;
    /** 지연 초기화 여부 - true면 실제 사용시에만 테이블 생성 확인 (기본값: false) */
    lazyInitialization?: boolean;
    /** 정리 작업 간격 (밀리초, 기본값: 10분) */
    cleanupInterval?: number;
    /** 테이블 생성 옵션 */
    tableOptions?: {
        /** 세션 ID 컬럼 최대 길이 (기본값: 255) */
        sessionIdLength?: number;
        /** 토큰 컬럼 최대 길이 (기본값: 255) */
        tokenLength?: number;
        /** 메타데이터 저장을 위한 JSON 컬럼 사용 여부 (기본값: true) */
        useJsonColumn?: boolean;
    };
}

/**
 * ORM 기반 CSRF 토큰 저장소
 * 
 * 기존 ORM을 활용하여 외부 라이브러리 의존성 없이 데이터베이스에 CSRF 토큰을 저장합니다.
 * 
 * 특징:
 * - 역 의존성 주입: ORM 클라이언트를 외부에서 주입
 * - 최소 인터페이스: 원시 SQL 실행 기능만 요구
 * - 자동 테이블 생성: 필요시 테이블과 인덱스 자동 생성
 * - 유연한 설정: 테이블명, 컬럼 크기 등 커스터마이징 가능
 *  * 사용 예시:
 * ```typescript
 * // 즉시 초기화 (기본)
 * const storage = new ORMCSRFTokenStorage({
 *   ormClient: prismaManager.getClient('user'),
 *   tableName: 'user_csrf_tokens',
 *   cleanupInterval: 60000, // 1분마다 만료 토큰 정리
 *   maxTokenAge: 1800000,   // 30분 토큰 유효기간
 * });
 * 
 * // 지연 초기화 (성능 최적화)
 * const storage = new ORMCSRFTokenStorage({
 *   ormClient: prismaManager.getClient('user'),
 *   tableName: 'user_csrf_tokens',
 *   lazyInitialization: true, // 실제 사용시에만 테이블 생성 확인
 *   maxTokenAge: 1800000,
 * });
 * ```
 */
export class ORMCSRFTokenStorage extends BaseCSRFTokenStorage {
    private readonly ormClient: ORMClient;
    private readonly tableName: string;
    private readonly autoCreateTable: boolean;
    private readonly lazyInitialization: boolean;
    private readonly tableOptions: Required<NonNullable<ORMStorageConfig['tableOptions']>>;
    private isTableInitialized: boolean = false;    constructor(config: ORMStorageConfig) {
        super(config);
        this.ormClient = config.ormClient;
        this.tableName = config.tableName || 'csrf_tokens';
        this.autoCreateTable = config.autoCreateTable ?? true;
        this.lazyInitialization = config.lazyInitialization ?? false;
        this.tableOptions = {
            sessionIdLength: config.tableOptions?.sessionIdLength || 255,
            tokenLength: config.tableOptions?.tokenLength || 255,
            useJsonColumn: config.tableOptions?.useJsonColumn ?? true,
        };
    }    protected async doInitialize(): Promise<void> {
        if (this.autoCreateTable && !this.lazyInitialization && !this.isTableInitialized) {
            await this.ensureTableAndIndexesExist();
            this.isTableInitialized = true;
        }
    }    protected async doSaveToken(sessionId: string, tokenData: CSRFTokenData): Promise<boolean> {
        await this.ensureLazyInitialization();
        
        try {
            let query: string;
            let params: any[];
            
            if (this.tableOptions.useJsonColumn) {
                // JSONB 컬럼 사용 시, PostgreSQL에서 올바른 캐스팅 적용
                query = `
                    INSERT INTO ${this.tableName} (session_id, token, generated_at, expires_at, metadata)
                    VALUES ($1, $2, $3, $4, $5::jsonb)
                    ON CONFLICT (session_id) 
                    DO UPDATE SET 
                        token = EXCLUDED.token,
                        generated_at = EXCLUDED.generated_at,
                        expires_at = EXCLUDED.expires_at,
                        metadata = EXCLUDED.metadata
                `;
                const metadataValue = JSON.stringify(tokenData.metadata || {});
                params = [sessionId, tokenData.token, tokenData.generatedAt, tokenData.expiresAt, metadataValue];
            } else {
                // JSON 컬럼 미사용 시, metadata 필드 제외
                query = `
                    INSERT INTO ${this.tableName} (session_id, token, generated_at, expires_at)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (session_id) 
                    DO UPDATE SET 
                        token = EXCLUDED.token,
                        generated_at = EXCLUDED.generated_at,
                        expires_at = EXCLUDED.expires_at
                `;
                params = [sessionId, tokenData.token, tokenData.generatedAt, tokenData.expiresAt];
            }

            const affectedRows = await this.ormClient.$executeRawUnsafe(query, ...params);

            return affectedRows > 0;
        } catch (error) {
            log.Error('ORM Storage: Failed to save CSRF token', { sessionId, error });
            throw error;
        }
    }    protected async doGetToken(sessionId: string): Promise<CSRFTokenData | null> {
        await this.ensureLazyInitialization();
        
        try {
            const results = await this.ormClient.$queryRawUnsafe(`
                SELECT session_id, token, generated_at, expires_at, metadata
                FROM ${this.tableName}
                WHERE session_id = $1
            `, sessionId) as any[];

            if (results.length === 0) {
                return null;
            }

            const row = results[0];
            let metadata = undefined;
            
            if (this.tableOptions.useJsonColumn && row.metadata) {
                try {
                    // PostgreSQL JSONB는 이미 객체로 반환되거나 문자열로 반환될 수 있음
                    if (typeof row.metadata === 'string') {
                        metadata = JSON.parse(row.metadata);
                    } else {
                        metadata = row.metadata;
                    }
                } catch {
                    // JSON 파싱 실패시 무시
                    metadata = undefined;
                }
            }

            return {
                sessionId: row.session_id,
                token: row.token,
                generatedAt: Number(row.generated_at),
                expiresAt: Number(row.expires_at),
                metadata
            };
        } catch (error) {
            log.Error('ORM Storage: Failed to get CSRF token', { sessionId, error });
            throw error;
        }
    }

    protected async doDeleteToken(sessionId: string): Promise<boolean> {
        try {
            const affectedRows = await this.ormClient.$executeRawUnsafe(`
                DELETE FROM ${this.tableName}
                WHERE session_id = $1
            `, sessionId);

            return affectedRows > 0;
        } catch (error) {
            log.Error('ORM Storage: Failed to delete CSRF token', { sessionId, error });
            throw error;
        }
    }

    protected async doCleanupExpiredTokens(): Promise<number> {
        try {
            const affectedRows = await this.ormClient.$executeRawUnsafe(`
                DELETE FROM ${this.tableName}
                WHERE expires_at < $1
            `, Date.now());

            return affectedRows;
        } catch (error) {
            log.Error('ORM Storage: Failed to cleanup expired CSRF tokens', { error });
            throw error;
        }
    }

    async isHealthy(): Promise<boolean> {
        try {
            // 간단한 쿼리로 연결 상태 확인
            await this.ormClient.$queryRawUnsafe('SELECT 1 as health_check');
            return true;
        } catch (error) {
            log.Error('ORM Storage: Health check failed', { error });
            return false;
        }
    }

    /**
     * 테이블이 존재하지 않으면 생성
     */
    private async createTableIfNotExists(): Promise<void> {
        const metadataColumn = this.tableOptions.useJsonColumn 
            ? 'metadata JSONB' 
            : 'metadata TEXT';

        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
                session_id VARCHAR(${this.tableOptions.sessionIdLength}) PRIMARY KEY,
                token VARCHAR(${this.tableOptions.tokenLength}) NOT NULL,
                generated_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL,
                ${metadataColumn}
            )
        `;

        try {
            await this.ormClient.$executeRawUnsafe(createTableSQL);
            // log.Info(`ORM Storage: Table ${this.tableName} created or already exists`);
        } catch (error) {
            log.Error('ORM Storage: Failed to create table', { tableName: this.tableName, error });
            throw error;
        }
    }

    /**
     * 필요한 인덱스가 존재하지 않으면 생성
     */
    private async createIndexesIfNotExists(): Promise<void> {
        const indexes = [
            {
                name: `idx_${this.tableName}_expires_at`,
                sql: `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires_at ON ${this.tableName} (expires_at)`
            },
            {
                name: `idx_${this.tableName}_generated_at`,
                sql: `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_generated_at ON ${this.tableName} (generated_at)`
            }
        ];

        for (const index of indexes) {
            try {
                await this.ormClient.$executeRawUnsafe(index.sql);
                // log.Debug(`ORM Storage: Index ${index.name} created or already exists`);
            } catch (error) {
                log.Warn('ORM Storage: Failed to create index', { indexName: index.name, error });
                // 인덱스 생성 실패는 치명적이지 않으므로 계속 진행
            }
        }
    }

    /**
     * 테이블과 인덱스가 존재하는지 확인하고 없으면 생성 (한 번만 실행)
     */
    private async ensureTableAndIndexesExist(): Promise<void> {
        const tableExists = await this.checkTableExists();
        
        if (!tableExists) {
            await this.createTableIfNotExists();
            await this.createIndexesIfNotExists();
        } else {
            // 테이블은 존재하지만 인덱스는 누락될 수 있으므로 확인
            await this.createIndexesIfNotExists();
        }
    }

    /**
     * 테이블 존재 여부 확인
     */
    private async checkTableExists(): Promise<boolean> {
        try {
            // PostgreSQL/MySQL 공통으로 사용 가능한 쿼리
            const result = await this.ormClient.$queryRawUnsafe(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_name = $1
            `, this.tableName) as any[];
            
            return result.length > 0;
        } catch (error) {
            // information_schema가 지원되지 않는 DB의 경우 기존 방식 사용
            log.Warn('ORM Storage: Could not check table existence via information_schema, falling back to CREATE IF NOT EXISTS', { error });
            return false;
        }
    }

    /**
     * 저장소 통계 정보 조회
     */
    async getStats(): Promise<{
        totalTokens: number;
        expiredTokens: number;
        validTokens: number;
    }> {
        try {
            const now = Date.now();
            
            const [totalResult, expiredResult] = await Promise.all([
                this.ormClient.$queryRawUnsafe(`SELECT COUNT(*) as count FROM ${this.tableName}`) as Promise<[{count: string}]>,
                this.ormClient.$queryRawUnsafe(`SELECT COUNT(*) as count FROM ${this.tableName} WHERE expires_at < $1`, now) as Promise<[{count: string}]>
            ]);

            const totalTokens = parseInt(totalResult[0].count);
            const expiredTokens = parseInt(expiredResult[0].count);
            const validTokens = totalTokens - expiredTokens;

            return {
                totalTokens,
                expiredTokens,
                validTokens
            };
        } catch (error) {
            log.Error('ORM Storage: Failed to get storage stats', { error });
            throw error;
        }
    }

    /**
     * 지연 초기화: 실제 테이블 작업 전에 호출되어 필요시에만 테이블 생성
     */
    private async ensureLazyInitialization(): Promise<void> {
        if (this.autoCreateTable && this.lazyInitialization && !this.isTableInitialized) {
            await this.ensureTableAndIndexesExist();
            this.isTableInitialized = true;
        }
    }
}
