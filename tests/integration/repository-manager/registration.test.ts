import { RepositoryManager } from '@lib/data/database/repositoryManager';

describe('RepositoryManager', () => {
    it('getInstance 를 두 번 호출할 때 같은 인스턴스를 반환한다 (singleton)', () => {
        const a = RepositoryManager.getInstance();
        const b = RepositoryManager.getInstance();
        expect(a).toBe(b);
    });

    it('initialize 호출 전 getRepository 호출 시 throw 한다', () => {
        const manager = RepositoryManager.getInstance();
        // initialize 안 한 상태로 만들기
        (manager as any).initialized = false;
        expect(() => manager.getRepository('any' as any)).toThrow();
    });

    it('initialize 후 hasRepository 가 정상 동작한다', () => {
        const manager = RepositoryManager.getInstance();
        (manager as any).initialized = true;
        (manager as any).repositories = { example: {} };
        expect(manager.hasRepository('example' as any)).toBe(true);
        expect(manager.hasRepository('nonexistent' as any)).toBe(false);
    });

    it('getLoadedRepositoryNames 호출 시 등록된 repository 이름 배열을 반환한다', () => {
        const manager = RepositoryManager.getInstance();
        (manager as any).initialized = true;
        (manager as any).repositories = { foo: {}, bar: {} };
        const names = manager.getLoadedRepositoryNames();
        expect(names).toEqual(expect.arrayContaining(['foo', 'bar']));
    });

    it('getStatus 호출 시 initialized/repositoryCount/repositories 객체를 반환한다', () => {
        const manager = RepositoryManager.getInstance();
        (manager as any).initialized = true;
        (manager as any).repositories = { example: {} };
        const status = manager.getStatus();
        expect(status).toMatchObject({
            initialized: true,
            repositoryCount: 1,
            repositories: expect.arrayContaining(['example'])
        });
    });
});
