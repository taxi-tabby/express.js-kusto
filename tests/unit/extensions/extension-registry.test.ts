import { extensionRegistry } from '@lib/extensions/extensionRegistry';
import type { KustoExtension } from '@lib/extensions/extensionTypes';

describe('extensionRegistry', () => {
    afterEach(() => extensionRegistry.clear());

    it('이름이 중복된 확장은 무시한다', () => {
        extensionRegistry.register({ name: 'a' } as KustoExtension);
        extensionRegistry.register({ name: 'a' } as KustoExtension);
        expect(extensionRegistry.getAll().length).toBe(1);
    });

    it('runInit 이 onInit 훅을 등록 순서로 실행한다', async () => {
        const order: string[] = [];
        extensionRegistry.register({ name: 'a', onInit: () => { order.push('a'); } } as KustoExtension);
        extensionRegistry.register({ name: 'b', onInit: async () => { order.push('b'); } } as KustoExtension);
        await extensionRegistry.runInit({} as any);
        expect(order).toEqual(['a', 'b']);
    });

    it('runInit 에서 발생한 에러를 re-throw 한다(fail-fast)', async () => {
        extensionRegistry.register({ name: 'a', onInit: () => { throw new Error('boom'); } } as KustoExtension);
        await expect(extensionRegistry.runInit({} as any)).rejects.toThrow('boom');
    });

    it('register 는 저장 성공 시 true, 중복 이름이면 false 를 반환한다', () => {
        expect(extensionRegistry.register({ name: 'a' } as KustoExtension)).toBe(true);
        expect(extensionRegistry.register({ name: 'a' } as KustoExtension)).toBe(false);
    });

    it('runBuild 가 onBuild 훅을 실행한다', async () => {
        const order: string[] = [];
        extensionRegistry.register({ name: 'a', onBuild: () => { order.push('a'); } } as KustoExtension);
        extensionRegistry.register({ name: 'b' } as KustoExtension); // onBuild 없음 → 스킵
        await extensionRegistry.runBuild({} as any);
        expect(order).toEqual(['a']);
    });

    it('runBuild 에서 발생한 에러를 re-throw 한다(fail-fast)', async () => {
        extensionRegistry.register({ name: 'a', onBuild: () => { throw new Error('boom'); } } as KustoExtension);
        await expect(extensionRegistry.runBuild({} as any)).rejects.toThrow('boom');
    });

    it('clear 가 등록된 확장을 모두 비운다', () => {
        extensionRegistry.register({ name: 'a' } as KustoExtension);
        extensionRegistry.clear();
        expect(extensionRegistry.getAll().length).toBe(0);
    });
});
