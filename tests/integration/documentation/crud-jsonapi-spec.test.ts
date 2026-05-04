// tests/integration/documentation/crud-jsonapi-spec.test.ts
import SwaggerParser from '@apidevtools/swagger-parser';
import { DocumentationGenerator } from '@lib/documentationGenerator';
import { snapshotEnv } from '../../_setup/env-fixture';

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
});
