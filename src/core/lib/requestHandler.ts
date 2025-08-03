import { Request, Response, NextFunction } from 'express';
import { Validator, Schema, ValidationResult, FieldSchema } from './validator';
import { log } from '../external/winston';
import { DependencyInjector } from './dependencyInjector';
import { Injectable } from './types/generated-injectable-types';
import { prismaManager } from './prismaManager';
import { repositoryManager } from './repositoryManager';

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
    sourceInfo?: {
        filePath: string;
        lineNumber?: number;
    };
}

export interface ValidatedRequest<TConfig extends RequestConfig = RequestConfig> extends Request {
    validatedData: {
        body: TConfig['body'] extends Schema ? InferValidatedData<TConfig['body']> : any;
        query: TConfig['query'] extends Schema ? InferValidatedData<TConfig['query']> : any;
        params: TConfig['params'] extends Schema ? InferValidatedData<TConfig['params']> : any;
    };
}

// Type to infer validated data structure from schema
type InferValidatedData<T extends Schema> = {
    [K in keyof T]: T[K] extends { required: true }
        ? ExtractFieldType<T[K]>
        : T[K] extends { required: false }
        ? ExtractFieldType<T[K]> | undefined
        : ExtractFieldType<T[K]> | undefined;
};

// Helper type to extract field types based on FieldSchema
export type ExtractFieldType<T extends FieldSchema> = 
    T['type'] extends 'string' ? string :
    T['type'] extends 'number' ? number :
    T['type'] extends 'boolean' ? boolean :
    T['type'] extends 'array' ? any[] :
    T['type'] extends 'object' ? any :
    T['type'] extends 'email' ? string :
    T['type'] extends 'url' ? string :
    T['type'] extends 'file' ? any :
    T['type'] extends 'binary' ? any :
    T['type'] extends 'buffer' ? Buffer :
    any;

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
            }            
              // 검증 실패 시 에러 응답
            if (errors.length > 0) {
                // 개발자를 위한 자세한 로깅
                log.Debug(`Validation errors for ${req.method} ${req.originalUrl}`, { errors });
                return this.sendError(res, 422, 'Validation failed', errors);
            }

            // 검증된 데이터를 request 객체에 저장
            req.validatedData = validatedData;
            next();
        };
    }    /**
     * 응답 데이터 검증 및 필터링
     * 스키마에 정의되지 않은 추가 필드가 있는지도 검사
     */
    static validateAndFilterResponse(data: any, schema: Schema): any {
        if (!schema) return data;

        // 정의되지 않은 필드 검사
        const undefinedFields = this.checkUndefinedFields(data, schema);
        if (undefinedFields.length > 0) {
            throw new Error(`Response contains undefined fields not in schema: ${undefinedFields.join(', ')}`);
        }

        const result = Validator.validate(data, schema);
        if (!result.isValid) {
            throw new Error(`Response validation failed: ${result.errors.map(e => e.message).join(', ')}`);
        }

        return result.data;
    }

    /**
     * 스키마에 정의되지 않은 필드 확인
     */
    private static checkUndefinedFields(data: any, schema: Schema): string[] {
        if (!data || typeof data !== 'object') {
            return [];
        }
        
        const undefinedFields: string[] = [];
        const schemaKeys = Object.keys(schema);
        
        // 데이터의 모든 키를 순회하며 스키마에 정의되지 않은 필드 확인
        Object.keys(data).forEach(key => {
            if (!schemaKeys.includes(key)) {
                undefinedFields.push(key);
            }
        });
        
        return undefinedFields;
    }
    
    
    /**
     * 성공 응답 전송
     */
    static sendSuccess(res: Response, data?: any, statusCode: number = 200, responseSchema?: Schema, responseConfig?: ResponseConfig): void {
        let filteredData = data;

        // 응답 상태 코드가 ResponseConfig에 정의되어 있는지 확인
        if (responseConfig && !responseConfig[statusCode]) {
            log.Error(`Undefined status code ${statusCode} in response config`, { 
                statusCode,
                availableCodes: Object.keys(responseConfig),
                data
            });
            return this.sendError(res, 500, `Internal server error - status code ${statusCode} not defined in response config`);
        }

        // 응답 스키마가 있으면 데이터 필터링
        if (responseSchema && data) {            
            try {
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
    }
    
    
    /**
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
     * 라우트 핸들러 코드를 정적 분석하여 정의된 응답 상태 코드가 적절하게 구현되어 있는지 검증
     */    
      static validateHandlerImplementation(
        responseConfig: ResponseConfig | undefined, 
        handlerSource: string,
        sourceInfo?: { filePath: string; lineNumber?: number }
    ): string[] {

        if (!responseConfig) return [];
        
        // 개발 환경에서만 실행
        if (process.env.NODE_ENV === 'production') return [];
        
        const statusCodes = Object.keys(responseConfig);
        if (statusCodes.length <= 1) return []; // 기본 응답 코드만 있으면 검증 불필요
        
        // 기본 200 상태 코드를 제외한 다른 상태 코드들
        const nonDefaultStatusCodes = statusCodes.filter(code => code !== '200');
        const missingImplementations: string[] = [];
          for (const code of nonDefaultStatusCodes) {
            // 상태 코드 설정 코드가 핸들러에 있는지 확인
            
            // 주석 처리된 행 제거 (/* */, //, JSDoc 등 처리)
            const handlerWithoutComments = handlerSource
                .replace(/\/\*[\s\S]*?\*\//g, '') // 여러 줄 주석 제거
                .replace(/\/\/.*$/gm, '') // 한 줄 주석 제거
                .replace(/^\s*\*.*$/gm, ''); // JSDoc 라인 제거
            
            // 상태 코드 설정을 감지하는 정규식 (변수 사용 패턴도 포함)
            const statusSetPattern = new RegExp(
                `(?<!['"\`])(?:\\.|\\s|^)status\\s*\\(\\s*(?:${code}|[a-zA-Z_$][a-zA-Z0-9_$]*\\s*(?:===?|==|===)\\s*${code})\\s*\\)|` + // .status(code) 또는 .status(변수) 패턴
                `sendStatus\\s*\\(\\s*(?:${code}|[a-zA-Z_$][a-zA-Z0-9_$]*\\s*(?:===?|==|===)\\s*${code})\\s*\\)|` + // sendStatus(code) 패턴
                `statusCode\\s*[\\s:=]*\\s*(?:${code}|[a-zA-Z_$][a-zA-Z0-9_$]*\\s*(?:===?|==|===)\\s*${code})|` + // statusCode = code 패턴
                `['"]?status(?:Code)?['"]?\\s*[:=]\\s*(?:${code}|[a-zA-Z_$][a-zA-Z0-9_$]*\\s*(?:===?|==|===)\\s*${code})|` + // status: code 패턴
                `['"]?${code}['"]?\\s*[:=]|` + // "400": {...} 패턴
                `[a-zA-Z_$][a-zA-Z0-9_$]*\\s*=\\s*${code}\\b` // 변수 = 400 패턴
            , 'i');
            
            // 에러 핸들링을 감지하는 정규식
            const errorHandlerPattern = new RegExp(
                `sendError.*?(?:${code}|[a-zA-Z_$][a-zA-Z0-9_$]*\\s*(?:===?|==|===)\\s*${code})|` + // sendError 함수 호출 패턴
                `throw\\s+.*(${code}|(?:new\\s+)?Error|[a-zA-Z_$][a-zA-Z0-9_$]*Error)|` + // throw 문 패턴
                `return\\s+.*(?:${code}|error|[a-zA-Z_$][a-zA-Z0-9_$]*\\s*(?:===?|==|===)\\s*${code})|` + // return 문 패턴 
                `response.*?${code}|` + // response 관련 패턴
                `code\\s*[\\s:=]*\\s*(?:${code}|[a-zA-Z_$][a-zA-Z0-9_$]*\\s*(?:===?|==|===)\\s*${code})` // code = 400 패턴
            , 'i');
            
            if (!statusSetPattern.test(handlerWithoutComments) && !errorHandlerPattern.test(handlerWithoutComments)) {
                const fileInfo = sourceInfo ? 
                    `${sourceInfo.filePath}${sourceInfo.lineNumber ? ` (line: ${sourceInfo.lineNumber})` : ''}` : 
                    'Unknown location';
                
                const message = `Response status code ${code} is defined but not implemented in handler`;
                log.Warn(message, { 
                    code, 
                    location: fileInfo,
                    handlerSource: handlerSource.substring(0, 200) + '...'  // 더 짧게 줄임
                });
                missingImplementations.push(`${code} (${message} in ${fileInfo})`);
            }
        }
        
        return missingImplementations;
    }    /**
     * 핸들러 래퍼 - 검증과 응답을 자동으로 처리 (Dependency Injection 지원)
     */    static createHandler(
        config: HandlerConfig,
        handler: (req: ValidatedRequest, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => Promise<any> | any
    ) {
        const middlewares: any[] = [];

        // 핸들러의 소스 코드를 얻어서 정적 분석 수행
        if (config.response && process.env.NODE_ENV !== 'production') {
            try {
                const handlerSource = handler.toString();

                // 소스 정보 로깅
                // log.Debug('Handler source info', {
                //     sourceInfo: config.sourceInfo,
                //     handlerStartsWith: handlerSource.substring(0, 100)
                // });

                const missingImplementations = this.validateHandlerImplementation(config.response, handlerSource, config.sourceInfo);
                
                // STRICT_STATUS_CODE_CHECK=true 환경변수가 설정되어 있으면 누락된 구현이 있을 경우 오류를 발생시킵니다.
                if (missingImplementations.length > 0 && process.env.STRICT_STATUS_CODE_CHECK === 'true') {
                    const errorMessage = `The following status codes are defined but not implemented: ${missingImplementations.join(', ')}`;
                    log.Error(errorMessage);
                    
                    // 자동 테스트 위해 첫 번째 미들웨어로 오류를 반환하는 함수 추가
                    middlewares.push((req: Request, res: Response) => {
                        this.sendError(res, 500, `API Implementation Error: ${errorMessage}`);
                    });
                    return middlewares;
                }
            } catch (error) {
                log.Error('Failed to analyze handler implementation', { error });
            }
        }

        // 요청 검증 미들웨어 추가
        if (config.request) {
            middlewares.push(this.validateRequest(config.request));
        }        // Dependency injection을 지원하는 실제 핸들러
        middlewares.push(async (req: ValidatedRequest, res: Response, next: NextFunction) => {
            try {                // Dependency injector에서 모든 injectable 모듈 가져오기
                const injected = DependencyInjector.getInstance().getInjectedModules();
                
                const result = await handler(req, res, injected, repositoryManager, prismaManager);

                // 이미 응답이 전송되었으면 리턴
                if (res.headersSent) {
                    return;
                }

                // 결과가 있으면 성공 응답 전송
                if (result !== undefined) {
                    const statusCode = res.statusCode || 200;
                    const responseSchema = config.response?.[statusCode];
                    this.sendSuccess(res, result, statusCode, responseSchema, config.response);
                }

            } catch (error) {
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
    }    /**
     * 간단한 핸들러 생성 (요청 검증만)
     */    static withValidation(
        requestConfig: RequestConfig,
        handler: (req: ValidatedRequest, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => void
    ) {
        return this.createHandler({ request: requestConfig }, handler);
    }

    /**
     * 완전한 핸들러 생성 (요청 검증 + 응답 필터링)
     */    static withFullValidation(
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => Promise<any> | any
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
