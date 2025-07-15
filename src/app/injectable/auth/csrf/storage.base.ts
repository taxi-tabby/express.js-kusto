import { CSRFTokenStorage, CSRFTokenData, StorageConfig } from './storage.interface';
import { log } from '@/src/core/external/winston';

/**
 * CSRF 저장소 추상 베이스 클래스
 * 공통 기능을 제공하여 커스텀 저장소 구현을 간단하게 만듦
 */
export abstract class BaseCSRFTokenStorage implements CSRFTokenStorage {
    protected readonly ttl: number;
    protected cleanupInterval: NodeJS.Timeout | null = null;
    protected readonly config: StorageConfig;
    private isInitialized: boolean = false;

    constructor(config: StorageConfig) {
        this.config = config;
        this.ttl = config.ttl || 24 * 60 * 60 * 1000; // 기본 24시간
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return; // 이미 초기화됨
        }

        // log.Info(`${this.getStorageName()}: Initializing...`);

        // 자식 클래스의 초기화 로직 실행
        await this.doInitialize();

        // 자동 정리 작업 설정 (선택적)
        if (this.shouldAutoCleanup()) {
            this.setupAutoCleanup();
        }

        this.isInitialized = true;
        // log.Info(`${this.getStorageName()}: Initialized successfully`);
    }

    /**
     * 지연 초기화 - 필요할 때만 초기화 수행
     */
    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async cleanup(): Promise<void> {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        await this.doCleanup();
        log.Info(`${this.getStorageName()}: Cleanup completed`);
    }


    // === 공통 구현 메서드들 (로깅과 에러 처리 포함) ===
    async saveToken(sessionId: string, tokenData: CSRFTokenData): Promise<boolean> {
        await this.ensureInitialized(); // 지연 초기화

        try {
            const dataWithExpiry = {
                ...tokenData,
                expiresAt: tokenData.expiresAt || this.calculateExpiresAt()
            };

            const result = await this.doSaveToken(sessionId, dataWithExpiry);

            if (!result) {
                log.Warn(`${this.getStorageName()}: Failed to save token`, {
                    sessionId: this.maskSessionId(sessionId)
                });
            }

            return result;
        } catch (error) {
            this.logError('Token save', sessionId, error);
            return false;
        }
    }

    async getToken(sessionId: string): Promise<CSRFTokenData | null> {
        await this.ensureInitialized(); // 지연 초기화

        try {
            const token = await this.doGetToken(sessionId);

            if (token) {
                // 만료 확인
                if (this.isTokenExpired(token)) {
                    this.logDebug('Token expired, deleting', sessionId, {
                        expiresAt: new Date(token.expiresAt).toISOString()
                    });

                    // 만료된 토큰 삭제
                    await this.deleteToken(sessionId);
                    return null;
                }

                // this.logDebug('Token retrieved', sessionId);
            }

            return token;
        } catch (error) {
            this.logError('Token retrieval', sessionId, error);
            return null;
        }
    }


    async deleteToken(sessionId: string): Promise<boolean> {
        await this.ensureInitialized(); // 지연 초기화

        try {
            const result = await this.doDeleteToken(sessionId);

            if (result) {
                this.logDebug('Token deleted', sessionId);
            }

            return result;
        } catch (error) {
            this.logError('Token deletion', sessionId, error);
            return false;
        }
    }


    async cleanupExpiredTokens(): Promise<number> {
        await this.ensureInitialized(); // 지연 초기화

        try {
            const cleanedCount = await this.doCleanupExpiredTokens();

            if (cleanedCount > 0) {
                log.Info(`${this.getStorageName()}: Cleaned up ${cleanedCount} expired tokens`);
            }

            return cleanedCount;
        } catch (error) {
            log.Error(`${this.getStorageName()}: Cleanup failed`, {
                error: error instanceof Error ? error.message : String(error)
            });
            return 0;
        }
    }

    // === 자식 클래스에서 구현해야 하는 핵심 메서드들 ===
    protected abstract doSaveToken(sessionId: string, tokenData: CSRFTokenData): Promise<boolean>;
    protected abstract doGetToken(sessionId: string): Promise<CSRFTokenData | null>;
    protected abstract doDeleteToken(sessionId: string): Promise<boolean>;
    protected abstract doCleanupExpiredTokens(): Promise<number>;
    public abstract isHealthy(): Promise<boolean>;

    // === 자식 클래스에서 선택적으로 오버라이드할 수 있는 메서드들 ===

    /**
     * 저장소 이름 반환 (로깅용)
     */
    protected getStorageName(): string {
        return this.constructor.name;
    }

    /**
     * 실제 초기화 로직 (자식 클래스에서 구현)
     */
    protected async doInitialize(): Promise<void> {
        // 기본적으로는 아무것도 하지 않음
    }

    /**
     * 실제 정리 로직 (자식 클래스에서 구현)
     */
    protected async doCleanup(): Promise<void> {
        // 기본적으로는 아무것도 하지 않음
    }

    /**
     * 자동 정리 작업 사용 여부
     */
    protected shouldAutoCleanup(): boolean {
        return true; // 기본값은 true
    }

    /**
     * 자동 정리 간격 (밀리초)
     */
    protected getCleanupInterval(): number {
        return 10 * 60 * 1000; // 기본 10분
    }    /**
     * 토큰 만료 여부 확인
     */
    protected isTokenExpired(tokenData: CSRFTokenData): boolean {
        return Date.now() > tokenData.expiresAt;
    }

    /**
     * 만료 시간 계산
     */
    protected calculateExpiresAt(customTtl?: number): number {
        return Date.now() + (customTtl || this.ttl);
    }

    /**
     * 세션 ID 마스킹 (로깅용)
     */
    protected maskSessionId(sessionId: string): string {
        return sessionId || '';
    }

    /**
     * 에러 로깅 헬퍼
     */
    protected logError(operation: string, sessionId: string, error: unknown): void {
        log.Error(`${this.getStorageName()}: ${operation} failed`, {
            sessionId: this.maskSessionId(sessionId),
            error: error instanceof Error ? error.message : String(error)
        });
    }

    /**
     * 디버그 로깅 헬퍼
     */
    protected logDebug(operation: string, sessionId: string, extra?: Record<string, any>): void {
        log.Debug(`${this.getStorageName()}: ${operation}`, {
            sessionId: this.maskSessionId(sessionId),
            ...extra
        });
    }

    /**
     * 자동 정리 작업 설정
     */
    private setupAutoCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredTokens().catch(error => {
                log.Error(`${this.getStorageName()}: Auto cleanup failed`, {
                    error: error instanceof Error ? error.message : String(error)
                });
            });
        }, this.getCleanupInterval());
    }
}
