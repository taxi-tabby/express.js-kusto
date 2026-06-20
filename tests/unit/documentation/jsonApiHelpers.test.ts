import {
    jsonApiBody,
    jsonApiResponse,
    jsonApiErrorResponse,
    jsonApiCollectionResponse,
} from '@lib/devtools/documentation/jsonApiHelpers';

describe('jsonApiHelpers', () => {
    describe('jsonApiBody', () => {
        it("'create' op 일 때 data.type/attributes 를 가진 schema 를 만들고 attributes 는 {Model}Attributes 로 ref", () => {
            const body = jsonApiBody('User', 'create');
            expect(body.type).toBe('object');
            expect(body.required).toEqual(['data']);
            expect((body.properties as any).data.type).toBe('object');
            expect((body.properties as any).data.required).toEqual(expect.arrayContaining(['type', 'attributes']));
            expect((body.properties as any).data.properties.attributes).toEqual({ $ref: '#/components/schemas/UserAttributes' });
            expect((body.properties as any).data.properties.type).toBeDefined();
        });

        it("'update' op 일 때 data.id 도 required 다", () => {
            const body = jsonApiBody('User', 'update');
            expect((body.properties as any).data.required).toEqual(expect.arrayContaining(['type', 'id', 'attributes']));
        });
    });

    describe('jsonApiResponse', () => {
        it('단일 resource 응답 형식 (data: $ref) 을 만든다', () => {
            const resp = jsonApiResponse('User', 200);
            expect(resp.type).toBe('object');
            expect((resp.properties as any).data).toEqual({ $ref: '#/components/schemas/User' });
        });
    });

    describe('jsonApiErrorResponse', () => {
        it('errors: $ref to JsonApiError 형식의 schema 를 만든다', () => {
            const resp = jsonApiErrorResponse(404);
            expect(resp.type).toBe('object');
            expect(resp.required).toEqual(['errors']);
            expect((resp.properties as any).errors).toEqual({ $ref: '#/components/schemas/JsonApiError' });
        });
    });

    describe('jsonApiCollectionResponse', () => {
        it('컬렉션 응답: data 가 {Model} 의 배열로 ref 된다', () => {
            const resp = jsonApiCollectionResponse('User');
            expect(resp.type).toBe('object');
            expect(resp.required).toEqual(['data']);
            const data = (resp.properties as any).data;
            expect(data.type).toBe('array');
            expect(data.items).toEqual({ $ref: '#/components/schemas/User' });
        });

        it('meta 필드는 옵셔널 (필수 아님)', () => {
            const resp = jsonApiCollectionResponse('User');
            expect(resp.required).not.toContain('meta');
            expect((resp.properties as any).meta).toBeDefined();
        });
    });
});
