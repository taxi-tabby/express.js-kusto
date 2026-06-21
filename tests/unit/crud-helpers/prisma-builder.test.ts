import { PrismaQueryBuilder } from '@lib/crud/crudHelpers';

describe('PrismaQueryBuilder.buildIncludeOptions', () => {
    it('빈 배열일 때 빈 객체를 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildIncludeOptions([]);
        expect(result).toEqual({});
    });

    it('단일 항목 [author] 일 때 { author: true } 를 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildIncludeOptions(['author']);
        expect(result).toEqual({ author: true });
    });

    it('점 경로 [author.profile] 일 때 중첩 include 객체를 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildIncludeOptions(['author.profile']);
        expect(result).toEqual({
            author: { include: { profile: true } },
        });
    });

    it('동일 부모의 두 자식 [comments.author, comments.posts] 일 때 한 부모 안에 둘 다 포함한다', () => {
        const result = (PrismaQueryBuilder as any).buildIncludeOptions([
            'comments.author',
            'comments.posts',
        ]);
        expect(result).toEqual({
            comments: { include: { author: true, posts: true } },
        });
    });

    it('3-level 경로 [a.b.c] 일 때 3중 중첩 객체를 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildIncludeOptions(['a.b.c']);
        expect(result).toEqual({
            a: { include: { b: { include: { c: true } } } },
        });
    });
});
