import { applyResponseSerializer } from '@lib/http/serialization/serializer';

const fakeReq = {} as any; // serializer 함수는 req 를 사용하지 않는 케이스만 검증

describe('applyResponseSerializer', () => {
    it('함수형 serializer 는 데이터를 그대로 변형해 반환한다', async () => {
        const out = await applyResponseSerializer(
            { id: 1, password: 'x', name: 'a' },
            (u: any) => ({ id: u.id, name: u.name }),
            fakeReq,
        );
        expect(out).toEqual({ id: 1, name: 'a' });
    });

    it('async 함수형 serializer 의 Promise 를 await 한다', async () => {
        const out = await applyResponseSerializer(
            { id: 1 },
            async (u: any) => ({ id: u.id, extra: true }),
            fakeReq,
        );
        expect(out).toEqual({ id: 1, extra: true });
    });

    it('{omit} 는 지정 필드를 제거한다', async () => {
        const out = await applyResponseSerializer(
            { id: 1, password: 'x', ssn: '9' },
            { omit: ['password', 'ssn'] },
            fakeReq,
        );
        expect(out).toEqual({ id: 1 });
    });

    it('{pick} 는 지정 필드만 남긴다', async () => {
        const out = await applyResponseSerializer(
            { id: 1, password: 'x', name: 'a' },
            { pick: ['id', 'name'] },
            fakeReq,
        );
        expect(out).toEqual({ id: 1, name: 'a' });
    });

    it('{omit} 는 배열이면 원소별로 적용한다', async () => {
        const out = await applyResponseSerializer(
            [
                { id: 1, password: 'x' },
                { id: 2, password: 'y' },
            ],
            { omit: ['password'] },
            fakeReq,
        );
        expect(out).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('{pick} 는 배열이면 원소별로 적용한다', async () => {
        const out = await applyResponseSerializer(
            [{ id: 1, name: 'a', secret: 's' }],
            { pick: ['id', 'name'] },
            fakeReq,
        );
        expect(out).toEqual([{ id: 1, name: 'a' }]);
    });

    it('null/undefined 는 그대로 통과한다 (pick/omit)', async () => {
        expect(await applyResponseSerializer(null, { omit: ['x'] }, fakeReq)).toBeNull();
        expect(await applyResponseSerializer(undefined, { pick: ['x'] }, fakeReq)).toBeUndefined();
    });

    it('존재하지 않는 키를 omit/pick 해도 안전하다', async () => {
        expect(
            await applyResponseSerializer({ id: 1 }, { omit: ['nope'] as any }, fakeReq),
        ).toEqual({ id: 1 });
        expect(
            await applyResponseSerializer({ id: 1 }, { pick: ['nope'] as any }, fakeReq),
        ).toEqual({});
    });
});
