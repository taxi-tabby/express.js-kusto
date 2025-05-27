import { Request, Response, NextFunction } from 'express';
import { Validator, Schema, ValidationResult } from './validator';
import { log } from '../external/winston';

export interface RequestConfig {
    body?: Schema;
    query?: Schema;
    params?: Schema;
}

export interface ResponseConfig {
    [statusCode: number]: Schema;
}

export interface HandlerConfig {
    request?: RequestConfig;
    response?: ResponseConfig;
}

export interface ValidatedRequest extends Request {
    validatedData?: {
        body?: any;
        query?: any;
        params?: any;
    };
}

export interface ApiResponse {
    success: boolean;
    data?: any;
    error?: {
        message: string;
        details?: any;
    };
    timestamp: string;
}

export class RequestHandler {
    /**
     * 요청 검증 미들웨어 생성
     */
    static validateRequest(config: RequestConfig) {
        return (req: ValidatedRequest, res: Response, next: NextFunction) => {
            const errors: any[] = [];
            const validatedData: any = {};

            // Body 검증
            if (config.body) {
                const bodyResult = Validator.validateBody(req.body, config.body);
                if (!bodyResult.isValid) {
                    errors.push(...bodyResult.errors.map(err => ({ ...err, source: 'body' })));
                } else {
                    validatedData.body = bodyResult.data;
                }
            }

            // Query 검증
            if (config.query) {
                const queryResult = Validator.validateQuery(req.query, config.query);
                if (!queryResult.isValid) {
                    errors.push(...queryResult.errors.map(err => ({ ...err, source: 'query' })));
                } else {
                    validatedData.query = queryResult.data;
                }
            }

            // Params 검증
            if (config.params) {
                const paramsResult = Validator.validateParams(req.params, config.params);
                if (!paramsResult.isValid) {
                    errors.push(...paramsResult.errors.map(err => ({ ...err, source: 'params' })));
                } else {
                    validatedData.params = paramsResult.data;
                }
            }            // 검증 실패 시 에러 응답
            if (errors.length > 0) {
                // 개발자를 위한 자세한 로깅
                log.Debug(`Validation errors for ${req.method} ${req.originalUrl}`, { errors });
                return this.sendError(res, 400, 'Validation failed', errors);
            }

            // 검증된 데이터를 request 객체에 저장
            req.validatedData = validatedData;
            next();
        };
    }

    /**
     * 응답 데이터 검증 및 필터링
     */
    static validateAndFilterResponse(data: any, schema: Schema): any {
        if (!schema) return data;

        const result = Validator.validate(data, schema);
        if (!result.isValid) {
            throw new Error(`Response validation failed: ${result.errors.map(e => e.message).join(', ')}`);
        }

        return result.data;
    }

    /**
     * 성공 응답 전송
     */
    static sendSuccess(res: Response, data?: any, statusCode: number = 200, responseSchema?: Schema): void {
        let filteredData = data;

        // 응답 스키마가 있으면 데이터 필터링
        if (responseSchema && data) {            try {
                filteredData = this.validateAndFilterResponse(data, responseSchema);
            } catch (error) {
                log.Error('Response validation error:', { 
                    error: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined
                });
                return this.sendError(res, 500, 'Internal server error - response validation failed');
            }
        }

        const response: ApiResponse = {
            success: true,
            data: filteredData,
            timestamp: new Date().toISOString()
        };

        res.status(statusCode).json(response);
    }    /**
     * 에러 응답 전송
     */
    static sendError(res: Response, statusCode: number = 500, message: string = 'Internal server error', details?: any): void {
        const isDevelopment = process.env.NODE_ENV !== 'production';
        
        const response: ApiResponse = {
            success: false,
            error: {
                message,
                // 개발 모드에서만 상세 정보 제공
                ...(isDevelopment && details ? { details } : {})
            },
            timestamp: new Date().toISOString()
        };

        res.status(statusCode).json(response);
    }

    /**
     * 핸들러 래퍼 - 검증과 응답을 자동으로 처리
     */
    static createHandler(
        config: HandlerConfig,
        handler: (req: ValidatedRequest, res: Response, next: NextFunction) => Promise<any> | any
    ) {
        const middlewares: any[] = [];

        // 요청 검증 미들웨어 추가
        if (config.request) {
            middlewares.push(this.validateRequest(config.request));
        }

        // 실제 핸들러
        middlewares.push(async (req: ValidatedRequest, res: Response, next: NextFunction) => {
            try {
                const result = await handler(req, res, next);

                // 이미 응답이 전송되었으면 리턴
                if (res.headersSent) {
                    return;
                }

                // 결과가 있으면 성공 응답 전송
                if (result !== undefined) {
                    const statusCode = res.statusCode || 200;
                    const responseSchema = config.response?.[statusCode];
                    this.sendSuccess(res, result, statusCode, responseSchema);
                }            } catch (error) {
                log.Error('Handler error:', { 
                    path: req.originalUrl, 
                    method: req.method,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined
                });
                
                if (!res.headersSent) {
                    if (error instanceof Error) {
                        this.sendError(res, 500, error.message);
                    } else {
                        this.sendError(res, 500, 'Internal server error');
                    }
                }
            }
        });

        return middlewares;
    }

    /**
     * 간단한 핸들러 생성 (요청 검증만)
     */
    static withValidation(
        requestConfig: RequestConfig,
        handler: (req: ValidatedRequest, res: Response, next: NextFunction) => void
    ) {
        return this.createHandler({ request: requestConfig }, handler);
    }

    /**
     * 완전한 핸들러 생성 (요청 검증 + 응답 필터링)
     */
    static withFullValidation(
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest, res: Response, next: NextFunction) => Promise<any> | any
    ) {
        return this.createHandler({
            request: requestConfig,
            response: responseConfig
        }, handler);
    }
}

/**
 * 편의 함수들
 */
export const createValidatedHandler = RequestHandler.createHandler;
export const withValidation = RequestHandler.withValidation;
export const withFullValidation = RequestHandler.withFullValidation;
export const sendSuccess = RequestHandler.sendSuccess;
export const sendError = RequestHandler.sendError;
