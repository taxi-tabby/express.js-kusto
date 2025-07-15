/**
 * CSRF 토큰 데이터 구조
 */
export interface CSRFTokenData {
    token: string;
    generatedAt: number;
    sessionId: string;
    expiresAt: number;
    metadata?: Record<string, any>; // 확장 가능한 메타데이터
}

/**
 * CSRF 토큰 저장소 추상 인터페이스
 * RDB, NoSQL, Memory 등 다양한 저장소 구현 지원
 */
export interface CSRFTokenStorage {
    /**
     * 세션별 토큰 저장
     * @param sessionId 세션 식별자
     * @param tokenData 토큰 데이터
     * @returns Promise<boolean> - 저장 성공 여부
     */
    saveToken(sessionId: string, tokenData: CSRFTokenData): Promise<boolean>;

    /**
     * 세션별 토큰 조회
     * @param sessionId 세션 식별자
     * @returns Promise<CSRFTokenData | null> - 토큰 데이터 또는 null
     */
    getToken(sessionId: string): Promise<CSRFTokenData | null>;

    /**
     * 세션별 토큰 삭제
     * @param sessionId 세션 식별자
     * @returns Promise<boolean> - 삭제 성공 여부
     */
    deleteToken(sessionId: string): Promise<boolean>;

    /**
     * 만료된 토큰들 일괄 정리
     * @returns Promise<number> - 정리된 토큰 수
     */
    cleanupExpiredTokens(): Promise<number>;

    /**
     * 저장소 연결 상태 확인
     * @returns Promise<boolean> - 연결 상태
     */
    isHealthy(): Promise<boolean>;

    /**
     * 저장소 초기화
     * @returns Promise<void>
     */
    initialize(): Promise<void>;

    /**
     * 저장소 종료 (연결 해제 등)
     * @returns Promise<void>
     */
    cleanup(): Promise<void>;
}

/**
 * 저장소 설정 인터페이스
 */
export interface StorageConfig {
    trustedOrigins?: string[]; // CSRF 토큰을 허용할 신뢰된 출처 목록
    connectionString?: string;
    options?: Record<string, any>;
    ttl?: number; // Time To Live (milliseconds)
}
