import { ErrorFormatter } from '@lib/http/errors/errorFormatter';
import { ERROR_CODES } from '@lib/http/errors/errorCodes';

class FakeValidationErr extends Error {
    constructor() { super('Invalid prisma input'); this.name = 'PrismaClientValidationError'; }
}
class FakeKnownErr extends Error {
    code: string;
    constructor(code: string) { super(code); this.name = 'PrismaClientKnownRequestError'; this.code = code; }
}

// constructor.name 비교를 위해 prototype 조작 (mapPrismaError 가 error.constructor.name 을 검사)
Object.defineProperty(FakeValidationErr.prototype, 'constructor', {
    value: { name: 'PrismaClientValidationError' }
});
Object.defineProperty(FakeKnownErr.prototype, 'constructor', {
    value: { name: 'PrismaClientKnownRequestError' }
});

describe('ErrorFormatter.mapPrismaError', () => {
    it('PrismaClientValidationError 일 때 VALIDATION_ERROR / 400 을 반환한다', () => {
        const r = ErrorFormatter.mapPrismaError(new FakeValidationErr());
        expect(r).toEqual({ code: ERROR_CODES.VALIDATION_ERROR, status: 400 });
    });

    it('Prisma 코드 P2002 일 때 DUPLICATE_ENTRY / 409 를 반환한다', () => {
        const r = ErrorFormatter.mapPrismaError(new FakeKnownErr('P2002'));
        expect(r).toEqual({ code: ERROR_CODES.DUPLICATE_ENTRY, status: 409 });
    });

    it('Prisma 코드 P2025 일 때 NOT_FOUND / 404 를 반환한다', () => {
        const r = ErrorFormatter.mapPrismaError(new FakeKnownErr('P2025'));
        expect(r).toEqual({ code: ERROR_CODES.NOT_FOUND, status: 404 });
    });

    it('Prisma 코드 P2003 일 때 VALIDATION_ERROR / 400 을 반환한다', () => {
        const r = ErrorFormatter.mapPrismaError(new FakeKnownErr('P2003'));
        expect(r).toEqual({ code: ERROR_CODES.VALIDATION_ERROR, status: 400 });
    });

    it('알 수 없는 Prisma 코드일 때 DATABASE_ERROR 로 폴백한다', () => {
        const r = ErrorFormatter.mapPrismaError(new FakeKnownErr('P9999'));
        expect(r).toEqual({ code: ERROR_CODES.DATABASE_ERROR, status: 500 });
    });

    it('Invalid UUID 메시지가 포함된 일반 Error 일 때 INVALID_UUID / 400 을 반환한다', () => {
        const r = ErrorFormatter.mapPrismaError(new Error('Invalid UUID format'));
        expect(r).toEqual({ code: ERROR_CODES.INVALID_UUID, status: 400 });
    });
});
