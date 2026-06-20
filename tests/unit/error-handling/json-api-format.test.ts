import { ErrorHandler, ErrorResponseFormat } from '@lib/http/errors/errorHandler';
import { ERROR_CODES } from '@lib/http/errors/errorCodes';

function makeError(message = 'test error') {
    return new Error(message);
}

function format(err: Error, ctx: any = {}) {
    return ErrorHandler.handleError(err, {
        format: ErrorResponseFormat.JSON_API,
        context: ctx
    });
}

describe('ErrorHandler.formatJsonApiError 구조', () => {
    it('응답에 jsonapi.version === 1.1 이 포함된다', () => {
        const r = format(makeError(), { code: ERROR_CODES.VALIDATION_ERROR, status: 400 });
        expect((r as any).jsonapi?.version).toBe('1.1');
    });

    it('응답에 errors 가 배열이고 항목이 정확히 1개일 때 errorCount 가 1 이다', () => {
        const r = format(makeError(), { code: ERROR_CODES.VALIDATION_ERROR, status: 400 });
        expect(Array.isArray((r as any).errors)).toBe(true);
        expect((r as any).errors.length).toBe(1);
        expect((r as any).meta?.errorCount).toBe(1);
    });

    it('errors[0].status 가 숫자가 아닌 문자열일 때 JSON:API 스펙을 따른다', () => {
        const r = format(makeError(), { code: ERROR_CODES.VALIDATION_ERROR, status: 400 });
        expect(typeof (r as any).errors[0].status).toBe('string');
        expect((r as any).errors[0].status).toBe('400');
    });

    it('code 인자가 들어올 때 errors[0].code 가 그 값과 같다', () => {
        const r = format(makeError(), { code: ERROR_CODES.NOT_FOUND, status: 404 });
        expect((r as any).errors[0].code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('meta.requestInfo 에 path 와 method 가 포함된다', () => {
        const r = format(makeError(), {
            code: ERROR_CODES.VALIDATION_ERROR,
            status: 400,
            path: '/users/abc',
            method: 'GET'
        });
        expect((r as any).meta?.requestInfo).toMatchObject({
            path: '/users/abc',
            method: 'GET'
        });
    });

    it('title 이 명시되지 않을 때 status 별 기본 title 을 사용한다', () => {
        const r = format(makeError(), { code: ERROR_CODES.VALIDATION_ERROR, status: 400 });
        expect((r as any).errors[0].title).toBeTruthy();
        expect(typeof (r as any).errors[0].title).toBe('string');
    });
});
