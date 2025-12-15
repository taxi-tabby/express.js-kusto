/**
 * 미들웨어 설정 파일
 * 
 * 모든 설정값을 이 파일에서 관리합니다.
 * 값만 변경하면 되도록 구성되어 있습니다.
 */

import helmet from 'helmet';
import cors from 'cors';

// ─────────────────────────────────────────────────────────────
// CORS 설정
// ─────────────────────────────────────────────────────────────

/** 
 * CORS 화이트리스트
 * - 환경변수 CORS_WHITELIST에서 읽어옴
 * - JSON 배열 또는 쉼표 구분 문자열 지원
 */
export const getWhitelist = (): string[] => {
    const env = process.env.CORS_WHITELIST;
    if (!env) return [];
    
    try {
        return env.trim().startsWith('[') 
            ? JSON.parse(env) 
            : env.split(',').map(s => s.trim()).filter(Boolean);
    } catch {
        console.warn('CORS_WHITELIST 파싱 실패');
        return [];
    }
};

export const whitelist = getWhitelist();

export const corsOptions: cors.CorsOptions = {
    optionsSuccessStatus: 204,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
    origin: (origin, callback) => {
        if (!origin || whitelist.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`CORS 차단: ${origin}`);
            callback(null, false);
        }
    },
    credentials: true,
};

// ─────────────────────────────────────────────────────────────
// Helmet 보안 헤더 설정
// ─────────────────────────────────────────────────────────────

export const helmetOptions: Parameters<typeof helmet>[0] = {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'http://localhost:3000', 'http://localhost:3001'],
            connectSrc: ["'self'", 'http://localhost:3000', 'http://localhost:3001'],
        },
    },
};

// ─────────────────────────────────────────────────────────────
// Body Parser 설정
// ─────────────────────────────────────────────────────────────

export const bodyParserOptions = {
    json: {
        type: ['application/json', 'application/vnd.api+json'] as string[],
        limit: '50mb',
    },
    urlencoded: {
        extended: true,
        limit: '50mb',
    },
};

