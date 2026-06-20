import { syncSchemasFromAnalyzer, registerJsonApiErrorSchema } from '@lib/devtools/documentation/syncSchemas';
import { DocumentationGenerator } from '@lib/devtools/documentation/documentationGenerator';
import { PrismaModelInfo } from '@lib/devtools/schema-api/crudSchemaTypes';
import { snapshotEnv } from '@tests/_setup/env-fixture';

const sampleModel: PrismaModelInfo = {
    name: 'User',
    fields: [
        { name: 'id', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: true, isUnique: true, isReadOnly: false, isGenerated: true, isUpdatedAt: false },
        { name: 'email', type: 'String', jsType: 'string', isOptional: false, isList: false, isId: false, isUnique: true, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
        { name: 'role', type: 'Role', jsType: 'Role', isOptional: false, isList: false, isId: false, isUnique: false, isReadOnly: false, isGenerated: false, isUpdatedAt: false },
    ],
    relations: [],
    indexes: [],
    uniqueConstraints: [],
    primaryKey: { fields: ['id'] },
};

function createMockAnalyzer(models: PrismaModelInfo[], enums: Record<string, string[]> = {}) {
    return {
        getDatabaseName: () => 'default',
        getAllModels: () => models,
        getEnumValues: (name: string) => enums[name],
        isEnumType: (name: string) => name in enums,
    } as any;
}

describe('syncSchemas', () => {
    let restoreEnv: () => void;

    beforeEach(() => {
        restoreEnv = snapshotEnv();
        process.env.AUTO_DOCS = 'true';
        process.env.NODE_ENV = 'development';
        DocumentationGenerator.reset();
    });

    afterEach(() => {
        DocumentationGenerator.reset();
        restoreEnv();
    });

    describe('syncSchemasFromAnalyzer', () => {
        it('각 model 에 대해 3변형 스키마를 등록한다', () => {
            const analyzer = createMockAnalyzer([sampleModel]);
            syncSchemasFromAnalyzer(analyzer, 'default');

            const spec = DocumentationGenerator.generateOpenAPISpec();
            const schemas = spec.components?.schemas || {};
            expect(schemas).toHaveProperty('User');
            expect(schemas).toHaveProperty('UserAttributes');
            expect(schemas).toHaveProperty('UserRelationships');
        });

        it('enum 타입을 감지하고 별도 schema 로 등록한다', () => {
            const analyzer = createMockAnalyzer([sampleModel], { Role: ['ADMIN', 'USER'] });
            syncSchemasFromAnalyzer(analyzer, 'default');

            const spec = DocumentationGenerator.generateOpenAPISpec();
            const schemas = spec.components?.schemas || {};
            expect(schemas).toHaveProperty('Role');
            expect((schemas.Role as any).enum).toEqual(['ADMIN', 'USER']);
        });

        it('동일 model 이름이 두 번 등록되면 같은 키로 덮어쓴다 (충돌 없음)', () => {
            const analyzer1 = createMockAnalyzer([sampleModel]);
            const analyzer2 = createMockAnalyzer([sampleModel]);
            syncSchemasFromAnalyzer(analyzer1, 'default');
            syncSchemasFromAnalyzer(analyzer2, 'default');

            const spec = DocumentationGenerator.generateOpenAPISpec();
            expect(spec.components?.schemas?.User).toBeDefined();
        });

        it('AUTO_DOCS 가 비활성일 때 등록을 skip 한다', () => {
            process.env.AUTO_DOCS = 'false';
            const analyzer = createMockAnalyzer([sampleModel]);
            syncSchemasFromAnalyzer(analyzer, 'default');

            expect(() => DocumentationGenerator.generateOpenAPISpec()).toThrow(/Documentation is not enabled/);
        });

        it('빈 model 배열일 때 어떤 스키마도 등록하지 않는다', () => {
            const analyzer = createMockAnalyzer([]);
            syncSchemasFromAnalyzer(analyzer, 'default');

            const spec = DocumentationGenerator.generateOpenAPISpec();
            expect(Object.keys(spec.components?.schemas || {})).toEqual([]);
        });
    });

    describe('registerJsonApiErrorSchema', () => {
        it('JsonApiError 스키마를 한 번 등록한다', () => {
            registerJsonApiErrorSchema();

            const spec = DocumentationGenerator.generateOpenAPISpec();
            const schemas = spec.components?.schemas || {};
            expect(schemas).toHaveProperty('JsonApiError');
            expect((schemas.JsonApiError as any).properties.errors).toBeDefined();
        });

        it('두 번 호출해도 idempotent (같은 내용 덮어쓰기)', () => {
            registerJsonApiErrorSchema();
            registerJsonApiErrorSchema();

            const spec = DocumentationGenerator.generateOpenAPISpec();
            expect(spec.components?.schemas?.JsonApiError).toBeDefined();
        });
    });
});
