import { modelToOpenApi, enumToOpenApi } from '@lib/documentation/dmmfToOpenApi';
import { PrismaModelInfo } from '@lib/crudSchemaTypes';

const sampleUserModel: PrismaModelInfo = {
    name: 'User',
    fields: [
        {
            name: 'id', type: 'String', jsType: 'string',
            isOptional: false, isList: false, isId: true, isUnique: true,
            isReadOnly: false, isGenerated: true, isUpdatedAt: false,
        },
        {
            name: 'email', type: 'String', jsType: 'string',
            isOptional: false, isList: false, isId: false, isUnique: true,
            isReadOnly: false, isGenerated: false, isUpdatedAt: false,
        },
        {
            name: 'age', type: 'Int', jsType: 'number',
            isOptional: true, isList: false, isId: false, isUnique: false,
            isReadOnly: false, isGenerated: false, isUpdatedAt: false,
        },
        {
            name: 'createdAt', type: 'DateTime', jsType: 'Date',
            isOptional: false, isList: false, isId: false, isUnique: false,
            isReadOnly: false, isGenerated: false, isUpdatedAt: false,
        },
    ],
    relations: [],
    indexes: [],
    uniqueConstraints: [],
    primaryKey: { fields: ['id'] },
};

describe('dmmfToOpenApi', () => {
    describe('modelToOpenApi', () => {
        it('필드들이 OpenAPI properties 로 변환되고 required 필수 필드만 포함된다', () => {
            const schema = modelToOpenApi(sampleUserModel, new Map());
            expect(schema.type).toBe('object');
            expect(schema.properties).toHaveProperty('id');
            expect(schema.properties).toHaveProperty('email');
            expect(schema.properties).toHaveProperty('age');
            expect(schema.required).toEqual(expect.arrayContaining(['id', 'email', 'createdAt']));
            expect(schema.required).not.toContain('age');
        });

        it('Int 필드일 때 OpenAPI type=integer 로 매핑된다', () => {
            const schema = modelToOpenApi(sampleUserModel, new Map());
            expect((schema.properties.age as any).type).toEqual(['integer', 'null']);
        });

        it('DateTime 필드일 때 type=string + format=date-time 으로 매핑된다', () => {
            const schema = modelToOpenApi(sampleUserModel, new Map());
            expect(schema.properties.createdAt).toEqual({ type: 'string', format: 'date-time' });
        });

        it('isOptional 필드일 때 type 이 union (T | null) 으로 표현된다', () => {
            const schema = modelToOpenApi(sampleUserModel, new Map());
            expect((schema.properties.age as any).type).toEqual(['integer', 'null']);
        });

        it('관계 필드는 schema 의 properties 에서 제외된다', () => {
            const modelWithRel: PrismaModelInfo = {
                ...sampleUserModel,
                fields: [
                    ...sampleUserModel.fields,
                    {
                        name: 'posts', type: 'Post', jsType: 'Post',
                        isOptional: false, isList: true, isId: false, isUnique: false,
                        isReadOnly: false, isGenerated: false, isUpdatedAt: false,
                        relationName: 'UserPosts',
                    },
                ],
            };
            const schema = modelToOpenApi(modelWithRel, new Map());
            expect(schema.properties).not.toHaveProperty('posts');
        });
    });

    describe('enumToOpenApi', () => {
        it('enum 값들을 OpenAPI enum schema 로 변환한다', () => {
            const schema = enumToOpenApi('Role', ['ADMIN', 'USER', 'GUEST']);
            expect(schema).toEqual({ type: 'string', enum: ['ADMIN', 'USER', 'GUEST'] });
        });
    });
});
