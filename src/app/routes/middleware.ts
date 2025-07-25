import { log } from '@/src/core/external/winston';
import { Request, Response, NextFunction } from "express";
import { MiddlewareHandlerFunction, wrapMiddlewares } from '@lib/middlewareHelpers';
import { HandlerFunction, ValidatedHandlerFunction } from '@lib/expressRouter';
import '@lib/types/express-extensions'; // Ensure express extensions are loaded
import { kustoManager } from '@lib/kustoManager'

import cors from 'cors';
import cookieParser from 'cookie-parser'
import helmet from 'helmet';
import bodyParser from 'body-parser';

// DNS를 통한 외부 IP 캐시 변수
let cachedExternalIP: string | null = null;

// 애플리케이션 시작 시 외부 IP 확인 (DNS 및 HTTP 서비스 활용)
const resolveExternalIP = async (): Promise<string> => {
    if (cachedExternalIP) return cachedExternalIP;

    try {
        const dns = require('dns').promises;
        const https = require('https');

        // 1. DNS TXT 레코드를 통한 IP 확인 (가장 빠름)
        try {
            const txtRecords = await dns.resolveTxt('o-o.myaddr.l.google.com');
            if (txtRecords && txtRecords[0] && txtRecords[0][0]) {
                const ip = txtRecords[0][0];
                if (ip && ip.match(/^\d+\.\d+\.\d+\.\d+$/)) {
                    cachedExternalIP = ip;
                    console.log(`External IP resolved via DNS TXT: ${ip}`);
                    return ip;
                }
            }
        } catch (dnsError) {
            console.warn('DNS TXT record resolution failed:', dnsError);
        }        
        
        // 2. HTTP 서비스를 통한 IP 확인 (fallback)
        const getIPServices = (): string[] => {
            const envServices = process.env.EXTERNAL_IP_SERVICES;
            
            if (envServices) {
                try {
                    // JSON 형태로 파싱 시도
                    if (envServices.trim().startsWith('[')) {
                        return JSON.parse(envServices);
                    }
                    // 쉼표로 구분된 문자열 파싱
                    return envServices.split(',').map(url => url.trim()).filter(url => url.length > 0);
                } catch (error) {
                    console.warn('Failed to parse EXTERNAL_IP_SERVICES from environment, using defaults:', error);
                }
            }
            
            // 기본값
            return [
                'https://freeip2geo.net/api',
                'https://freeipapi.com/api/json',
                'https://apip.cc/json',
                'https://api.ipify.org',                    // ipify - JSON/text 등 지원
                'https://checkip.amazonaws.com',            // AWS
                'https://ipv4.icanhazip.com',               // icanhazip - IPv4 전용
                'https://ifconfig.me/ip',                   // ifconfig.me
                'https://api.myip.com',                     // myip.com - JSON
                'https://ipinfo.io/ip',                     // ipinfo.io - text
                'https://api.ipaddress.com/myip',           // ipaddress.com
                'https://ipecho.net/plain',                 // ipecho.net
                'https://ident.me',                         // ident.me
                'https://wtfismyip.com/text',               // wtfismyip
                'https://myexternalip.com/raw',             // myexternalip.com
                'https://us1.api-bdc.net/data/client-ip',   // BigDataCloud
                'https://api.iplocation.net/?cmd=get-ip',   // iplocation.net
                'https://checkip.dyndns.org'                // dyndns - HTML 형식 응답
            ];
        };

        const ipServices = getIPServices();

        // Fisher-Yates 알고리즘을 사용한 배열 무작위 섞기
        const shuffleArray = <T>(array: T[]): T[] => {
            const shuffled = [...array];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
        };

        const shuffledServices = shuffleArray(ipServices);
        console.log(`Trying IP services in random order: ${shuffledServices.slice(0, 3).join(', ')}...`);

        for (const service of shuffledServices) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);

                const response = await fetch(service, {
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Express-Server/1.0' }
                });

                clearTimeout(timeoutId);
                const ip = (await response.text()).trim();
                if (ip && ip.match(/^\d+\.\d+\.\d+\.\d+$/)) {
                    cachedExternalIP = ip;
                    console.log(`External IP resolved via HTTP: ${ip} (${service})`);
                    return ip;
                }
            } catch (httpError) {
                console.warn(`HTTP IP service failed (${service}):`, httpError);
            }
        }

    } catch (error) {
        console.error('External IP resolution completely failed:', error);
    }

    return 'unknown';
};

// 애플리케이션 시작 시 외부 IP 미리 확인
resolveExternalIP().catch(console.error);

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
        if (cachedExternalIP) {
            ['http', 'https'].forEach(protocol => {
                dynamicWhitelist.push(`${protocol}://${cachedExternalIP}`);
            });
        }

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


const getCSRFMiddleware = () => {
    const csrfHelper = kustoManager.getModule('authCsrfHelper')!;
    const client = kustoManager.db.getClient('temporary');


    return csrfHelper.setupWithORM(client, {
        ttl: 30 * 60 * 1000,
        trustedOrigins: whitelist
    });

    // 메모리 저장소 사용 (바꿔야 함.)
    // return csrfHelper.setup({
    //     ttl: 30 * 60 * 1000,
    //     trustedOrigins: whitelist
    // });
}


const {tokenMiddleware, referrerMiddleware} =  getCSRFMiddleware();


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
        
        req.app.set('ip', ip);
        if (!req.app.get('ipex')) {
            req.app.set('ipex', cachedExternalIP);
        }


        log.Footwalk(`[${method}] i[${ip || ips}] ${url}`, {});
        next();
    },

    async (req: Request, res: Response, next: NextFunction) => {
        
        tokenMiddleware(req, res, next);
        req.app.set('_csrfReferrerMiddleware', referrerMiddleware);
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
