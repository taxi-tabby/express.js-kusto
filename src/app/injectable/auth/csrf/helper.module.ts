import { MemoryCSRFTokenStorage } from './memory';
import { ORMCSRFTokenStorage, ORMClient, ORMStorageConfig } from './orm';
import CSRFTokenModule from './make';
import middlewareFactory from './middleware.module';
import { CSRFStorageManager } from './factory';
import { StorageConfig } from './storage.interface';

/**
 * CSRF 시스템 간편 설정 헬퍼
 * 빠른 설정을 위한 유틸리티 함수들
 */
export default class CSRFHelper {
    /**
     * 기본 메모리 기반 CSRF 시스템 설정
     * @param config 선택적 설정
     * @returns 설정된 CSRF 모듈과 미들웨어
     */
    setup(config?: StorageConfig) {
        // 메모리 저장소 생성 (지연 초기화)
        const storage = new MemoryCSRFTokenStorage(config || { ttl: 24 * 60 * 60 * 1000 });

        // 전역 관리자에 저장소 주입
        const manager = CSRFStorageManager.getInstance();
        manager.setStorage(storage);        // CSRF 모듈 생성
        const csrfModule = new CSRFTokenModule(storage, config);

        // 미들웨어들 생성
        const tokenMiddleware = csrfModule.middleware();
        const referrerMiddleware = middlewareFactory.createReferrerMiddleware(csrfModule, config);

        return {
            csrfModule,
            tokenMiddleware,
            referrerMiddleware,
            storage
        };
    }    /**
     * ORM 클라이언트 기반 CSRF 시스템 설정 (추천)
     * 기존 ORM을 활용하여 외부 라이브러리 의존성 없이 데이터베이스 저장소 사용
     * 
     * @param ormClient ORM 클라이언트 (예: Prisma 클라이언트)
     * @param config ORM 저장소 설정
     * @returns 설정된 CSRF 모듈과 미들웨어
     * 
     * @example
     * ```typescript
     * // Prisma 클라이언트를 사용한 예시
     * const { csrfModule, tokenMiddleware, referrerMiddleware } = CSRFHelper.setupWithORM(
     *   prismaManager.getClient('user'),
     *   {
     *     tableName: 'csrf_tokens',
     *     ttl: 30 * 60 * 1000, // 30분
     *     cleanupInterval: 5 * 60 * 1000, // 5분마다 정리
     *   }
     * );
     * 
     * app.use(tokenMiddleware);
     * app.use(referrerMiddleware);
     * ```
     */
     setupWithORM(ormClient: ORMClient, config?: Partial<ORMStorageConfig>) {
        const fullConfig: ORMStorageConfig = {
            ormClient,
            ttl: config?.ttl || 30 * 60 * 1000, // 기본 30분
            tableName: config?.tableName || 'csrf_tokens',
            autoCreateTable: config?.autoCreateTable ?? true,
            cleanupInterval: config?.cleanupInterval || 10 * 60 * 1000, // 기본 10분마다 정리
            tableOptions: {
                sessionIdLength: config?.tableOptions?.sessionIdLength || 255,
                tokenLength: config?.tableOptions?.tokenLength || 255,
                useJsonColumn: config?.tableOptions?.useJsonColumn ?? true,
                ...config?.tableOptions
            },
            ...config
        };

        // ORM 저장소 생성 (지연 초기화)
        const storage = new ORMCSRFTokenStorage(fullConfig);

        // 전역 관리자에 저장소 주입
        const manager = CSRFStorageManager.getInstance();
        manager.setStorage(storage);

        // CSRF 모듈 생성
        const csrfModule = new CSRFTokenModule(storage, fullConfig);        // 미들웨어들 생성
        const tokenMiddleware = csrfModule.middleware();
        const referrerMiddleware = middlewareFactory.createReferrerMiddleware(csrfModule, fullConfig);

        return {
            csrfModule,
            tokenMiddleware,
            referrerMiddleware,
            storage
        };
    }    
    
    /**
     * 커스텀 저장소로 CSRF 시스템 설정
     * @param storage 커스텀 저장소 구현체
     * @param config 선택적 설정
     */
    setupWithCustomStorage(storage: any, config?: StorageConfig) {
        const manager = CSRFStorageManager.getInstance();
        manager.setStorage(storage);        const csrfModule = new CSRFTokenModule(storage, config);
        const tokenMiddleware = csrfModule.middleware();
        const referrerMiddleware = middlewareFactory.createReferrerMiddleware(csrfModule, config);

        return {
            csrfModule,
            tokenMiddleware,
            referrerMiddleware,
            storage
        };
    }
}
