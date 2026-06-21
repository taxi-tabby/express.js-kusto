import { Request, Response, NextFunction, RequestHandler } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import { log } from '@ext/winston';
import { JSON_API_CONTENT_TYPE } from '@lib/crud/jsonApiConstants';

/**
 * 기본 글로벌 미들웨어 "정책" 스택(Core 제공, 교체 가능).
 *
 * helmet(보안 헤더) / CORS / cookie / body 파서 / 요청 로깅 — 합리적 기본값을 env 로 구동한다.
 * 사용자는 `app/routes/middleware.ts` 에서 `...defaultGlobalMiddleware()` 를 spread 한 뒤 자신의
 * 미들웨어를 추가하거나, 옵션으로 정책을 조정한다. middleware.ts 가 없으면 로더가 이 기본을 적용한다.
 *
 * (필수 미들웨어 — req.kusto 주입 / clientIp / 전역 에러 — 는 Core 가 별도로 소유한다. 여기엔 없다.)
 */

export interface GlobalMiddlewareOptions {
    /** CORS 허용 오리진. 미지정 시 env `CORS_WHITELIST`(JSON 배열 또는 콤마 구분)에서 읽음. */
    corsWhitelist?: string[];
    /** body 파서 크기 한도(기본 '50mb'). */
    bodyLimit?: string;
    /** helmet 옵션 override(미지정 시 기본 CSP). */
    helmet?: Parameters<typeof helmet>[0];
    /** 요청 로깅(Footwalk) 비활성화. */
    disableRequestLog?: boolean;
}

/** CORS 화이트리스트 — env `CORS_WHITELIST`(JSON 배열 또는 콤마 구분). */
export function resolveCorsWhitelist(explicit?: string[]): string[] {
    if (explicit) return explicit;
    const env = process.env.CORS_WHITELIST;
    if (!env) return [];
    try {
        return env.trim().startsWith('[')
            ? JSON.parse(env)
            : env
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
    } catch {
        log.Warn('Failed to parse CORS_WHITELIST');
        return [];
    }
}

function buildCorsOptions(whitelist: string[]): cors.CorsOptions {
    return {
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
}

const DEFAULT_HELMET: Parameters<typeof helmet>[0] = {
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

/** 요청 로깅(winston Footwalk 레벨). 클라이언트 IP 는 Core 의 clientIp 미들웨어가 채운다. */
function requestLogMiddleware(req: Request, _res: Response, next: NextFunction): void {
    const method = req.method ?? '?';
    const url = req.originalUrl ?? '?';
    const ip = req.ip;
    const ips = req.ips ? req.ips.join(',') : '';
    log.Footwalk(`[${method}] i[${ip || ips}] ${url}`, {});
    next();
}

/**
 * 기본 글로벌 미들웨어 정책 스택을 반환한다(순서대로).
 * helmet → cors → cookieParser → body(json+urlencoded) → requestLog.
 */
export function defaultGlobalMiddleware(options: GlobalMiddlewareOptions = {}): RequestHandler[] {
    const limit = options.bodyLimit ?? '50mb';
    const whitelist = resolveCorsWhitelist(options.corsWhitelist);
    const stack: RequestHandler[] = [
        helmet(options.helmet ?? DEFAULT_HELMET),
        cors(buildCorsOptions(whitelist)),
        cookieParser(),
        bodyParser.json({ type: ['application/json', JSON_API_CONTENT_TYPE], limit }),
        bodyParser.urlencoded({ extended: true, limit }),
    ];
    if (!options.disableRequestLog) {
        stack.push(requestLogMiddleware);
    }
    return stack;
}
