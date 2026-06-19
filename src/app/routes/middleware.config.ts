/**
 * 미들웨어 설정 파일
 * 
 * 모든 설정값을 이 파일에서 관리합니다.
 * 값만 변경하면 되도록 구성되어 있습니다.
 */

import helmet from 'helmet';
import cors from 'cors';
import { JSON_API_CONTENT_TYPE } from '@lib/jsonApiConstants';
import { log } from '@ext/winston';

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
        log.Warn('Failed to parse CORS_WHITELIST');
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
            log.Warn(`CORS blocked: ${origin}`);
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
        type: ['application/json', JSON_API_CONTENT_TYPE] as string[],
        limit: '50mb',
    },
    urlencoded: {
        extended: true,
        limit: '50mb',
    },
};

// ─────────────────────────────────────────────────────────────
// CSRF
// ─────────────────────────────────────────────────────────────
//
// P1-11: 과거 `csrfOptions` 가 정의만 되고 어디에도 적용되지 않아(dead config),
// 마치 CSRF 보호가 있는 것처럼 오해를 줬다. 실제 CSRF 미들웨어가 없으므로 제거했다.
//
// ⚠️ 쿠키 기반 인증(credentials: true)을 사용한다면 CSRF 보호가 필요하다.
//    그 경우 앱에서 csrf 라이브러리(예: csrf-csrf 의 double-submit 토큰)를 추가해
//    middleware.ts 의 cookieParser/bodyParser 뒤, 라우트 핸들러 앞에 등록하라.
//    Bearer 토큰(Authorization 헤더) 기반 인증만 쓴다면 CSRF 는 일반적으로 불필요하다.