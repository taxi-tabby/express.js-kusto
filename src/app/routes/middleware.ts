import '@lib/types/express-extensions';
import { log } from '@ext/winston';
import { Request, Response, NextFunction } from 'express';
import { kustoManager } from '@lib/data/di/kustoManager';
import { ErrorHandler, ErrorResponseFormat } from '@lib/http/errors/errorHandler';

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

    // 클라이언트 IP 추출 미들웨어
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
     * 전역 에러 핸들링 미들웨어 (4-arg).
     *
     * P1-7: 과거에는 `err.message` 를 모든 환경에서 그대로 노출하여(연결 문자열/스택 유출)
     * ErrorHandler 의 redaction 파이프라인을 우회했다. 이제는 ErrorHandler 를 경유하여
     * NODE_ENV 기준으로 민감 정보를 제거하고 JSON:API 형태로 응답한다.
     * (라우트 로더가 이 4-arg 핸들러를 라우트 등록 이후 맨 뒤에 mount 한다.)
     */
    (err: Error, req: Request, res: Response, next: NextFunction) => {
        if (res.headersSent) return next(err);
        // 에러가 명시한 HTTP 상태를 존중하고, 없으면 500 으로 폴백
        const status = (err as any)?.statusCode ?? (err as any)?.status ?? 500;
        const body = ErrorHandler.handleError(err, {
            format: ErrorResponseFormat.JSON_API,
            context: { path: req.originalUrl, method: req.method, status },
            // security 생략 → applySecurity 가 NODE_ENV 기준으로 stack/connection-string 등 redaction
        });
        res.status(status).json(body);
    }
];