import { enumToOpenApi } from '@lib/devtools/documentation/dmmfToOpenApi';

describe('dmmfToOpenApi', () => {
    describe('enumToOpenApi', () => {
        it('enum 값들을 OpenAPI enum schema 로 변환한다', () => {
            const schema = enumToOpenApi('Role', ['ADMIN', 'USER', 'GUEST']);
            expect(schema).toEqual({ type: 'string', enum: ['ADMIN', 'USER', 'GUEST'] });
        });
    });
});
