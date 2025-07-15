/**
 * 에러 응답 포맷터
 * 개발/프로덕션 환경에 따른 에러 응답 처리
 */

import { EnvironmentLoader } from './environmentLoader';

export interface ErrorResponse {
  error: {
    message: string;
    code: string;
    status: number;
    timestamp?: string;
    path?: string;
    details?: any;
    stack?: string;
  };
  success: false;
}

export interface ApiResponse<T = any> {
  data?: T;
  error?: ErrorResponse['error'];
  success: boolean;
  metadata?: {
    total?: number;
    page?: number;
    limit?: number;
    hasNext?: boolean;
    hasPrev?: boolean;
  };
}

export class ErrorFormatter {
  /**
   * 표준 에러 응답 생성
   */
  static formatError(
    error: Error,
    code: string = 'INTERNAL_ERROR',
    status: number = 500,
    path?: string
  ): ErrorResponse {
    if (EnvironmentLoader.isProduction()) {
      // 프로덕션: 최소한의 안전한 정보만
      return {
        error: {
          message: this.sanitizeErrorMessage(error.message, code),
          code,
          status,
          timestamp: new Date().toISOString()
        },
        success: false
      };
    } else {
      // 개발 환경: 상세 정보 포함
      const baseError = {
        message: error.message,
        code,
        status,
        timestamp: new Date().toISOString(),
        path
      };

      return {
        error: {
          ...baseError,
          details: this.extractErrorDetails(error),
          stack: error.stack
        },
        success: false
      };
    }
  }

  /**
   * 성공 응답 생성
   */
  static formatSuccess<T>(
    data: T,
    metadata?: ApiResponse<T>['metadata']
  ): ApiResponse<T> {
    return {
      data,
      success: true,
      ...(metadata && { metadata })
    };
  }

  /**
   * 페이징 메타데이터 생성
   */
  static createPaginationMeta(
    total: number,
    page: number,
    limit: number
  ): ApiResponse['metadata'] {
    const totalPages = Math.ceil(total / limit);
    
    return {
      total,
      page,
      limit,
      hasNext: page < totalPages,
      hasPrev: page > 1
    };
  }

  /**
   * 에러 세부사항 추출 (개발 환경에서만 사용)
   */
  private static extractErrorDetails(error: Error): any {
    // 프로덕션 환경에서는 절대로 세부사항을 노출하지 않음
    if (EnvironmentLoader.isProduction()) {
      return null;
    }

    const details: any = {};

    // Prisma 에러 처리 (개발 환경에서만)
    if (error.constructor.name === 'PrismaClientValidationError') {
      details.type = 'VALIDATION_ERROR';
      
      // 필드 관련 에러 파싱 (개발용)
      const message = error.message;
      if (message.includes('Unknown field')) {
        const fieldMatch = message.match(/Unknown field `([^`]+)`/);
        if (fieldMatch) {
          details.invalidField = fieldMatch[1];
        }
      }
      
      if (message.includes('Missing required argument')) {
        const argMatch = message.match(/Missing required argument `([^`]+)`/);
        if (argMatch) {
          details.missingField = argMatch[1];
        }
      }
      
      // 개발 환경에서만 버전 정보 제공
      details.prismaVersion = (error as any).clientVersion || 'unknown';
    }

    // UUID 파싱 에러 (개발용)
    if (error.message.includes('Invalid UUID')) {
      details.type = 'INVALID_UUID';
      details.expectedFormat = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
    }

    return Object.keys(details).length > 0 ? details : null;
  }

  /**
   * 프로덕션용 에러 메시지 정제
   */
  private static sanitizeErrorMessage(message: string, code: string): string {
    // 프로덕션에서는 절대로 원본 에러 메시지를 노출하지 않음
    const sanitizedMessages: Record<string, string> = {
      'VALIDATION_ERROR': '입력 데이터가 올바르지 않습니다.',
      'NOT_FOUND': '요청한 리소스를 찾을 수 없습니다.',
      'INVALID_UUID': '잘못된 식별자 형식입니다.',
      'DATABASE_ERROR': '데이터베이스 처리 중 오류가 발생했습니다.',
      'UNAUTHORIZED': '인증이 필요합니다.',
      'FORBIDDEN': '접근 권한이 없습니다.',
      'DUPLICATE_ENTRY': '중복된 데이터입니다.',
      'INTERNAL_ERROR': '서버 내부 오류가 발생했습니다.',
      'SHOW_ERROR': '데이터 조회 중 오류가 발생했습니다.',
      'INDEX_ERROR': '목록 조회 중 오류가 발생했습니다.',
      'CREATE_ERROR': '데이터 생성 중 오류가 발생했습니다.',
      'UPDATE_ERROR': '데이터 수정 중 오류가 발생했습니다.',
      'DESTROY_ERROR': '데이터 삭제 중 오류가 발생했습니다.'
    };

    // 프로덕션에서는 항상 안전한 메시지만 반환
    return sanitizedMessages[code] || '요청을 처리할 수 없습니다.';
  }

  /**
   * HTTP 상태 코드 매핑
   */
  static getHttpStatus(code: string): number {
    const statusMap: Record<string, number> = {
      'VALIDATION_ERROR': 400,
      'INVALID_UUID': 400,
      'NOT_FOUND': 404,
      'UNAUTHORIZED': 401,
      'FORBIDDEN': 403,
      'DUPLICATE_ENTRY': 409,
      'DATABASE_ERROR': 500,
      'INTERNAL_ERROR': 500
    };

    return statusMap[code] || 500;
  }

  /**
   * Prisma 에러 코드 매핑
   */
  static mapPrismaError(error: Error): { code: string; status: number } {
    const errorName = error.constructor.name;
    const message = error.message;

    if (errorName === 'PrismaClientValidationError') {
      return { code: 'VALIDATION_ERROR', status: 400 };
    }
    
    if (errorName === 'PrismaClientKnownRequestError') {
      const prismaCode = (error as any).code;
      
      switch (prismaCode) {
        case 'P2001':
        case 'P2015':
        case 'P2018':
        case 'P2025':
          return { code: 'NOT_FOUND', status: 404 };
        case 'P2002':
          return { code: 'DUPLICATE_ENTRY', status: 409 };
        case 'P2003':
        case 'P2004':
          return { code: 'VALIDATION_ERROR', status: 400 };
        default:
          return { code: 'DATABASE_ERROR', status: 500 };
      }
    }

    if (message.includes('Invalid UUID')) {
      return { code: 'INVALID_UUID', status: 400 };
    }

    return { code: 'INTERNAL_ERROR', status: 500 };
  }
}
