import { pathToCamelCaseIdentifier } from '@lib/dependencyInjector';

describe('pathToCamelCaseIdentifier', () => {
    it('단일 세그먼트 파일이 들어올 때 그대로 반환한다', () => {
        expect(pathToCamelCaseIdentifier('logger.module.ts')).toBe('logger');
    });

    it('두 세그먼트 경로 auth/jwt.module.ts 일 때 authJwt 로 변환된다', () => {
        expect(pathToCamelCaseIdentifier('auth/jwt.module.ts')).toBe('authJwt');
    });

    it('세 세그먼트 경로 auth/jwt/export.module.ts 일 때 authJwtExport 로 변환된다', () => {
        expect(pathToCamelCaseIdentifier('auth/jwt/export.module.ts')).toBe('authJwtExport');
    });

    it('middleware 확장자도 동일하게 처리된다', () => {
        expect(pathToCamelCaseIdentifier('auth/rateLimiter/default.middleware.ts'))
            .toBe('authRateLimiterDefault');
    });

    it('middleware.interface 확장자도 동일하게 처리된다', () => {
        expect(pathToCamelCaseIdentifier('auth/rateLimiter/option.middleware.interface.ts'))
            .toBe('authRateLimiterOption');
    });

    it('첫 세그먼트는 lowercase 로 시작하고 나머지는 PascalCase 로 합쳐진다', () => {
        expect(pathToCamelCaseIdentifier('FOO/bar/BAZ.module.ts')).toMatch(/^FOO/);
    });
});
