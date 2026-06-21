import { CrudQueryParser } from '@lib/crud/crudHelpers';
import { Request } from 'express';

function makeReq(query: Record<string, any>): Request {
    return { query } as any;
}

// Uuid 타입 필드를 가진 가짜 schemaAnalyzer
const uuidAnalyzer = {
    getModel: () => ({ fields: [{ name: 'id', type: 'String', nativeType: 'Uuid' }] }),
};

/**
 * P0-2 회귀 테스트: 필터 값 검증 실패는 조용히 드롭(→ 200 + 더 넓은 데이터)하지 않고
 * statusCode 400 에러를 던져야 한다. (authz 인접 필터에서 데이터 노출 방지)
 */
describe('CrudQueryParser — 필터 검증 실패는 400 throw (P0-2)', () => {
    it('잘못된 UUID 형식 eq 필터는 statusCode 400 으로 throw', () => {
        let thrown: any;
        try {
            CrudQueryParser.parseQuery(
                makeReq({ 'filter[id_eq]': 'not-a-uuid' }),
                'Thing',
                uuidAnalyzer,
            );
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeDefined();
        expect(thrown.statusCode).toBe(400);
    });

    function expect400(query: Record<string, any>, model?: string, analyzer?: any) {
        let thrown: any;
        try {
            CrudQueryParser.parseQuery(makeReq(query), model as any, analyzer);
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeDefined();
        expect(thrown.statusCode).toBe(400);
        return thrown;
    }

    it('모든 값이 무효한 in 필터(빈 결과)는 statusCode 400 으로 throw', () => {
        expect400({ 'filter[id_in]': 'bad1,bad2' }, 'Thing', uuidAnalyzer);
    });

    it('between 에 값이 2개가 아니면 statusCode 400 으로 throw (스키마 유무 무관)', () => {
        // 스키마 없이도(fallback 경로) 400 이어야 한다
        expect400({ 'filter[score_between]': '1' });
        // 스키마 정보가 있는 경우에도 동일
        const intAnalyzer = { getModel: () => ({ fields: [{ name: 'score', type: 'Int' }] }) };
        expect400({ 'filter[score_between]': '1' }, 'Thing', intAnalyzer);
    });

    it('유효한 UUID eq 필터는 정상 통과한다 (false positive 없음)', () => {
        const uuid = '11111111-1111-1111-1111-111111111111';
        const params = CrudQueryParser.parseQuery(
            makeReq({ 'filter[id_eq]': uuid }),
            'Thing',
            uuidAnalyzer,
        );
        expect(params.filter).toMatchObject({ id: expect.objectContaining({ eq: uuid }) });
    });
});
