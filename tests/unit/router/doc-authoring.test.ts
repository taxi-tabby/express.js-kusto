import { ExpressRouter } from '@lib/http/routing/expressRouter';
import { DocumentationGenerator } from '@lib/devtools/documentation/documentationGenerator';

/**
 * 라우트 문서 저작 surface 통합 테스트.
 * 문서 등록은 AUTO_DOCS=true && NODE_ENV!=production 일 때만 동작하므로 env 를 맞춘다.
 */
describe('ExpressRouter — 문서 저작 surface', () => {
    const prevAutoDocs = process.env.AUTO_DOCS;

    beforeAll(() => {
        process.env.AUTO_DOCS = 'true';
    });
    afterAll(() => {
        if (prevAutoDocs === undefined) delete process.env.AUTO_DOCS;
        else process.env.AUTO_DOCS = prevAutoDocs;
    });
    beforeEach(() => {
        DocumentationGenerator.reset();
    });

    const noop = async () => ({});
    const find = (method: string) =>
        DocumentationGenerator.getRoutes().find((r) => r.method === method);

    it('verb 옵션의 summary/description/tags 가 등록됨 (basePath 선설정)', () => {
        const router = new ExpressRouter();
        router.setBasePath('/users');
        router.GET(noop, { summary: 'List users', description: 'All users', tags: ['Users'] });

        const r = find('GET');
        expect(r?.path).toBe('/users');
        expect(r?.summary).toBe('List users');
        expect(r?.description).toBe('All users');
        expect(r?.tags).toEqual(['Users']);
    });

    it('지연 경로(setBasePath 나중)에서도 doc 메타가 보존됨', () => {
        const router = new ExpressRouter();
        router.POST(noop, { summary: 'Create user', tags: ['Users'] });
        router.setBasePath('/users'); // 지연 등록 flush

        const r = find('POST');
        expect(r?.path).toBe('/users');
        expect(r?.summary).toBe('Create user');
        expect(r?.tags).toEqual(['Users']);
    });

    it('생성자 기본 태그가 라우트에 적용되고 설명이 등록됨', () => {
        const router = new ExpressRouter({ tag: 'Accounts', description: 'User accounts' });
        router.setBasePath('/users');
        router.GET(noop);

        expect(find('GET')?.tags).toEqual(['Accounts']);
        // 생성자 태그 설명이 문서 레벨 tags[] 에 반영
        const doc = DocumentationGenerator.generateOpenAPISpec();
        expect(doc.tags).toEqual(
            expect.arrayContaining([{ name: 'Accounts', description: 'User accounts' }]),
        );
    });

    it('per-route tags 가 생성자 기본 태그보다 우선', () => {
        const router = new ExpressRouter({ tag: 'Accounts' });
        router.setBasePath('/users');
        router.GET(noop, { tags: ['Special'] });

        expect(find('GET')?.tags).toEqual(['Special']);
    });

    it('*_VALIDATED 도 doc-only 옵션(serialize 없이)을 받을 수 있음', () => {
        const router = new ExpressRouter();
        router.setBasePath('/items');
        router.GET_VALIDATED(
            { query: {} },
            { 200: { data: { type: 'object', required: false } } },
            async () => ({}),
            { summary: 'List items', tags: ['Items'] }, // serialize 없는 doc-only
        );
        const r = find('GET');
        expect(r?.summary).toBe('List items');
        expect(r?.tags).toEqual(['Items']);
    });

    it('태그 미지정 시 OpenAPI 빌드에서 경로 기반으로 자동 그룹화', () => {
        const router = new ExpressRouter();
        router.setBasePath('/products');
        router.GET(noop);

        const doc = DocumentationGenerator.generateOpenAPISpec();
        expect(doc.paths['/products'].get!.tags).toEqual(['Products']);
        expect(doc.paths['/products'].get!.operationId).toBe('getProducts');
    });
});
