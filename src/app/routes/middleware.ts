import '@lib/types/express-extensions';
import { log } from '@/src/core/external/winston';
import { Request, Response, NextFunction } from 'express';
import { kustoManager } from '@lib/kustoManager';

import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import bodyParser from 'body-parser';

// 설정 import
import {
    corsOptions,
    helmetOptions,
    bodyParserOptions,
} from './middleware.config';

// 클라이언트 IP 미들웨어
import { clientIpMiddleware } from './clientIpMiddleware';


// ─────────────────────────────────────────────────────────────
// 미들웨어 배열
// ─────────────────────────────────────────────────────────────

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
    clientIpMiddleware,

    /**
     * 보안 헤더 설정
     */
    helmet(helmetOptions),

    /**
     * CORS 등록하기
     */
    cors(corsOptions),

    /**
     * 요청 파싱 미들웨어
     */
    cookieParser(),
    bodyParser.json(bodyParserOptions.json),
    bodyParser.urlencoded(bodyParserOptions.urlencoded),

    /**
     * 연결 footwalk 출력 미들웨어
     */
    (req: Request, res: Response, next: NextFunction) => {
        const method = req.method ?? "?";
        const url = req.originalUrl ?? "?";

        

        const ip = req.ip;
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
