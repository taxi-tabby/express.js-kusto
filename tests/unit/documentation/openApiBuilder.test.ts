import { buildOpenApiDocument } from '@lib/documentation/openApiBuilder';
import { snapshotEnv } from '../../_setup/env-fixture';

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
        it('routes 가 비어 있을 때 paths 가 빈 객체인 OpenAPI document 를 반환한다', () => {
            const doc = buildOpenApiDocument({
                routes: [],
                schemas: {},
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            expect(doc.openapi).toBe('3.0.0');
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
            expect(doc.paths['/users'].get).toBeDefined();
            expect(doc.paths['/users'].get?.summary).toBe('List users');
            expect(doc.paths['/users'].get?.responses['200']).toBeDefined();
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
                    parameters: {
                        query: {
                            page: { type: 'number', required: false },
                        },
                    },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            const op = doc.paths['/users'].get!;
            expect(op.parameters).toBeDefined();
            expect(op.parameters!.find((p: any) => p.name === 'page' && p.in === 'query')).toBeDefined();
        });

        it('routes 의 path 파라미터가 OpenAPI parameters in=path 로 변환된다', () => {
            const doc = buildOpenApiDocument({
                routes: [{
                    method: 'GET',
                    path: '/users/:id',
                    parameters: {
                        params: { id: { type: 'string', required: true } },
                    },
                }],
                schemas: {},
                env: process.env,
                packageJson: { name: 'test-api', version: '1.0.0' },
            });
            const op = doc.paths['/users/:id']?.get;
            expect(op?.parameters?.find((p: any) => p.name === 'id' && p.in === 'path')).toBeDefined();
        });

        it('responses 가 없을 때 기본 200 응답이 채워진다 (기존 동작 보존)', () => {
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
    });
});
