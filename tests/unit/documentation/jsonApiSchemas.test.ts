import {
    jsonApiResource,
    jsonApiAttributes,
    jsonApiRelationships,
    jsonApiErrorObject,
} from '@lib/documentation/jsonApiSchemas';
import { PrismaModelInfo } from '@lib/crudSchemaTypes';

const sampleModel: PrismaModelInfo = {
    name: 'Post',
    fields: [
        { name: 'id', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: true, isUnique: true, isReadOnly: false, isGenerated: true, isUpdatedAt: false },
        { name: 'title', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
        { name: 'body', type: 'String', jsType: 'string', isOptional: true, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
        { name: 'author', type: 'User', jsType: 'User', isOptional: false, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false, relationName: 'PostAuthor', relationFromFields: ['authorId'], relationToFields: ['id'] },
    ],
    relations: [{ name: 'author', type: 'many-to-one', model: 'User', fields: ['authorId'], references: ['id'] }],
    indexes: [],
    uniqueConstraints: [],
    primaryKey: { fields: ['id'] },
};

describe('jsonApiSchemas', () => {
    describe('jsonApiAttributes', () => {
        it('관계 필드와 id 를 제외한 attributes schema 를 만든다', () => {
            const schema = jsonApiAttributes(sampleModel, new Map());
            expect(schema.type).toBe('object');
            expect((schema as any).properties).toHaveProperty('title');
            expect((schema as any).properties).toHaveProperty('body');
            expect((schema as any).properties).not.toHaveProperty('id');
            expect((schema as any).properties).not.toHaveProperty('author');
        });
    });

    describe('jsonApiRelationships', () => {
        it('관계만 모은 schema 를 만들고 각 관계는 JSON:API resource identifier 형식이다', () => {
            const schema = jsonApiRelationships(sampleModel);
            expect(schema.type).toBe('object');
            const props = (schema as any).properties;
            expect(props).toHaveProperty('author');
            expect(props.author.type).toBe('object');
            expect(props.author.properties.data.properties.type.type).toBe('string');
            expect(props.author.properties.data.properties.id.type).toBe('string');
        });

        it('관계가 없는 모델일 때 빈 properties 를 가진 object schema 를 반환한다', () => {
            const noRel: PrismaModelInfo = { ...sampleModel, fields: sampleModel.fields.filter(f => !f.relationName), relations: [] };
            const schema = jsonApiRelationships(noRel);
            expect((schema as any).properties).toEqual({});
        });
    });

    describe('jsonApiResource', () => {
        it('id/type/attributes/relationships 4 키를 가진 schema 를 만든다', () => {
            const schema = jsonApiResource(sampleModel, new Map());
            expect((schema as any).properties).toHaveProperty('id');
            expect((schema as any).properties).toHaveProperty('type');
            expect((schema as any).properties).toHaveProperty('attributes');
            expect((schema as any).properties).toHaveProperty('relationships');
            expect((schema as any).properties.type.const).toBe('Post');
        });
    });

    describe('jsonApiErrorObject', () => {
        it('errors 배열을 가진 object schema 를 반환하고 각 error 는 status/code/title 을 required 로 한다', () => {
            const schema = jsonApiErrorObject();
            expect((schema as any).properties.errors.type).toBe('array');
            const errItem = (schema as any).properties.errors.items;
            expect(errItem.required).toEqual(expect.arrayContaining(['status', 'code', 'title']));
        });
    });
});
