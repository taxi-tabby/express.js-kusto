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
 * 명시적 _like / _ilike 는 SQL LIKE 가 아니라 리터럴 substring(contains) 매칭이다.
 * Prisma 에는 raw LIKE 연산자가 없으므로, 와일드카드로 오해될 수 있는
 * 이스케이프되지 않은 % 는 조용히 무시하지 않고 400 으로 거부한다.
 * 리터럴 % 가 필요하면 \% 로 이스케이프한다.
 * (연산자 없는 %foo% 단축형 자동감지는 하위 호환을 위해 이 규칙에서 면제된다.)
 */
describe('CrudQueryParser — 명시적 like/ilike 의 % 처리', () => {
    it('명시적 _like 에 이스케이프되지 않은 % 가 있으면 400 으로 throw', () => {
        expect400({ 'filter[name_like]': '%foo%' });
    });

    it('명시적 _ilike 에 이스케이프되지 않은 % 가 있으면 400 으로 throw', () => {
        expect400({ 'filter[name_ilike]': 'foo%' });
    });

    it('명시적 _like 의 \\% 는 리터럴 % 로 보존된다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_like]': '50\\% off' }));
        expect(params.filter).toMatchObject({
            name: expect.objectContaining({ like: '50% off' }),
        });
    });

    it('명시적 _like 평문은 그대로 통과한다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_like]': 'foo' }));
        expect(params.filter).toMatchObject({ name: expect.objectContaining({ like: 'foo' }) });
    });

    it('명시적 _ilike 평문은 그대로 통과한다', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name_ilike]': 'foo' }));
        expect(params.filter).toMatchObject({ name: expect.objectContaining({ ilike: 'foo' }) });
    });

    it('연산자 없는 %foo% 단축형은 자동감지 like 로 동작하며 400 이 아니다 (하위 호환)', () => {
        const params = CrudQueryParser.parseQuery(makeReq({ 'filter[name]': '%foo%' }));
        // 자동감지 경로에서 % 는 연산자 선택 신호이므로 제거되어 리터럴 substring 'foo' 가 된다.
        expect(params.filter).toMatchObject({ name: expect.objectContaining({ like: 'foo' }) });
    });
});
