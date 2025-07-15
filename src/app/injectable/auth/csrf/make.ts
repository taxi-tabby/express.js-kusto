import { Request, Response, NextFunction } from 'express';
import { log } from '@/src/core/external/winston';
import crypto from 'crypto';
import { CSRFTokenProvider } from './provider';
import { CSRFTokenStorage, CSRFTokenData, StorageConfig } from './storage.interface';
import { CSRFStorageManager } from './factory';

// Request 타입 확장 (세션 지원)
declare module 'express-serve-static-core' {
    interface Request {
        session?: {
            id?: string;
            [key: string]: any;
        };
    }
}

/**
 * CSRF Token 보안 시스템
 * - 세션별 독립적인 토큰 관리
 * - 클라이언트 전달 방법: X-CSRF-Token 헤더, csrf-token 쿠키, csrfToken body
 */

const TOKEN_LIFETIME = 24 * 60 * 60 * 1000; // 24시간

/**
 * CSRF 토큰 생성 함수
 * @returns string - 새로운 CSRF 토큰
 */
const generateCSRFToken = (): string => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * 세션 ID를 생성하는 함수
 * @param req Express Request object
 * @returns string - 세션 식별자
 */
const getSessionId = (req: Request): string => {
    // 1순위: 세션 ID가 있으면 사용
    if (req.session?.id) {
        return req.session.id;
    }
    
    // 2순위: 쿠키의 세션 ID 사용
    if (req.cookies?.['session-id']) {
        return req.cookies['session-id'];
    }
    
    // 3순위: IP + User-Agent 조합으로 임시 세션 ID 생성
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    return crypto.createHash('sha256').update(`${ip}:${userAgent}`).digest('hex');
};

// === 하위 호환성을 위한 전역 함수들 ===

/**
 * 현재 CSRF 토큰을 반환하는 함수 (하위 호환성용)
 * @deprecated 새 코드에서는 CSRFTokenModule 인스턴스를 사용하세요
 * @param req Express Request object
 * @returns string | null - 현재 활성 토큰
 */
export const getCurrentToken = async (req?: Request): Promise<string | null> => {
    if (!req) {
        return null;
    }
    
    try {
        const manager = CSRFStorageManager.getInstance();
        if (!manager.hasStorage()) {
            log.Warn('CSRF getCurrentToken: No storage injected');
            return null;
        }
        
        const storage = manager.getStorage();
        const sessionId = getSessionId(req);
        const tokenData = await storage.getToken(sessionId);
        
        return tokenData?.token || null;
    } catch (error) {
        log.Error('CSRF getCurrentToken: Failed', {
            error: error instanceof Error ? error.message : String(error)
        });
        return null;
    }
};

/**
 * CSRF Token Module 클래스
 * 의존성 주입 시스템과 호환되는 클래스 구조
 * CSRFTokenProvider 인터페이스를 구현하여 역 의존성 주입 지원
 * 외부에서 저장소 구현체를 주입받아 사용
 */
class CSRFTokenModule implements CSRFTokenProvider {
    private readonly tokenLifetime: number;    
    constructor(
        private readonly storage: CSRFTokenStorage,
        config?: { ttl?: number }
    ) {        this.tokenLifetime = config?.ttl || TOKEN_LIFETIME;
        // 지연 초기화 패턴 사용 - 생성자에서 초기화하지 않음
    }
    
    /**
     * 현재 유효한 CSRF 토큰을 반환 (CSRFTokenProvider 구현)
     * @param req Express Request object
     * @returns Promise<string | null> - 현재 활성 토큰
     */
    public async getCurrentToken(req?: Request): Promise<string | null> {
        if (!req) {
            return null;
        }
        
        try {
            const sessionId = getSessionId(req);
            const tokenData = await this.storage.getToken(sessionId);
            
            return tokenData?.token || null;
        } catch (error) {
            log.Error('CSRF Module: Failed to get current token', {
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * 새로운 CSRF 토큰을 생성하고 반환 (CSRFTokenProvider 구현)
     * @param req Express Request object
     * @returns Promise<string> - 새로 생성된 토큰
     */
    public async generateNewToken(req: Request): Promise<string> {
        try {
            const sessionId = getSessionId(req);
            const newToken = generateCSRFToken();
            const now = Date.now();
            
            const tokenData: CSRFTokenData = {
                token: newToken,
                generatedAt: now,
                sessionId,
                expiresAt: now + this.tokenLifetime,
                metadata: {
                    userAgent: req.get('User-Agent'),
                    ip: req.ip
                }
            };
            

            if (!await this.storage.saveToken(sessionId, tokenData)) {
                log.Warn('CSRF Module: Failed to save new token', {newToken});
            }
            
            // log.Info(`CSRF: New token generated for session`, {
            //     sessionId: sessionId || '',
            //     tokenExpiry: new Date(tokenData.expiresAt).toISOString()
            // });
            
            return newToken;
        } catch (error) {
            log.Error('CSRF Module: Failed to generate new token', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * 토큰이 유효한지 검증 (CSRFTokenProvider 구현)
     * @param token 검증할 토큰
     * @param req Express Request object
     * @returns Promise<boolean> - 토큰 유효성
     */
    public async validateToken(token: string, req: Request): Promise<boolean> {
        try {
            const currentToken = await this.getCurrentToken(req);
            return currentToken !== null && currentToken === token;
        } catch (error) {
            log.Error('CSRF Module: Failed to validate token', {
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }    
    
    /**
     * CSRF 토큰 생성/설정 미들웨어를 반환하는 메서드
     * @returns Express 미들웨어 함수
     */
    public middleware() {
        return async (req: Request, res: Response, next: NextFunction) => {
            try {
                const sessionId = getSessionId(req);
                
                let tokenData = await this.storage.getToken(sessionId);

                // console.log('-------------------------------------', sessionId, tokenData)

                // 토큰이 없거나 만료되었으면 새로 생성
                if (!tokenData) {
                    const newToken = await this.generateNewToken(req);
                    tokenData = await this.storage.getToken(sessionId);
                }

                if (!tokenData) {
                    throw new Error('Failed to create or retrieve token');
                }

                // 응답 헤더에 CSRF 토큰 설정 (클라이언트에서 읽을 수 있도록)
                res.setHeader('X-CSRF-Token', tokenData.token);

                // 쿠키에도 설정 (JavaScript에서 접근 가능하도록)
                res.cookie('csrf-token', tokenData.token, {
                    httpOnly: false, // JavaScript에서 읽을 수 있도록
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: this.tokenLifetime
                });

                // 세션 ID 쿠키도 설정 (세션 추적용)
                if (!req.cookies?.['session-id']) {
                    res.cookie('session-id', sessionId, {
                        httpOnly: true,
                        secure: process.env.NODE_ENV === 'production',
                        sameSite: 'strict',
                        maxAge: this.tokenLifetime
                    });
                }

                next();
            } catch (error) {
                log.Error('CSRF Module: Middleware error', {
                    error: error instanceof Error ? error.message : String(error),
                    path: req.path
                });
                
                // 에러 발생시에도 계속 진행 (CSRF는 보안 강화용이므로)
                next();
            }
                };
    }
}

export default CSRFTokenModule;
