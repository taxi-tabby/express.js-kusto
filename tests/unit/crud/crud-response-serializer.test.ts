import { applyCrudSerializers } from '@lib/crud/crudResponseSerializer';

const req = {} as any;
const PK = { primaryKey: 'id' };

describe('applyCrudSerializers — root', () => {
    it('omit: 단일 레코드에서 키 제거', async () => {
        const out = await applyCrudSerializers(
            { id: '1', name: 'a', password: 'x' },
            { omit: ['password'] },
            undefined,
            req,
            PK,
        );
        expect(out).toEqual({ id: '1', name: 'a' });
    });

    it('pick: 배열에 요소별 적용', async () => {
        const out = await applyCrudSerializers(
            [
                { id: '1', a: 1, b: 2 },
                { id: '2', a: 3, b: 4 },
            ],
            { pick: ['id', 'a'] },
            undefined,
            req,
            PK,
        );
        expect(out).toEqual([
            { id: '1', a: 1 },
            { id: '2', a: 3 },
        ]);
    });

    it('함수형 async 적용', async () => {
        const out = await applyCrudSerializers(
            { id: '1', n: 'a' },
            async (d: any) => ({ id: d.id, upper: d.n.toUpperCase() }),
            undefined,
            req,
            PK,
        );
        expect(out).toEqual({ id: '1', upper: 'A' });
    });

    it('id 보존: pick 에 id 없어도 식별자 유지', async () => {
        const out: any = await applyCrudSerializers(
            { id: '1', name: 'a' },
            { pick: ['name'] },
            undefined,
            req,
            PK,
        );
        expect(out).toEqual({ name: 'a', id: '1' });
    });

    it('id 보존: omit 에 id 지정해도 식별자 유지', async () => {
        const out: any = await applyCrudSerializers(
            { id: '1', name: 'a' },
            { omit: ['id', 'name'] as any },
            undefined,
            req,
            PK,
        );
        expect(out.id).toBe('1');
        expect(out.name).toBeUndefined();
    });

    it('비-id primaryKey 보존', async () => {
        const out: any = await applyCrudSerializers(
            { uuid: 'u', name: 'a' },
            { pick: ['name'] as any },
            undefined,
            req,
            { primaryKey: 'uuid' },
        );
        expect(out).toEqual({ name: 'a', uuid: 'u' });
    });

    it('함수형이 frozen 객체를 반환해 id 를 떨궈도 throw 없이 id 복원', async () => {
        const out: any = await applyCrudSerializers(
            { id: '1', name: 'a' },
            () => Object.freeze({ name: 'a' }),
            undefined,
            req,
            PK,
        );
        expect(out).toEqual({ name: 'a', id: '1' });
    });
});

describe('applyCrudSerializers — includes', () => {
    it('단일 관계 노드 pick', async () => {
        const data = { id: '1', author: { id: 'a', name: 'A', email: 'e' } };
        const out: any = await applyCrudSerializers(
            data,
            undefined,
            { author: { pick: ['id', 'name'] } },
            req,
            PK,
        );
        expect(out.author).toEqual({ id: 'a', name: 'A' });
    });

    it('배열 관계 노드 요소별 omit', async () => {
        const data = {
            id: '1',
            posts: [
                { id: 'p1', title: 't', secret: 's' },
                { id: 'p2', title: 'u', secret: 'z' },
            ],
        };
        const out: any = await applyCrudSerializers(
            data,
            undefined,
            { posts: { omit: ['secret'] } },
            req,
            PK,
        );
        expect(out.posts).toEqual([
            { id: 'p1', title: 't' },
            { id: 'p2', title: 'u' },
        ]);
    });

    it('중첩 경로 a.b 적용', async () => {
        const data = { id: '1', posts: [{ id: 'p1', author: { id: 'a', name: 'A', email: 'e' } }] };
        const out: any = await applyCrudSerializers(
            data,
            undefined,
            { 'posts.author': { pick: ['id', 'name'] } },
            req,
            PK,
        );
        expect(out.posts[0].author).toEqual({ id: 'a', name: 'A' });
    });

    it('관계 노드 부재 시 no-op', async () => {
        const data = { id: '1' };
        const out: any = await applyCrudSerializers(
            data,
            undefined,
            { author: { pick: ['id'] } },
            req,
            PK,
        );
        expect(out).toEqual({ id: '1' });
    });

    it('상위 pick 이 관계를 떨구면 하위 경로 no-op (꼬임 없음)', async () => {
        const data = {
            id: '1',
            posts: [{ id: 'p1', title: 't', author: { id: 'a', name: 'A', email: 'e' } }],
        };
        const out: any = await applyCrudSerializers(
            data,
            undefined,
            {
                posts: { pick: ['id', 'title'] },
                'posts.author': { pick: ['id', 'name'] },
            },
            req,
            PK,
        );
        expect(out.posts[0]).toEqual({ id: 'p1', title: 't' });
        expect(out.posts[0].author).toBeUndefined();
    });

    it('관계 노드도 id 보존', async () => {
        const data = { id: '1', author: { id: 'a', name: 'A' } };
        const out: any = await applyCrudSerializers(
            data,
            undefined,
            { author: { pick: ['name'] } },
            req,
            PK,
        );
        expect(out.author).toEqual({ name: 'A', id: 'a' });
    });
});

describe('applyCrudSerializers — no-op', () => {
    it('둘 다 미지정이면 입력 그대로(동일 참조)', async () => {
        const data = { id: '1', a: 1 };
        const out = await applyCrudSerializers(data, undefined, undefined, req, PK);
        expect(out).toBe(data);
    });

    it('빈 includeSerializers + root 없음 → 동일 참조', async () => {
        const data = [{ id: '1' }];
        const out = await applyCrudSerializers(data, undefined, {}, req, PK);
        expect(out).toBe(data);
    });
});
