/**
 * 통합 에러 처리 시스템
 * 모든 에러 관련 로직을 중앙화하여 일관성과 유지보수성을 확보
 */

import { JsonApiError, JsonApiErrorResponse, ErrorSecurityOptions } from './crudHelpers';
import { ERROR_CODES, PRISMA_ERROR_CODES, HTTP_ERROR_CODES } from './errorCodes';

/**
 * 정규화된 에러 인터페이스
 */
export interface NormalizedError {
  message: string;
  name?: string;
  code?: string;
  stack?: string | string[];
  meta?: any;
  parameter?: string;
  header?: string;
  method?: string;
  originalError?: any;
}

/**
 * 에러 응답 형식 열거형
 */
export enum ErrorResponseFormat {
  CRUD = 'crud',
  JSON_API = 'jsonapi',
  EXPRESS = 'express'
}

/**
 * 통합 에러 처리 클래스
 */
export class ErrorHandler {
  
  /**
   * 메인 에러 처리 메서드 - 모든 에러 처리의 진입점
   */
  static handleError(
    error: Error | unknown,
    options: {
      format: ErrorResponseFormat;
      context?: {
        operation?: string;
        path?: string;
        code?: string;
        status?: number;
        title?: string;
        method?: string;
        source?: {
          pointer?: string;
          parameter?: string;
          header?: string;
        };
      };
      security?: ErrorSecurityOptions;
    }
  ): any {
    // 1. 에러 정규화
    const normalizedError = this.normalizeError(error);
    
    // 2. 보안 처리 적용
    const sanitizedError = this.applySecurity(normalizedError, options.security);
    
    // 3. 형식에 따른 응답 생성
    switch (options.format) {
      case ErrorResponseFormat.CRUD:
        return this.formatCrudError(sanitizedError, options.context);
      
      case ErrorResponseFormat.JSON_API:
        return this.formatJsonApiError(sanitizedError, options.context);
      
      case ErrorResponseFormat.EXPRESS:
        return this.formatExpressError(sanitizedError, options.context);
      
      default:
        return this.formatGenericError(sanitizedError, options.context);
    }
  }

  /**
   * 에러 객체 정규화 (모든 에러 타입을 일관된 형태로 변환)
   */
  static normalizeError(error: Error | unknown): NormalizedError {
    // Error 객체인지 확인
    if (this.isErrorLike(error)) {
      return {
        message: error.message || 'An error occurred',
        name: error.name,
        code: (error as any).code,
        stack: error.stack,
        meta: (error as any).meta,
        parameter: (error as any).parameter,
        header: (error as any).header,
        method: (error as any).method,
        originalError: error
      };
    }

    // 문자열인 경우
    if (typeof error === 'string') {
      return {
        message: error,
        name: 'StringError',
        originalError: error
      };
    }

    // 객체이지만 Error가 아닌 경우
    if (typeof error === 'object' && error !== null) {
      const errorObj = error as Record<string, any>;
      return {
        message: errorObj.message || errorObj.msg || 'An error occurred',
        name: errorObj.name || 'UnknownError',
        code: errorObj.code,
        stack: errorObj.stack,
        meta: errorObj.meta,
        parameter: errorObj.parameter,
        header: errorObj.header,
        method: errorObj.method,
        originalError: error
      };
    }

    // 기타 모든 경우
    return {
      message: String(error) || 'An unknown error occurred',
      name: 'UnknownError',
      originalError: error
    };
  }

  /**
   * Error 객체 또는 Error-like 객체인지 확인하는 type guard
   */
  private static isErrorLike(error: unknown): error is Error {
    return error instanceof Error || 
           (typeof error === 'object' && 
            error !== null && 
            'message' in error &&
            typeof (error as any).message === 'string');
  }

  /**
   * 보안 처리 적용
   */
  static applySecurity(
    normalizedError: NormalizedError, 
    securityOptions?: ErrorSecurityOptions
  ): NormalizedError {
    const isDevelopment = securityOptions?.isDevelopment ?? (process.env.NODE_ENV === 'development');
    const shouldSanitize = securityOptions?.sanitizeDetails ?? !isDevelopment;
    const maxLength = securityOptions?.maxDetailLength ?? 500;

    if (!shouldSanitize) {
      // 개발 모드에서도 민감한 정보만 제거
      return {
        ...normalizedError,
        message: this.sanitizeSensitiveInfoOnly(normalizedError.message),
        stack: typeof normalizedError.stack === 'string' 
          ? this.sanitizeStackTrace(normalizedError.stack, isDevelopment) 
          : normalizedError.stack
      };
    }

    // 프로덕션 모드 또는 완전 보안 모드
    return {
      ...normalizedError,
      message: this.truncateMessage(this.sanitizeMessage(normalizedError.message), maxLength),
      stack: undefined, // 프로덕션에서는 스택 트레이스 완전 제거
      meta: this.sanitizeDetails(normalizedError.meta),
      code: normalizedError.code ? this.mapErrorCode(normalizedError.code) : undefined
    };
  }

