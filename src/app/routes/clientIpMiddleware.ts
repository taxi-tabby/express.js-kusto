import { Request, Response, NextFunction } from 'express';

/**
 * IP 유효성 검증 (IPv4 및 IPv6)
 */
const isValidIp = (ip: string): boolean => {
    if (!ip || ip.length === 0) return false;
    
    // IPv4 패턴
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Pattern.test(ip)) {
        const parts = ip.split('.').map(Number);
        return parts.every(part => part >= 0 && part <= 255);
    }
    
    // IPv6 패턴 (간소화된 검증)
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$|^::1$|^::$/;
    if (ipv6Pattern.test(ip)) return true;
    
    // IPv6 매핑된 IPv4 (::ffff:x.x.x.x)
    const mappedIpv4Pattern = /^::ffff:(\d{1,3}\.){3}\d{1,3}$/i;
    if (mappedIpv4Pattern.test(ip)) return true;

    return false;
};

/**
 * IP 정규화 (IPv6 매핑된 IPv4 처리)
 * ::ffff:192.168.1.1 -> 192.168.1.1
 */
const normalizeIp = (ip: string): string => {
    if (!ip) return '';
    const mappedIpv4Match = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (mappedIpv4Match) {
        return mappedIpv4Match[1];
    }
    return ip;
};

/**
 * 사설 IP 여부 확인
 */
const isPrivateIp = (ip: string): boolean => {
    const normalizedIp = normalizeIp(ip);
    
    // IPv4 사설 대역
    const privateRanges = [
        /^10\./,                      // 10.0.0.0/8
        /^172\.(1[6-9]|2\d|3[01])\./,  // 172.16.0.0/12
        /^192\.168\./,                // 192.168.0.0/16
        /^127\./,                     // 127.0.0.0/8 (localhost)
        /^169\.254\./,                // 169.254.0.0/16 (link-local)
        /^0\./,                       // 0.0.0.0/8
    ];
    
    for (const range of privateRanges) {
        if (range.test(normalizedIp)) return true;
    }

    // IPv6 사설/로컬 주소
    if (normalizedIp === '::1') return true;  // localhost
    if (normalizedIp.startsWith('fe80:')) return true;  // link-local
    if (normalizedIp.startsWith('fc') || normalizedIp.startsWith('fd')) return true;  // unique local

    return false;
};

/**
 * 클라이언트 IP 주소 오버라이드 미들웨어
 * trust proxy 설정과 관계없이 프록시 헤더에서 실제 클라이언트 IP를 추출
 * 
 * 우선순위:
 * 1. CF-Connecting-IP (Cloudflare)
 * 2. True-Client-IP (Cloudflare Enterprise, Akamai)
 * 3. X-Real-IP (Nginx)
 * 4. X-Forwarded-For (일반 프록시/로드밸런서)
 * 5. 기본 소켓 정보
 */
export const clientIpMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const originalIp = req.ip;
    const socketIp = req.socket?.remoteAddress;

    const getClientIp = (): string | undefined => {
        // 1. Cloudflare - 가장 신뢰할 수 있는 소스 (Cloudflare가 직접 설정)
        const cfConnectingIp = req.headers['cf-connecting-ip'];
        if (cfConnectingIp) {
            const ip = Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp;
            if (ip && isValidIp(ip.trim())) return ip.trim();
        }

        // 2. True-Client-IP (Cloudflare Enterprise, Akamai)
        const trueClientIp = req.headers['true-client-ip'];
        if (trueClientIp) {
            const ip = Array.isArray(trueClientIp) ? trueClientIp[0] : trueClientIp;
            if (ip && isValidIp(ip.trim())) return ip.trim();
        }

        // 3. X-Real-IP (Nginx 등 리버스 프록시)
        const xRealIp = req.headers['x-real-ip'];
        if (xRealIp) {
            const ip = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
            if (ip && isValidIp(ip.trim())) return ip.trim();
        }

        // 4. X-Forwarded-For (프록시 체인)
        const xForwardedFor = req.headers['x-forwarded-for'];
        if (xForwardedFor) {
            const forwarded = Array.isArray(xForwardedFor) 
                ? xForwardedFor[0] 
                : xForwardedFor;
            
            // 쉼표로 구분된 IP 목록에서 첫 번째 유효한 공인 IP 추출
            const ips = forwarded.split(',').map(ip => ip.trim());
            for (const ip of ips) {
                if (isValidIp(ip) && !isPrivateIp(ip)) {
                    return ip;
                }
            }
            // 공인 IP가 없으면 첫 번째 유효한 IP 반환
            for (const ip of ips) {
                if (isValidIp(ip)) {
                    return ip;
                }
            }
        }

        // 5. 기본 소켓 정보
        const fallbackIp = originalIp || socketIp;
        if (fallbackIp) {
            return normalizeIp(fallbackIp);
        }

        return undefined;
    };

    const clientIp = getClientIp();
    const normalizedClientIp = clientIp ? normalizeIp(clientIp) : undefined;
    
    // req.ip를 오버라이드 (getter로 재정의)
    Object.defineProperty(req, 'ip', {
        get: () => normalizedClientIp,
        configurable: true,
        enumerable: true
    });

    // 추가 정보를 req에 저장 (디버깅/로깅용)
    Object.defineProperty(req, 'clientIpInfo', {
        value: {
            resolved: normalizedClientIp,
            original: originalIp,
            socket: socketIp,
            headers: {
                'cf-connecting-ip': req.headers['cf-connecting-ip'],
                'true-client-ip': req.headers['true-client-ip'],
                'x-real-ip': req.headers['x-real-ip'],
                'x-forwarded-for': req.headers['x-forwarded-for'],
            }
        },
        configurable: true,
        enumerable: true
    });

    next();
};

export default clientIpMiddleware;
