import { CSRFTokenStorage, StorageConfig } from './storage.interface';
import { log } from '@/src/core/external/winston';

/**
 * 싱글톤 패턴으로 저장소 인스턴스 관리
 * 실제 구현체는 외부에서 주입받는 방식
 */
export class CSRFStorageManager {
    private static instance: CSRFStorageManager | null = null;
    private storage: CSRFTokenStorage | null = null;

    private constructor() {}

    static getInstance(): CSRFStorageManager {
        if (!CSRFStorageManager.instance) {
            CSRFStorageManager.instance = new CSRFStorageManager();
        }
        return CSRFStorageManager.instance;
    }

    /**
     * 저장소 구현체를 직접 주입
     * @param storage 주입할 저장소 구현체
     */
    setStorage(storage: CSRFTokenStorage): void {
        if (this.storage) {
            // log.Warn('CSRF Storage Manager: Replacing existing storage');
            return;
        }
        this.storage = storage;
        // log.Info('CSRF Storage Manager: Storage injected successfully');
    }

    /**
     * 현재 저장소 반환
     * @returns 현재 설정된 저장소
     */
    getStorage(): CSRFTokenStorage {
        if (!this.storage) {
            throw new Error('No storage implementation injected. Please call setStorage() first.');
        }
        return this.storage;
    }

    async healthCheck(): Promise<boolean> {
        if (!this.storage) {
            return false;
        }
        return await this.storage.isHealthy();
    }

    async cleanup(): Promise<void> {
        if (this.storage) {
            await this.storage.cleanup();
            this.storage = null;
        }
    }

    /**
     * 저장소가 주입되었는지 확인
     */
    hasStorage(): boolean {
        return this.storage !== null;
    }
}
