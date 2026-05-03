import { CrudQueryParser } from '@lib/crudHelpers';

describe('CrudQueryParser.validateIncludes', () => {
    it('policy 가 undefined 일 때 어떤 검증도 하지 않는다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['a.b.c.d.e'], undefined)
        ).not.toThrow();
    });

    it('includes 가 빈 배열일 때 어떤 검증도 하지 않는다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes([], { maxCount: 1, maxDepth: 1, allowed: [] })
        ).not.toThrow();
    });

    it('includes 가 undefined 일 때 어떤 검증도 하지 않는다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(undefined, { maxCount: 1, maxDepth: 1, allowed: [] })
        ).not.toThrow();
    });

    it('maxCount 가 지정됐고 항목 수가 초과할 때 INCLUDE_LIMIT_EXCEEDED 를 throw 한다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['a', 'b', 'c', 'd'], { maxCount: 3 })
        ).toThrow(expect.objectContaining({ code: 'INCLUDE_LIMIT_EXCEEDED', statusCode: 400 }));
    });

    it('maxCount 와 같은 개수일 때 통과한다 (경계값)', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['a', 'b', 'c'], { maxCount: 3 })
        ).not.toThrow();
    });

    it('maxDepth 가 지정됐고 점 깊이가 초과할 때 INCLUDE_DEPTH_EXCEEDED 를 throw 한다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['a.b.c.d'], { maxDepth: 3 })
        ).toThrow(expect.objectContaining({ code: 'INCLUDE_DEPTH_EXCEEDED', statusCode: 400 }));
    });

    it('항목 점 깊이가 maxDepth 와 같을 때 통과한다 (경계값)', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['a.b.c'], { maxDepth: 3 })
        ).not.toThrow();
    });

    it('allowed 에 정확히 일치하는 path 가 들어올 때 통과한다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['author'], { allowed: ['author', 'comments.author'] })
        ).not.toThrow();
    });

    it('allowed 항목의 prefix 가 path 일 때 통과한다 (얕은 부분 경로)', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['comments'], { allowed: ['comments.author'] })
        ).not.toThrow();
    });

    it('allowed 가 prefix 만 일치하고 path 가 더 깊을 때 INCLUDE_NOT_ALLOWED 를 throw 한다', () => {
        expect(() =>
            CrudQueryParser.validateIncludes(['comments.posts'], { allowed: ['comments.author'] })
        ).toThrow(expect.objectContaining({ code: 'INCLUDE_NOT_ALLOWED', statusCode: 400 }));
    });
});

describe('CrudQueryParser.mergeDefaultIncludes', () => {
    it('defaults 가 빈 배열일 때 client includes 를 그대로 반환한다', () => {
        const result = CrudQueryParser.mergeDefaultIncludes(['a', 'b'], []);
        expect(result).toEqual(['a', 'b']);
    });

    it('defaults 가 undefined 일 때 client includes 를 그대로 반환한다', () => {
        const result = CrudQueryParser.mergeDefaultIncludes(['a', 'b'], undefined);
        expect(result).toEqual(['a', 'b']);
    });

    it('client 가 빈 배열일 때 defaults 의 복사본을 반환한다', () => {
        const defaults = ['x', 'y'];
        const result = CrudQueryParser.mergeDefaultIncludes([], defaults);
        expect(result).toEqual(['x', 'y']);
        expect(result).not.toBe(defaults);
    });

    it('양쪽 다 있을 때 중복 제거한 합집합을 반환한다', () => {
        const result = CrudQueryParser.mergeDefaultIncludes(['a', 'b'], ['b', 'c']);
        expect(new Set(result)).toEqual(new Set(['a', 'b', 'c']));
        expect(result?.length).toBe(3);
    });
});