  /**
   * 메시지 보안 처리 (구조적 접근법)
   */
  private static sanitizeMessage(message: string): string {
    // 1. 라이브러리별 에러 처리기 적용
    let sanitized = this.applyLibrarySpecificSanitizers(message);
    
    // 2. 일반적인 민감한 정보 제거
    sanitized = this.removeSensitiveInformation(sanitized);
    
    return sanitized;
  }

  /**
   * 라이브러리별 에러 처리기 적용
   */
  private static applyLibrarySpecificSanitizers(message: string): string {
    // Prisma만 사용하므로 Prisma 에러 처리만 적용
    return this.sanitizePrismaErrors(message);
  }

  /**
   * Prisma 에러 처리
   */
  private static sanitizePrismaErrors(message: string): string {
    if (!message.includes('Prisma') && !message.includes('prisma')) {
      return message;
    }

    const prismaErrorMappings = new Map([
      ['PrismaClientValidationError', 'Validation error occurred'],
      ['PrismaClientKnownRequestError', 'Database operation failed'],
      ['PrismaClientUnknownRequestError', 'Database request failed'],
      ['PrismaClientRustPanicError', 'Database engine error'],
      ['PrismaClientInitializationError', 'Database connection error'],
      ['Invalid.*invocation', 'Invalid request parameters'],
      ['Argument `[^`]+` is missing', 'Required parameter is missing'],
      ['Unknown argument `[^`]+`', 'Invalid parameter provided'],
      ['Unique constraint failed on the fields: \\(`[^`]+`\\)', 'Duplicate entry detected'],
      ['Foreign key constraint failed', 'Related record not found'],
      ['Record to (update|delete) does not exist', 'Record not found'],
      ['Database connection string is invalid', 'Database configuration error'],
      ['Query interpretation error', 'Query processing error']
    ]);

    let sanitized = message;
    for (const [pattern, replacement] of prismaErrorMappings) {
      const regex = new RegExp(pattern, 'gi');
      sanitized = sanitized.replace(regex, replacement);
    }

    return sanitized;
  }

  /**
   * Prisma 에러 코드 매핑
   */
  private static removeSensitiveInformation(message: string): string {
    const sensitivePatternCategories = {
      connectionStrings: [
        /postgres:\/\/[^\s]+/gi,
        /mysql:\/\/[^\s]+/gi,
        /mongodb:\/\/[^\s]+/gi,
        /sqlite:[^\s]+/gi,
        /mssql:\/\/[^\s]+/gi,
        /oracle:\/\/[^\s]+/gi
      ],
      credentials: [
        /password=[^\s&]+/gi,
        /pwd=[^\s&]+/gi,
        /token=[^\s&]+/gi,
        /api[_-]?key=[^\s&]+/gi,
        /secret=[^\s&]+/gi,
        /bearer\s+[^\s]+/gi,
        /authorization:\s*[^\s]+/gi
      ],
      filePaths: [
        /\/[a-zA-Z]:[^\s]*\.(db|sqlite|mdb)/gi,
        /\/home\/[^\s]*/gi,
        /\/Users\/[^\s]*/gi,
        /C:\\Users\\[^\s]*/gi,
        /\/var\/lib\/[^\s]*/gi,
        /\/opt\/[^\s]*/gi
      ],
      stackTrace: process.env.NODE_ENV === 'production' ? [
        /at .+:\d+:\d+/gi,
        /\s+at\s+[^\n]+/gi,
        /\(\/.+:\d+:\d+\)/gi
      ] : [],
      networkInfo: [
        /\b(?:\d{1,3}\.){3}\d{1,3}:\d+\b/gi,
        /localhost:\d+/gi,
        /127\.0\.0\.1:\d+/gi
      ]
    };

    let sanitized = message;
    
    Object.entries(sensitivePatternCategories).forEach(([category, patterns]) => {
      patterns.forEach(pattern => {
        sanitized = sanitized.replace(pattern, `[${category.toUpperCase()}_REDACTED]`);
      });
    });

    return sanitized;
  }

  /**
   * 개발 모드용 민감한 정보만 제거
   */
  private static sanitizeSensitiveInfoOnly(message: string): string {
    const sensitivePatterns = [
      /password=[^\s&]+/gi,
      /token=[^\s&]+/gi,
      /api[_-]?key=[^\s&]+/gi,
      /secret=[^\s&]+/gi,
      /bearer\s+[^\s]+/gi,
      /authorization:\s*[^\s]+/gi
    ];

    let sanitized = message;
    for (const pattern of sensitivePatterns) {
      sanitized = sanitized.replace(pattern, '[DEV_REDACTED]');
    }

    return sanitized;
  }

