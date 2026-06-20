import { buildOpenApiDocument } from '@lib/documentation/openApiBuilder';
import { snapshotEnv } from '@tests/_setup/env-fixture';

describe('openApiBuilder', () => {
    let restoreEnv: () => void;
    beforeEach(() => {
        restoreEnv = snapshotEnv();
        delete process.env.OPENAPI_TITLE;
        delete process.env.OPENAPI_VERSION;
        delete process.env.OPENAPI_DESC;
        delete process.env.OPENAPI_SERVERS;
    });
    afterEach(() => restoreEnv());

    describe('buildOpenApiDocument', () => {
        it('routes 가 비어 있을 때 openapi 3.1.0 의 빈 paths document 를 반환한다', () => {
            const doc = buildOpenApiDocument({
                routes: [],
                schemas: {},
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            expect(doc.openapi).toBe('3.1.0');
            expect(doc.info.title).toBe('test-api');
            expect(doc.paths).toEqual({});
            expect(doc.components?.schemas).toEqual({});
        });

        it('GET /users 라우트 1개일 때 paths 에 등록된다', () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/users',
                    summary: 'List users',
                    responses: { 200: { data: { type: 'array', required: true } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            expect(doc.paths['/users']).toBeDefined();
            expect(doc.paths['/users'].get?.summary).toBe('List users');
        });

        it('schemas 가 주어지면 components.schemas 로 그대로 옮겨진다', () => {
            const userSchema = { type: 'object' as const, properties: { id: { type: 'string' as const } } };
            const doc = buildOpenApiDocument({
                routes: [],
                schemas: { User: userSchema },
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            expect(doc.components?.schemas?.User).toEqual(userSchema);
        });

        it('routes 의 query 파라미터가 OpenAPI parameters 로 변환된다', () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/users',
                    parameters: { query: { page: { type: 'number', required: false, description: 'Page' } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            const op = doc.paths['/users'].get!;
            expect(op.parameters!.find(p => p.name === 'page' && p.in === 'query')).toBeDefined();
        });

        it(':id 형식의 path 가 OpenAPI 표준 {id} 로 변환된다', () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/users/:id',
                    parameters: { params: { id: { type: 'string', required: true } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            expect(doc.paths['/users/{id}']).toBeDefined();
            expect(doc.paths['/users/:id']).toBeUndefined();
            const op = doc.paths['/users/{id}'].get;
            expect(op?.parameters?.find(p => p.name === 'id' && p.in === 'path')).toBeDefined();
        });

        it("contentType 'json' 일 때 응답 content key 가 application/json 이다", () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/x',
                    contentType: 'json',
                    responses: { 200: { data: { type: 'object', required: true } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            const content = doc.paths['/x'].get?.responses['200']?.content;
            expect(content).toHaveProperty('application/json');
            expect(content?.['application/vnd.api+json']).toBeUndefined();
        });

        it("contentType 'jsonapi' 일 때 응답 content key 가 application/vnd.api+json 이다", () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/x',
                    contentType: 'jsonapi',
                    responses: { 200: { data: { type: 'object', required: true } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            const content = doc.paths['/x'].get?.responses['200']?.content;
            expect(content?.['application/vnd.api+json']).toBeDefined();
            expect(content?.['application/json']).toBeUndefined();
        });

        it("contentType 'jsonapi' 일 때 requestBody content key 도 application/vnd.api+json 이다", () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'POST',
                    path: '/x',
                    contentType: 'jsonapi',
                    parameters: { body: { name: { type: 'string', required: true } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            const content = doc.paths['/x'].post?.requestBody?.content;
            expect(content?.['application/vnd.api+json']).toBeDefined();
        });

        it('contentType 미지정일 때 application/json 이 기본값이다', () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/y',
                    responses: { 200: { ok: { type: 'boolean', required: true } } },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            expect(doc.paths['/y'].get?.responses['200']?.content).toHaveProperty('application/json');
        });

        it('responses 가 없을 때 기본 200 응답이 채워진다', () => {
            const doc = buildOpenApiDocument({
                routes: [{ method: 'POST', path: '/x' }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            expect(doc.paths['/x']?.post?.responses['200']).toBeDefined();
        });

        it('환경변수가 servers/info 를 override 한다', () => {
            process.env.OPENAPI_TITLE = 'Custom';
            process.env.OPENAPI_SERVERS = JSON.stringify([{ url: 'https://prod.example.com' }]);
            const doc = buildOpenApiDocument({
                routes: [],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            expect(doc.info.title).toBe('Custom');
            expect(doc.servers?.[0].url).toBe('https://prod.example.com');
        });

        it('parameters.body 가 이미 OpenAPI 객체 schema 일 때 그대로 사용된다 ($ref 보존)', () => {
            const body = {
                type: 'object',
                required: ['data'],
                properties: {
                    data: { $ref: '#/components/schemas/UserAttributes' },
                },
            };
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'POST',
                    path: '/x',
                    contentType: 'jsonapi',
                    parameters: { body: body as any },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            const reqSchema = doc.paths['/x']?.post?.requestBody?.content?.['application/vnd.api+json']?.schema as any;
            expect(reqSchema.required).toEqual(['data']);
            expect(reqSchema.properties.data).toEqual({ $ref: '#/components/schemas/UserAttributes' });
        });

        it('responses[code] 가 이미 OpenAPI 객체 schema 일 때 그대로 사용된다 ($ref 보존)', () => {
            const responseSchema = {
                type: 'object',
                required: ['data'],
                properties: {
                    data: { $ref: '#/components/schemas/User' },
                },
            };
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/x',
                    contentType: 'jsonapi',
                    responses: { 200: responseSchema as any },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            const resSchema = doc.paths['/x']?.get?.responses['200']?.content?.['application/vnd.api+json']?.schema as any;
            expect(resSchema.required).toEqual(['data']);
            expect(resSchema.properties.data).toEqual({ $ref: '#/components/schemas/User' });
        });

        it('직접 $ref 만 있는 schema 도 그대로 통과한다', () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/x',
                    contentType: 'jsonapi',
                    responses: { 200: { $ref: '#/components/schemas/User' } as any },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'a', version: '1' },
            });
            const resSchema = doc.paths['/x']?.get?.responses['200']?.content?.['application/vnd.api+json']?.schema;
            expect(resSchema).toEqual({ $ref: '#/components/schemas/User' });
        });
    });
});
