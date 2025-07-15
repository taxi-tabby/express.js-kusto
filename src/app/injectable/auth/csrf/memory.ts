import { CSRFTokenData, StorageConfig } from './storage.interface';
import { BaseCSRFTokenStorage } from './storage.base';

/**
 * 메모리 기반 CSRF 토큰 저장소
 * 개발 환경이나 단일 서버 환경에서 사용
 */
export class MemoryCSRFTokenStorage extends BaseCSRFTokenStorage {
    private tokens: Map<string, CSRFTokenData> = new Map();

    constructor(config: StorageConfig) {
        super(config);
    }

    protected async doSaveToken(sessionId: string, tokenData: CSRFTokenData): Promise<boolean> {
        // console.log('-================================');
        // console.log(tokenData);
        this.tokens.set(sessionId, tokenData);
        return true;
    }

    protected async doGetToken(sessionId: string): Promise<CSRFTokenData | null> {

        return this.tokens.get(sessionId) || null;
    }

    protected async doDeleteToken(sessionId: string): Promise<boolean> {
        return this.tokens.delete(sessionId);
    }

    protected async doCleanupExpiredTokens(): Promise<number> {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [sessionId, tokenData] of this.tokens.entries()) {
            if (now > tokenData.expiresAt) {
                this.tokens.delete(sessionId);
                cleanedCount++;
            }
        }
        
        return cleanedCount;
    }

    async isHealthy(): Promise<boolean> {
        return true; // 메모리 저장소는 항상 건강함
    }

    /**
     * 메모리 사용량 통계
     */
    getStats() {
        const now = Date.now();
        let validTokens = 0;
        let expiredTokens = 0;
        
        for (const tokenData of this.tokens.values()) {
            if (now > tokenData.expiresAt) {
                expiredTokens++;
            } else {
                validTokens++;
            }
        }
        
        return {
            totalTokens: this.tokens.size,
            validTokens,
            expiredTokens
        };
    }
}