  /**
   * 스택 트레이스 보안 처리
   */
  private static sanitizeStackTrace(stack: string, isDevelopment: boolean = false): string[] {
    if (!stack) return [];

    const lines = stack.split('\n')
      .slice(0, isDevelopment ? 10 : 5)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (!isDevelopment) {
      // 프로덕션에서는 파일 경로 정보 제거
      return lines.map(line => {
        return line.replace(/\/Users\/[^\/]+/g, '/Users/[USER]')
                  .replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\[USER]')
                  .replace(/\/home\/[^\/]+/g, '/home/[USER]')
                  .replace(/at\s+.*\(/g, 'at [FUNCTION](')
                  .replace(/:\d+:\d+/g, ':[LINE]:[COL]');
      });
    }

    // 개발 모드에서는 사용자 경로만 마스킹
    return lines.map(line => {
      return line.replace(/\/Users\/[^\/]+/g, '/Users/[USER]')
                .replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\[USER]')
                .replace(/\/home\/[^\/]+/g, '/home/[USER]');
    });
  }

  /**
   * 에러 코드 매핑
   */
  private static mapErrorCode(code: string): string {
    // Prisma만 사용하므로 Prisma 에러 코드 매핑만 적용
    const mapped = this.mapPrismaErrorCodes(code);
    if (mapped !== code) {
      return mapped;
    }

    const generic = this.mapGenericErrorCodes(code);
    if (generic !== code) {
      return generic;
    }

    return ERROR_CODES.INTERNAL_ERROR;
  }

  /**
   * Prisma 에러 코드 매핑
   */
  private static mapPrismaErrorCodes(code: string): string {
    const prismaCodeMap = new Map([
      ['P2001', PRISMA_ERROR_CODES.RECORD_NOT_FOUND],
      ['P2002', PRISMA_ERROR_CODES.UNIQUE_CONSTRAINT_VIOLATION],
      ['P2003', PRISMA_ERROR_CODES.FOREIGN_KEY_CONSTRAINT_VIOLATION],
      ['P2004', PRISMA_ERROR_CODES.CONSTRAINT_VIOLATION],
      ['P2005', PRISMA_ERROR_CODES.INVALID_VALUE],
      ['P2006', PRISMA_ERROR_CODES.INVALID_VALUE],
      ['P2007', PRISMA_ERROR_CODES.DATA_VALIDATION_ERROR],
      ['P2008', PRISMA_ERROR_CODES.QUERY_PARSING_ERROR],
      ['P2009', PRISMA_ERROR_CODES.QUERY_VALIDATION_ERROR],
      ['P2010', PRISMA_ERROR_CODES.RAW_QUERY_ERROR],
      ['P2011', PRISMA_ERROR_CODES.NULL_CONSTRAINT_VIOLATION],
      ['P2012', ERROR_CODES.MISSING_REQUIRED_FIELD],
      ['P2013', ERROR_CODES.MISSING_REQUIRED_FIELD],
      ['P2014', PRISMA_ERROR_CODES.RELATIONSHIP_VIOLATION],
      ['P2015', ERROR_CODES.RELATIONSHIP_NOT_FOUND],
      ['P2016', PRISMA_ERROR_CODES.QUERY_INTERPRETATION_ERROR],
      ['P2017', PRISMA_ERROR_CODES.RELATIONSHIP_VIOLATION],
      ['P2018', ERROR_CODES.RELATIONSHIP_NOT_FOUND],
      ['P2019', ERROR_CODES.VALIDATION_ERROR],
      ['P2020', PRISMA_ERROR_CODES.VALUE_OUT_OF_RANGE],
      ['P2021', PRISMA_ERROR_CODES.TABLE_NOT_FOUND],
      ['P2022', PRISMA_ERROR_CODES.COLUMN_NOT_FOUND],
      ['P2023', PRISMA_ERROR_CODES.INCONSISTENT_COLUMN_DATA],
      ['P2024', PRISMA_ERROR_CODES.CONNECTION_TIMEOUT],
      ['P2025', ERROR_CODES.OPERATION_FAILED],
      ['P2026', ERROR_CODES.OPERATION_NOT_ALLOWED],
      ['P2027', ERROR_CODES.OPERATION_FAILED],
      ['P2028', PRISMA_ERROR_CODES.TRANSACTION_API_ERROR],
      ['P2030', ERROR_CODES.OPERATION_NOT_ALLOWED],
      ['P2031', PRISMA_ERROR_CODES.CONNECTION_ERROR],
      ['P2033', PRISMA_ERROR_CODES.VALUE_OUT_OF_RANGE],
      ['P2034', PRISMA_ERROR_CODES.TRANSACTION_CONFLICT]
    ]);

    return prismaCodeMap.get(code) || code;
  }

  /**
   * 일반적인 에러 코드 매핑
   */
  private static mapGenericErrorCodes(code: string): string {
    const genericCodeMap = new Map([
      ['400', HTTP_ERROR_CODES.BAD_REQUEST],
      ['401', HTTP_ERROR_CODES.UNAUTHORIZED],
      ['403', HTTP_ERROR_CODES.FORBIDDEN],
      ['404', HTTP_ERROR_CODES.NOT_FOUND],
      ['409', HTTP_ERROR_CODES.CONFLICT],
      ['422', HTTP_ERROR_CODES.UNPROCESSABLE_ENTITY],
      ['500', HTTP_ERROR_CODES.INTERNAL_SERVER_ERROR],
      ['502', HTTP_ERROR_CODES.BAD_GATEWAY],
      ['503', HTTP_ERROR_CODES.SERVICE_UNAVAILABLE],
      ['504', HTTP_ERROR_CODES.GATEWAY_TIMEOUT]
    ]);

    return genericCodeMap.get(code) || code;
  }

  /**
   * 에러 상세 정보 보안 처리
   */
  private static sanitizeDetails(details: any): any {
    if (!details || typeof details !== 'object') {
      return null;
    }

    const allowedFields = [
      'type', 'field', 'constraint', 'table', 'model', 
      'operation', 'count', 'affected', 'target'
    ];

    const sanitized: any = {};
    for (const field of allowedFields) {
      if (details[field] !== undefined) {
        sanitized[field] = details[field];
      }
    }

    return Object.keys(sanitized).length > 0 ? sanitized : null;
  }

  /**
   * 메시지 길이 제한
   */
  private static truncateMessage(message: string, maxLength: number): string {
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength - 3) + '...';
  }

