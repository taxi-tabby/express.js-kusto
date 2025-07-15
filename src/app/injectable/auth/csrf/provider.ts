import { Request } from 'express';

/**
 * CSRF 토큰 제공자 인터페이스
 * 역 의존성 주입을 통해 토큰 제공 로직을 추상화
 */
export interface CSRFTokenProvider {
    /**
     * 현재 유효한 CSRF 토큰을 반환
     * @param req Express Request object (세션 식별을 위해)
     * @returns Promise<string | null> - 현재 활성 토큰
     */
    getCurrentToken(req?: Request): Promise<string | null>;

    /**
     * 새로운 CSRF 토큰을 생성하고 반환
     * @param req Express Request object (세션 식별을 위해)
     * @returns Promise<string> - 새로 생성된 토큰
     */
    generateNewToken(req: Request): Promise<string>;

    /**
     * 토큰이 유효한지 검증
     * @param token 검증할 토큰
     * @param req Express Request object (세션 식별을 위해)
     * @returns Promise<boolean> - 토큰 유효성
     */
    validateToken(token: string, req: Request): Promise<boolean>;
}
