import { Request, Response, NextFunction } from "express";

import KustoFramework, {cookieParser, helmet, bodyParser, cors} from 'kusto-framework-core';


const log = KustoFramework.log;
const kustoManager = KustoFramework.kustoManager;
import '@core/express-extensions';

const getClientIP = (req: Request): string => {
    // 우선순위에 따른 헤더 확인
    const headers = [
        'cf-connecting-ip',      // Cloudflare
        'x-real-ip',             // Nginx proxy_pass
        'x-forwarded-for',       // 표준 프록시 헤더 (RFC 7239)
        'x-client-ip',           // Apache mod_proxy
        'x-cluster-client-ip',   // 클러스터 환경
        'x-forwarded',           // 일반 forwarded
        'forwarded-for',         // RFC 7239 변형
        'forwarded'              // RFC 7239 표준
    ];

    for (const header of headers) {
        const value = req.headers[header] as string;
        if (value && typeof value === 'string') {
            // 쉼표로 구분된 경우 첫 번째 IP 추출 (원본 클라이언트)
            const firstIP = value.split(',')[0].trim();
            if (firstIP && firstIP !== 'unknown') {
                return firstIP;
            }
        }
    }

    // RFC 7239 Forwarded 헤더 파싱
    const forwarded = req.headers['forwarded'] as string;
    if (forwarded) {
        const forMatch = forwarded.match(/for=([^;,\s]+)/);
        if (forMatch && forMatch[1]) {
            return forMatch[1].replace(/"/g, '').replace(/^\[|\]$/g, ''); // IPv6 brackets 제거
        }
    }

    // Express 내장 IP (trust proxy 설정 시 사용)
    if (req.ip && req.ip !== '::1' && req.ip !== '127.0.0.1') {
        return req.ip;
    }

    // Express 4.x 이상에서 req.ips 사용
    if (req.ips && req.ips.length > 0) {
        return req.ips[0]; // 첫 번째 IP 반환
    }
    
    // Express 3.x 이하에서 req.connection.remoteAddress 사용
    if (req.connection && req.connection.remoteAddress) {
        return req.connection.remoteAddress.replace(/^\[|\]$/g, ''); // IPv6 brackets 제거
    } if (req.socket && req.socket.remoteAddress) {
        return req.socket.remoteAddress.replace(/^\[|\]$/g, ''); // IPv6 brackets 제거
    }

    // 소켓 연결 정보 (마지막 수단)
    const socket = (req as any).socket || (req as any).connection;
    if (socket?.remoteAddress) {
        return socket.remoteAddress;
    }

    return 'unknown';
};


/**
 * CORS 설정
 */
const getWhitelist = (): string[] => {
    const envWhitelist = process.env.CORS_WHITELIST;
    
    if (envWhitelist) {
        try {
            // JSON 형태로 파싱 시도
            if (envWhitelist.trim().startsWith('[')) {
                return JSON.parse(envWhitelist);
            }
            // 쉼표로 구분된 문자열 파싱
            return envWhitelist.split(',').map(url => url.trim()).filter(url => url.length > 0);
        } catch (error) {
            console.warn('Failed to parse CORS_WHITELIST from environment, using defaults:', error);
        }
    }
    
    // 기본값
    return [];
};

const whitelist = getWhitelist();

const corsOptions: cors.CorsOptions = {
    optionsSuccessStatus: 204,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"],
    origin: (origin, callback) => {
        // Create dynamic whitelist including server's own IP if available
        const dynamicWhitelist = [...whitelist];

        if (!origin || dynamicWhitelist.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            log.Error(`Not allowed by CORS (${origin})`, {
                uri: origin
            })
            callback(null, false);
        }
    },    
    credentials: true,
};




export default [

    /**
     * Kusto Manager 초기화 미들웨어 (모든 미들웨어보다 먼저 실행)
     */
    (req: Request, res: Response, next: NextFunction) => {
        // Initialize kusto manager if not already present
        if (!req.kusto) {
            req.kusto = kustoManager;
        }
        next();
    },

    /**
     * 보안 헤더 설정
     */
    helmet(),

    /**
     * CORS 등록하기
     */
    cors(corsOptions),

    /**
     * 요청 파싱 미들웨어
     */
    cookieParser(),
    bodyParser.json({ 
        type: ['application/json', 'application/vnd.api+json'],
        limit: '50mb'
    }),
    bodyParser.urlencoded({ extended: true, limit: '50mb' }),

    /**
     * 연결 footwalk 출력 미들웨어
     */
    (req: Request, res: Response, next: NextFunction) => {
        const method = req.method ?? "?";
        const url = req.originalUrl ?? "?";

        const ip = getClientIP(req);
        const ips = (req.ips ? req.ips.join(",") : "");
        
        log.Footwalk(`[${method}] i[${ip || ips}] ${url}`, {});
        next();
    },



    /**
     * 에러 핸들링 미들웨어
     */
    (err: Error, req: Request, res: Response, next: NextFunction) => {
        res.status(500).json({
            message: "서버 내부 오류입니다.",
            error: err.message
        });
    }
];
