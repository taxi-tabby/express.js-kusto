import {
    ERROR_CODES,
    ERROR_STATUS_MAP,
    getHttpStatusForErrorCode,
    JSON_API_ERROR_CODES,
    CRUD_ERROR_CODES,
    PRISMA_ERROR_CODES,
    HTTP_ERROR_CODES,
    MIDDLEWARE_ERROR_CODES,
    BUSINESS_ERROR_CODES,
} from '@lib/http/errors/errorCodes';

describe('ERROR_CODES 무결성', () => {
    it('ERROR_CODES 가 모든 카테고리의 키를 포함할 때 누락이 없다', () => {
        const all = {
            ...JSON_API_ERROR_CODES,
            ...CRUD_ERROR_CODES,
            ...PRISMA_ERROR_CODES,
            ...HTTP_ERROR_CODES,
            ...MIDDLEWARE_ERROR_CODES,
            ...BUSINESS_ERROR_CODES,
        };
        for (const key of Object.keys(all)) {
            expect((ERROR_CODES as any)[key]).toBe((all as any)[key]);
        }
    });

    it('include 정책 에러 코드 3종 이 400 으로 매핑될 때 그 매핑이 ERROR_STATUS_MAP 에 존재한다', () => {
        expect(ERROR_STATUS_MAP[ERROR_CODES.INCLUDE_LIMIT_EXCEEDED]).toBe(400);
        expect(ERROR_STATUS_MAP[ERROR_CODES.INCLUDE_DEPTH_EXCEEDED]).toBe(400);
        expect(ERROR_STATUS_MAP[ERROR_CODES.INCLUDE_NOT_ALLOWED]).toBe(400);
    });

    it('RESOURCE_DELETED 가 410 으로 매핑된다', () => {
        expect(ERROR_STATUS_MAP[ERROR_CODES.RESOURCE_DELETED]).toBe(410);
    });

    it('알 수 없는 코드를 getHttpStatusForErrorCode 에 넘길 때 500 을 반환한다', () => {
        expect(getHttpStatusForErrorCode('NON_EXISTENT_CODE_XYZ')).toBe(500);
    });
});
