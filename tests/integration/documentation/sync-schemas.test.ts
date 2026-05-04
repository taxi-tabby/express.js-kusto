import { DocumentationGenerator } from '@lib/documentationGenerator';
import { PrismaSchemaAnalyzer } from '@lib/prismaSchemaAnalyzer';
import { syncSchemasFromAnalyzer, registerJsonApiErrorSchema } from '@lib/documentation';
import { snapshotEnv } from '../../_setup/env-fixture';
import { bootDbFixture, DbFixture } from '../../_setup/db-fixture';

describe('syncSchemasFromAnalyzer 통합', () => {
    let restoreEnv: () => void;
    let fixture: DbFixture;
    let analyzer: PrismaSchemaAnalyzer;

    beforeAll(async () => {
        restoreEnv = snapshotEnv();
        process.env.AUTO_DOCS = 'true';
        process.env.NODE_ENV = 'development';
        fixture = await bootDbFixture();
        analyzer = PrismaSchemaAnalyzer.getInstance(fixture.prisma, 'default');
    });

    afterAll(async () => {
        await fixture.teardown();
        restoreEnv();
    });

    beforeEach(() => {
        DocumentationGenerator.reset();
    });

    afterEach(() => {
        DocumentationGenerator.reset();
    });

    it('실제 PrismaSchemaAnalyzer 와 sync 후 components.schemas 가 채워진다', () => {
        syncSchemasFromAnalyzer(analyzer, 'default');
        registerJsonApiErrorSchema();

        const spec = DocumentationGenerator.generateOpenAPISpec();
        const schemas = spec.components?.schemas || {};

        expect(Object.keys(schemas).length).toBeGreaterThan(0);
        expect(schemas).toHaveProperty('JsonApiError');

        // test-schema.sqlite.prisma 의 모델들에 대해 3변형 등록 확인
        const models = analyzer.getAllModels();
        expect(models.length).toBeGreaterThan(0);
        for (const model of models) {
            expect(schemas).toHaveProperty(model.name);
            expect(schemas).toHaveProperty(`${model.name}Attributes`);
            expect(schemas).toHaveProperty(`${model.name}Relationships`);
        }
    });

    it('User 모델의 Resource schema 가 type/attributes/relationships 키를 가진다', () => {
        syncSchemasFromAnalyzer(analyzer, 'default');

        const spec = DocumentationGenerator.generateOpenAPISpec();
        const userSchema = spec.components?.schemas?.User as any;

        expect(userSchema).toBeDefined();
        expect(userSchema.type).toBe('object');
        expect(userSchema.properties).toHaveProperty('id');
        expect(userSchema.properties).toHaveProperty('type');
        expect(userSchema.properties).toHaveProperty('attributes');
        // User 모델은 posts, comments 관계 가짐 → relationships 등록됨
        expect(userSchema.properties).toHaveProperty('relationships');
    });

    it('UserAttributes schema 에 관계 필드는 제외되고 일반 필드만 남는다', () => {
        syncSchemasFromAnalyzer(analyzer, 'default');

        const spec = DocumentationGenerator.generateOpenAPISpec();
        const userAttrs = spec.components?.schemas?.UserAttributes as any;

        expect(userAttrs).toBeDefined();
        expect(userAttrs.type).toBe('object');
        // 관계(object kind) 필드는 제외됨
        expect(userAttrs.properties).not.toHaveProperty('posts');
        expect(userAttrs.properties).not.toHaveProperty('comments');
        // 일반 스칼라 필드는 남음
        expect(userAttrs.properties).toHaveProperty('email');
        expect(userAttrs.properties).toHaveProperty('name');
    });

    it('AUTO_DOCS off 일 때 sync 가 등록을 skip 한다', () => {
        const oldAutoDocs = process.env.AUTO_DOCS;
        process.env.AUTO_DOCS = 'false';
        try {
            syncSchemasFromAnalyzer(analyzer, 'default');
            // AUTO_DOCS 가 꺼져 있어 generateOpenAPISpec 자체가 throw
            expect(() => DocumentationGenerator.generateOpenAPISpec()).toThrow(/Documentation is not enabled/);
        } finally {
            process.env.AUTO_DOCS = oldAutoDocs;
        }
    });
});
