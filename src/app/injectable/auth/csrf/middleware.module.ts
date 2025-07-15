import { Request, Response, NextFunction } from 'express';
import { log } from '@/src/core/external/winston';
import { getCurrentToken } from './make';
import { CSRFTokenProvider } from './provider';

/**
 * CSRF Referrer 미들웨어 팩토리
 * 토큰 제공자를 주입받아 검증 로직을 수행
 */
export default class middlewareFactory {

    static createReferrerMiddleware(tokenProvider?: CSRFTokenProvider, config?: { trustedOrigins?: string[] }) {

        /**
         * 동적으로 신뢰할 수 있는 오리진을 판단하는 함수
         * @param req Express Request object
         * @returns string[] - 신뢰할 수 있는 오리진 목록
         */
        const getTrustedOrigins = (req: Request): string[] => {
            const origins: string[] = [];

            // StorageConfig에서 설정된 trustedOrigins를 우선 추가
            if (config?.trustedOrigins && Array.isArray(config.trustedOrigins)) {
                origins.push(...config.trustedOrigins);
            }

            // 현재 요청의 Host 헤더를 기반으로 자동으로 신뢰 오리진 추가
            const hostHeader = req.get('Host');
            if (hostHeader) {
                const protocol = req.secure ? 'https' : 'http';
                origins.push(`${protocol}://${hostHeader}`);

                // 개발 환경에서는 http/https 둘 다 허용
                if (process.env.NODE_ENV === 'development') {
                    origins.push(`http://${hostHeader}`);
                    origins.push(`https://${hostHeader}`);
                }
            }

            // // 환경변수에서 추가 설정 로드
            // if (process.env.APP_URL) {
            //     origins.push(process.env.APP_URL);
            // }
            // if (process.env.FRONTEND_URL) {
            //     origins.push(process.env.FRONTEND_URL);
            // }
            // if (process.env.TRUSTED_DOMAINS) {
            //     const trustedDomains = process.env.TRUSTED_DOMAINS.split(',');
            //     origins.push(...trustedDomains.map(domain => domain.trim()));
            // }

            // 개발 환경에서는 기본 로컬 도메인들 추가
            if (process.env.NODE_ENV === 'development') {
                const defaultDevOrigins = [
                    'http://localhost:3000',
                    'https://localhost:3000',
                    'http://127.0.0.1:3000',
                    'https://127.0.0.1:3000',
                ];
                origins.push(...defaultDevOrigins);
            }

            // 중복 제거 후 반환
            return [...new Set(origins)];
        };

        /**
         * CSRF Referrer 검증 함수
         * @param req Express Request object
         * @returns boolean - 검증 통과 여부
         */
        const validateReferrer = (req: Request): boolean => {
            const referrer = req.get('Referer') || req.get('Origin');

            // GET, HEAD, OPTIONS 메서드는 일반적으로 CSRF 공격에 안전하므로 통과
            if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
                return true;
            }

            // referrer가 없는 경우 처리
            if (!referrer) {
                // 개발 환경에서는 경고만 로그하고 통과
                if (process.env.NODE_ENV === 'development') {
                    log.Info(`CSRF: No referrer header found (dev mode - allowing)`, {
                        method: req.method,
                        path: req.path,
                        ip: req.ip
                    });
                    return true;
                }

                // 프로덕션에서는 차단
                log.Warn(`CSRF: No referrer header found for ${req.method} ${req.path}`, {
                    ip: req.ip,
                    userAgent: req.get('User-Agent') || 'unknown'
                });
                return false;
            }

            try {
                const referrerUrl = new URL(referrer);
                const referrerOrigin = `${referrerUrl.protocol}//${referrerUrl.host}`;

                // 동적으로 trusted origins 가져오기
                const trustedOrigins = getTrustedOrigins(req);

                // trusted origins와 비교
                const isTrusted = trustedOrigins.some((origin: string) => {
                    // 정확한 매칭
                    if (origin === referrerOrigin) return true;

                    // 와일드카드 서브도메인 허용 (예: *.example.com)
                    if (origin.includes('*.')) {
                        const pattern = origin.replace(/\*/g, '.*');
                        const regex = new RegExp(`^${pattern}$`);
                        return regex.test(referrerOrigin);
                    }

                    // 포트가 다른 경우도 고려 (same host, different port)
                    if (process.env.NODE_ENV === 'development') {
                        try {
                            const originUrl = new URL(origin);
                            if (originUrl.hostname === referrerUrl.hostname) {
                                return true;
                            }
                        } catch {
                            // URL 파싱 실패 시 무시
                        }
                    }

                    return false;
                });

                if (!isTrusted) {
                    log.Warn(`CSRF: Untrusted referrer detected`, {
                        referrer: referrerOrigin,
                        trustedOrigins: trustedOrigins.length > 10 ?
                            `${trustedOrigins.slice(0, 5).join(', ')}... (${trustedOrigins.length} total)` :
                            trustedOrigins,
                        method: req.method,
                        path: req.path,
                        ip: req.ip
                    });
                } else {
                    // log.Info(`CSRF: Referrer validation passed`, {
                    //     referrer: referrerOrigin,
                    //     method: req.method,
                    //     path: req.path
                    // });
                }

                return isTrusted;
            } catch (error) {
                log.Error(`CSRF: Invalid referrer URL format: ${referrer}`, {
                    error: error instanceof Error ? error.message : String(error),
                    method: req.method,
                    path: req.path,
                    ip: req.ip
                });

                // 개발 환경에서는 URL 파싱 오류도 허용
                return process.env.NODE_ENV === 'development';
            }
        };    // Referrer 검증 및 CSRF 토큰 검증 미들웨어
        return async (req: Request, res: Response, next: NextFunction) => {
            // Referrer 검증 수행
            if (!validateReferrer(req)) {
                log.Warn(`CSRF: Request blocked due to referrer validation failure`, {
                    method: req.method,
                    path: req.path,
                    referrer: req.get('Referer') || 'none',
                    origin: req.get('Origin') || 'none',
                    ip: req.ip,
                    userAgent: req.get('User-Agent') || 'unknown'
                });

                return res.status(403).json({
                    error: 'Forbidden: Invalid referrer',
                    code: 'CSRF_REFERRER_INVALID',
                    message: 'The request origin is not trusted'
                });
            }

            // POST, PUT, PATCH, DELETE 요청에 대해 CSRF 토큰 검증
            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {

                const clientToken = req.get('X-CSRF-Token') ||
                    req.body?.csrfToken ||
                    req.cookies?.['csrf-token'];



                // 토큰 제공자가 주입되었으면 사용, 아니면 레거시 함수 사용
                let currentToken: string | null = null;


                try {
                    if (tokenProvider && typeof tokenProvider.getCurrentToken === 'function') {
                        // 새로운 토큰 제공자 사용
                        currentToken = await tokenProvider.getCurrentToken(req);
                    } else {
                        // 레거시 함수 사용 (하위 호환성)
                        currentToken = await getCurrentToken(req);
                    }
                } catch (error) {
                    log.Error('CSRF: Failed to get current token', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                    currentToken = null;
                }



                if (!clientToken || clientToken !== currentToken) {
                    log.Warn(`CSRF: Token validation failed`, {
                        method: req.method,
                        hasToken: !!clientToken,
                        tokenMatch: clientToken === currentToken,
                        expectedToken: currentToken,
                        receivedToken: clientToken || '',
                        ip: req.ip
                    });

                    return res.status(403).json({
                        error: 'Forbidden: Invalid CSRF token',
                        code: 'CSRF_TOKEN_INVALID',
                        message: 'CSRF token is missing or invalid'
                    });
                }

                log.Info(`CSRF: Token validation passed`, {
                    method: req.method,
                    path: req.path,
                    tokenUsed: clientToken.substring(0, 8) + '...'
                });
            } next();
        };
    }

    public createReferrerMiddleware(tokenProvider?: CSRFTokenProvider) {
        return middlewareFactory.createReferrerMiddleware(tokenProvider);
    }
}