  /**
   * CRUD 형식 에러 응답 생성
   */
  private static formatCrudError(
    normalizedError: NormalizedError, 
    context?: any
  ): any {
    return {
      error: {
        message: normalizedError.message,
        code: normalizedError.code || 'UNKNOWN_ERROR',
        details: normalizedError.meta
      },
      metadata: {
        operation: context?.operation || 'unknown',
        timestamp: new Date().toISOString(),
        affectedCount: 0
      },
      success: false
    };
  }

  /**
   * JSON:API 형식 에러 응답 생성
   */
  private static formatJsonApiError(
    normalizedError: NormalizedError, 
    context?: any
  ): JsonApiErrorResponse {
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const status = context?.status || 500;
    const code = context?.code || 'INTERNAL_ERROR';

    return {
      jsonapi: {
        version: "1.1",
        meta: {
          implementation: "express.js-kusto v2.0"
        }
      },
      errors: [
        {
          id: errorId,
          links: {
            about: ``,
            type: ``
          },
          status: String(status),
          code: code,
          title: context?.title || this.getErrorTitle(status),
          detail: normalizedError.message,
          source: context?.source,
          meta: {
            timestamp: new Date().toISOString(),
            ...(normalizedError.code && { errorCode: normalizedError.code }),
            ...(normalizedError.name && { errorType: normalizedError.name }),
            ...(normalizedError.stack && { stack: normalizedError.stack }),
            ...(normalizedError.meta && { originalError: normalizedError.meta }),
            environment: process.env.NODE_ENV || 'unknown'
          }
        }
      ],
      meta: {
        timestamp: new Date().toISOString(),
        errorCount: 1,
        requestInfo: {
          path: context?.path || 'unknown',
          method: context?.method || normalizedError.method || 'UNKNOWN'
        }
      },
      links: {
        self: context?.path || ''
      }
    };
  }

  /**
   * Express 형식 에러 응답 생성
   */
  private static formatExpressError(
    normalizedError: NormalizedError, 
    context?: any
  ): any {
    return {
      error: normalizedError.message,
      code: normalizedError.code || 'UNKNOWN_ERROR',
      status: context?.status || 500,
      timestamp: new Date().toISOString(),
      path: context?.path || 'unknown',
      ...(normalizedError.stack && { stack: normalizedError.stack })
    };
  }

  /**
   * 일반 형식 에러 응답 생성
   */
  private static formatGenericError(
    normalizedError: NormalizedError, 
    context?: any
  ): any {
    return {
      message: normalizedError.message,
      error: true,
      timestamp: new Date().toISOString(),
      ...(normalizedError.code && { code: normalizedError.code }),
      ...(normalizedError.name && { type: normalizedError.name }),
      ...(context && { context })
    };
  }

  /**
   * HTTP 상태 코드에 따른 에러 제목 생성
   */
  private static getErrorTitle(status: number): string {
    const titleMap: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout'
    };

    return titleMap[status] || 'Error';
  }
}
