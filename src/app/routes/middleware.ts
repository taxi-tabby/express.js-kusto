import { log } from '@/src/core/external/winston';
import {Request, Response, NextFunction} from "express";

import cors from 'cors';
import cookieParser from 'cookie-parser'
import helmet from 'helmet';
import bodyParser from 'body-parser';

const whitelist = [
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'https://rest.wiki'
];

const corsOptions: cors.CorsOptions = {
    optionsSuccessStatus: 204,
    methods: ["POST", "PUT", "GET", "OPTIONS", "HEAD"],
    origin: (origin, callback) => {
        if (!origin || whitelist.indexOf(origin) !== -1) { 
            callback(null, true);
        } else {
            log.Error(`Not allowed by CORS (${origin})`, {
                uri: origin
            })
            callback(null ,false);
        }
    },
    credentials: true,
};


export default [



    /**
     * 보안 헤더 설정
     */
    helmet({}),

    /**
     * CORS 등록하기
     */
    cors(corsOptions),

    /**
     * 요청 파싱 미들웨어
     */
    cookieParser(),
    bodyParser.json(),
    bodyParser.urlencoded({ extended: true, limit: '50mb' }),



    /**
     * 연결 footwalk 출력 미들웨어
     */
    (req: Request, res: Response, next: NextFunction) => {
        const method = req.method ?? "?";
        const url = req.originalUrl ?? "?";
        const ip = req.ip ?? "";
        const ips = (req.ips ? req.ips.join(",") : "");

        log.Footwalk(`[${method}] i[${ip || ips}] ${url}`, {});

        console.log("-=----------------------------- 0 -----------------------------=-");
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
