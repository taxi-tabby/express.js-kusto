import { CrudQueryParser } from '@lib/crud/crudHelpers';
import { Request } from 'express';

function makeReq(query: Record<string, any>): Request {
    return { query } as any;
}

describe('CrudQueryParser parseFilter — 연산자 매처', () => {
    it('expression 이 name_eq 일 때 eq 연산자로 매핑된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_eq]': 'John' }));
        expect(params.filter).toMatchObject({
            name: expect.objectContaining({ eq: 'John' }),
        });
    });

    it('expression 이 name_not_in 일 때 not_in 연산자로 매핑된다 (in 매처에 흡수되지 않는다)', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_not_in]': 'a,b,c' }));
        expect(params.filter).toMatchObject({
            name: expect.objectContaining({ not_in: expect.arrayContaining(['a', 'b', 'c']) }),
        });
    });

    it('expression 이 name_not_null 일 때 not_null 연산자로 매핑된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_not_null]': '1' }));
        expect(params.filter).toMatchObject({
            name: expect.objectContaining({ not_null: expect.anything() }),
        });
    });

    it('expression 이 name_start 일 때 start 연산자로 매핑된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_start]': 'Jo' }));
        expect(params.filter).toMatchObject({
            name: expect.objectContaining({ start: 'Jo' }),
        });
    });

    it('expression 이 name_end 일 때 end 연산자로 매핑된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_end]': 'hn' }));
        expect(params.filter).toMatchObject({
            name: expect.objectContaining({ end: 'hn' }),
        });
    });

    it('expression 이 score_between 일 때 between 연산자로 매핑된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[score_between]': '1,10' }));
        expect(params.filter).toMatchObject({
            score: expect.objectContaining({ between: expect.anything() }),
        });
    });

    it('expression 에 연산자가 없을 때 필터에 해당 필드 키가 등록된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name]': 'John' }));
        expect(params.filter).toBeDefined();
        expect(Object.keys(params.filter ?? {})).toContain('name');
    });

    it('expression 에 알 수 없는 토큰 name_unknownop 가 들어올 때 throw 하지 않는다', () => {
        expect(() =>
            CrudQueryParser.parseQuery(makeReq({ 'filter[name_unknownop]': 'x' })),
        ).not.toThrow();
    });
});
