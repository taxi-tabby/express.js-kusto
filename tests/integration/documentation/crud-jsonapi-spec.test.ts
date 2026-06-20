// tests/integration/documentation/crud-jsonapi-spec.test.ts
import SwaggerParser from '@apidevtools/swagger-parser';
import { DocumentationGenerator } from '@lib/devtools/documentation/documentationGenerator';
import { snapshotEnv } from '@tests/_setup/env-fixture';

describe('CRUD 가 등록한 OpenAPI spec 의 표준 준수', () => {
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

    it('CRUD 스타일 라우트 6개를 등록하고 spec 을 빌드했을 때 swagger-parser validate 를 통과한다', async () => {
        DocumentationGenerator.registerRoute({
            method: 'GET', path: '/users', contentType: 'jsonapi',
            parameters: { query: { 'page[number]': { type: 'number', required: false } } },
            responses: { 200: { data: { type: 'array', required: true } } },
        });
        DocumentationGenerator.registerRoute({
            method: 'GET', path: '/users/:id', contentType: 'jsonapi',
            parameters: { params: { id: { type: 'string', required: true } } },
            responses: { 200: { data: { type: 'object', required: true } } },
        });
        DocumentationGenerator.registerRoute({
            method: 'POST', path: '/users', contentType: 'jsonapi',
            parameters: { body: { name: { type: 'string', required: true } } },
            responses: { 201: { data: { type: 'object', required: true } } },
        });
        DocumentationGenerator.registerRoute({
            method: 'PUT', path: '/users/:id', contentType: 'jsonapi',
            parameters: { params: { id: { type: 'string', required: true } } },
            responses: { 200: { data: { type: 'object', required: true } } },
        });
        DocumentationGenerator.registerRoute({
            method: 'PATCH', path: '/users/:id', contentType: 'jsonapi',
            parameters: { params: { id: { type: 'string', required: true } } },
            responses: { 200: { data: { type: 'object', required: true } } },
        });
        DocumentationGenerator.registerRoute({
            method: 'DELETE', path: '/users/:id', contentType: 'jsonapi',
            parameters: { params: { id: { type: 'string', required: true } } },
            responses: { 204: {} },
        });

        const spec = DocumentationGenerator.generateOpenAPISpec();

        // swagger-parser 의 validate 는 비동기. spec 이 OpenAPI 3.1 표준 위반 시 throw.
        await expect(SwaggerParser.validate(spec as any)).resolves.toBeDefined();
    });

    it('생성된 spec 의 paths 키가 OpenAPI 표준 {param} 형식이다', () => {
        DocumentationGenerator.registerRoute({
            method: 'GET',
            path: '/users/:userId/posts/:postId',
            contentType: 'jsonapi',
            parameters: { params: { userId: { type: 'string', required: true }, postId: { type: 'string', required: true } } },
            responses: { 200: { data: { type: 'object', required: true } } },
        });

        const spec = DocumentationGenerator.generateOpenAPISpec();

        expect(spec.paths['/users/{userId}/posts/{postId}']).toBeDefined();
        expect(spec.paths['/users/:userId/posts/:postId']).toBeUndefined();
    });

    it('CRUD 라우트의 응답·요청 content key 가 application/vnd.api+json 이다', () => {
        DocumentationGenerator.registerRoute({
            method: 'POST',
            path: '/users',
            contentType: 'jsonapi',
            parameters: { body: { name: { type: 'string', required: true } } },
            responses: { 201: { data: { type: 'object', required: true } } },
        });

        const spec = DocumentationGenerator.generateOpenAPISpec();
        const op = spec.paths['/users']?.post;

        // Note: Jest 의 toHaveProperty 는 dotted key 를 path 로 해석함. 직접 접근 사용.
        expect(op?.requestBody?.content?.['application/vnd.api+json']).toBeDefined();
        expect(op?.responses?.['201']?.content?.['application/vnd.api+json']).toBeDefined();
    });

    it('contentType 미지정 라우트는 application/json 을 사용한다', () => {
        DocumentationGenerator.registerRoute({
            method: 'GET',
            path: '/health',
            responses: { 200: { ok: { type: 'boolean', required: true } } },
        });

        const spec = DocumentationGenerator.generateOpenAPISpec();
        const op = spec.paths['/health']?.get;

        expect(op?.responses?.['200']?.content?.['application/json']).toBeDefined();
        expect(op?.responses?.['200']?.content?.['application/vnd.api+json']).toBeUndefined();
    });

    it('OpenAPI 버전이 3.1.0 이다', () => {
        const spec = DocumentationGenerator.generateOpenAPISpec();
        expect(spec.openapi).toBe('3.1.0');
    });

    it('CRUD setup 메서드의 등록 후 spec 의 paths 에 $ref 가 등장한다', async () => {
        // Sync 가 component schemas 를 채움 시뮬레이션
        DocumentationGenerator.registerSchema('User', {
            type: 'object',
            properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                attributes: { type: 'object' },
            },
        });
        DocumentationGenerator.registerSchema('UserAttributes', {
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
        });
        DocumentationGenerator.registerSchema('UserRelationships', {
            type: 'object',
            properties: {},
        });
        DocumentationGenerator.registerSchema('JsonApiError', {
            type: 'object',
            required: ['errors'],
            properties: { errors: { type: 'array' } },
        });

        // CRUD setup 메서드의 결과를 직접 시뮬레이션 (jsonApiBody/Response/ErrorResponse 사용)
        DocumentationGenerator.registerRoute({
            method: 'POST',
            path: '/users',
            contentType: 'jsonapi',
            parameters: {
                body: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                        data: {
                            type: 'object',
                            required: ['type', 'attributes'],
                            properties: {
                                type: { type: 'string' },
                                id: { type: 'string' },
                                attributes: { $ref: '#/components/schemas/UserAttributes' },
                                relationships: { $ref: '#/components/schemas/UserRelationships' },
                            },
                        },
                    },
                } as any,
            },
            responses: {
                201: {
                    type: 'object',
                    required: ['data'],
                    properties: { data: { $ref: '#/components/schemas/User' } },
                } as any,
                422: {
                    type: 'object',
                    required: ['errors'],
                    properties: { errors: { $ref: '#/components/schemas/JsonApiError' } },
                } as any,
            },
        });

        const spec = DocumentationGenerator.generateOpenAPISpec();
        const op = spec.paths['/users']?.post;

        // body 의 attributes 가 $ref 보존
        const reqSchema = op?.requestBody?.content?.['application/vnd.api+json']?.schema as any;
        expect(reqSchema.properties.data.properties.attributes).toEqual({
            $ref: '#/components/schemas/UserAttributes',
        });

        // 201 응답의 data 가 $ref 보존
        const resSchema = op?.responses?.['201']?.content?.['application/vnd.api+json']?.schema as any;
        expect(resSchema.properties.data).toEqual({ $ref: '#/components/schemas/User' });

        // 422 응답의 errors 가 JsonApiError 로 $ref 보존
        const errSchema = op?.responses?.['422']?.content?.['application/vnd.api+json']?.schema as any;
        expect(errSchema.properties.errors).toEqual({ $ref: '#/components/schemas/JsonApiError' });

        // swagger-parser validate 가 components.schemas 가 등록된 상태에서도 통과
        await expect(SwaggerParser.validate(spec as any)).resolves.toBeDefined();
    });
});
