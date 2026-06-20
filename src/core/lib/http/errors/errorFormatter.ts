/**
 * Prisma 에러 → JSON:API 코드/HTTP 상태 매핑.
 *
 * 과거에는 응답 포맷팅(formatError/formatSuccess)·페이지네이션 메타·상태 매핑
 * 같은 책임이 함께 있었으나, 현재 호출되는 표면은 `mapPrismaError` 하나뿐이다
 * (응답 포맷은 ErrorHandler.formatJsonApiError, 페이지네이션 메타는
 * CrudResponseFormatter 가 담당). 미사용 메서드는 제거되었다.
 */

import { ERROR_CODES } from '@lib/http/errors/errorCodes';

export class ErrorFormatter {
  /**
   * Prisma 에러를 JSON:API 응답에 사용할 { code, status } 로 매핑한다.
   * 알려지지 않은 에러는 INTERNAL_ERROR / 500 으로 fallback.
   */
  static mapPrismaError(error: Error): { code: string; status: number } {
    const errorName = error.constructor.name;
    const message = error.message;

    if (errorName === 'PrismaClientValidationError') {
      return { code: ERROR_CODES.VALIDATION_ERROR, status: 400 };
    }

    if (errorName === 'PrismaClientKnownRequestError') {
      const prismaCode = (error as any).code;

      switch (prismaCode) {
        case 'P2001':
        case 'P2015':
        case 'P2018':
        case 'P2025':
          return { code: ERROR_CODES.NOT_FOUND, status: 404 };
        case 'P2002':
          return { code: ERROR_CODES.DUPLICATE_ENTRY, status: 409 };
        case 'P2003':
        case 'P2004':
          return { code: ERROR_CODES.VALIDATION_ERROR, status: 400 };
        default:
          return { code: ERROR_CODES.DATABASE_ERROR, status: 500 };
      }
    }

    if (message.includes('Invalid UUID')) {
      return { code: ERROR_CODES.INVALID_UUID, status: 400 };
    }

    return { code: ERROR_CODES.INTERNAL_ERROR, status: 500 };
  }
}
