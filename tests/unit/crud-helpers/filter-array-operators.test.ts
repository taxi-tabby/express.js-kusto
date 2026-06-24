import { CrudQueryParser } from '@lib/crud/crudHelpers';
import { Request } from 'express';

function makeReq(query: Record<string, any>): Request {
    return { query } as any;
}

function expect400(query: Record<string, any>) {
    let thrown: any;
    try {
        CrudQueryParser.parseQuery(makeReq(query));
    } catch (e) {
        thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.statusCode).toBe(400);
    return thrown;
}

/**
 * 배열 연산자(all/elemMatch/size)와 regex 의 parse 레이어 동작.
 * - regex: Prisma SQL 커넥터 미지원 → 400.
 * - size: 0(빈 배열)만 지원, N>0/비정수 → 400.
 * - all/elemMatch: 콤마 분리로 값을 배열화 (실제 Prisma 키 매핑은 빌드 레이어에서 타입 인지).
 */
describe('CrudQueryParser — 배열 연산자/regex parse 동작', () => {
    it('regex 연산자는 항상 400 으로 거부된다', () => {
        expect400({ 'filter[name_regex]': 'foo.*' });
    });

    it('size 가 0 보다 크면 400 으로 거부된다 (Prisma where 로 표현 불가)', () => {
        expect400({ 'filter[tags_size]': '3' });
    });

    it('size 가 비정수면 400 으로 거부된다', () => {
        expect400({ 'filter[tags_size]': 'abc' });
    });

    it('size 0 은 통과한다 (빌드 레이어에서 isEmpty 로 변환)', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[tags_size]': '0' }));
        expect(params.filter).toMatchObject({ tags: { size: 0 } });
    });

    it('all 은 콤마 분리되어 배열로 파싱된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[tags_all]': 'a,b,c' }));
        expect(params.filter).toMatchObject({ tags: { all: ['a', 'b', 'c'] } });
    });

    it('elemMatch 단일 값은 스칼라로 파싱된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[tags_elemMatch]': 'a' }));
        expect(params.filter).toMatchObject({ tags: { elemMatch: 'a' } });
    });

    it('elemMatch 다중 값은 배열로 파싱된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[tags_elemMatch]': 'a,b' }));
        expect(params.filter).toMatchObject({ tags: { elemMatch: ['a', 'b'] } });
    });

    it('all 의 값이 모두 비면 400 으로 거부된다', () => {
        expect400({ 'filter[tags_all]': ' , , ' });
    });

    // exists 는 present 의 별칭이므로, present/blank 와 똑같이 boolean 으로 파싱되어야 한다.
    // (예전엔 default 경로로 빠져 smartTypeConversion 을 거쳤고, UUID 필드 + schemaAnalyzer 가
    //  있으면 'true' 가 UUID 검증에 실패해 잘못된 400 을 냈다.)
    it('exists 는 UUID 필드 + schemaAnalyzer 가 있어도 400 이 아니고 present 처럼 파싱된다', () => {
        const uuidAnalyzer = {
            getModel: () => ({ fields: [{ name: 'id', type: 'String', nativeType: 'Uuid' }] }),
        };
        const params = CrudQueryParser.parseQuery(
            makeReq({ 'filter[id_exists]': 'true' }),
            'Thing',
            uuidAnalyzer,
        );
        expect(params.filter).toMatchObject({ id: { exists: true } });
    });
});
