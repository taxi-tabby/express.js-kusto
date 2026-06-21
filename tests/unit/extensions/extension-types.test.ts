import { defineExtension, isKustoExtension } from '@lib/extensions/extensionTypes';

describe('extensionTypes', () => {
    it('defineExtension 은 객체를 그대로 반환한다(identity)', () => {
        const ext = { name: 'x', routerMethods: { GET_A: () => {} } };
        expect(defineExtension(ext)).toBe(ext);
    });

    it('isKustoExtension 이 올바른 형태를 통과시킨다', () => {
        expect(isKustoExtension({ name: 'x' })).toBe(true);
        expect(
            isKustoExtension({
                name: 'x',
                version: '1.0.0',
                routerMethods: { A: () => {} },
                onInit: () => {},
                onBuild: async () => {},
            }),
        ).toBe(true);
    });

    it('isKustoExtension 이 잘못된 형태를 거부한다', () => {
        expect(isKustoExtension(null)).toBe(false);
        expect(isKustoExtension(undefined)).toBe(false);
        expect(isKustoExtension('str')).toBe(false);
        expect(isKustoExtension({})).toBe(false); // name 없음
        expect(isKustoExtension({ name: '' })).toBe(false); // 빈 name
        expect(isKustoExtension({ name: 5 })).toBe(false);
        expect(isKustoExtension({ name: 'x', routerMethods: 5 })).toBe(false);
        expect(isKustoExtension({ name: 'x', routerMethods: null })).toBe(false);
        expect(isKustoExtension({ name: 'x', routerMethods: { A: 'notfn' } })).toBe(false);
        expect(isKustoExtension({ name: 'x', routerMethods: { A: () => {}, B: 5 } })).toBe(false);
        expect(isKustoExtension({ name: 'x', onInit: 'no' })).toBe(false);
        expect(isKustoExtension({ name: 'x', onBuild: 1 })).toBe(false);
    });
});
