import { bootDbFixture, truncateAll, DbFixture } from '@tests/_setup/db-fixture';
import { BaseRepository } from '@lib/data/database/baseRepository';

/**
 * BaseRepository 의 컨스트럭터는 PrismaManager 인스턴스를 받음.
 * 테스트에서는 fixture 의 prisma 를 반환하는 mock manager 를 주입.
 */
class TestUserRepository extends BaseRepository<any> {
    protected getDatabaseName() {
        return 'default' as any;
    }
}

function makeMockManager(prisma: any) {
    return {
        getWrap: () => prisma,
        getClient: async () => prisma,
        getClientSync: () => prisma,
        isConnected: () => true,
        healthCheck: async () => ({ databases: [] }),
    };
}

describe('BaseRepository (통합)', () => {
    let fixture: DbFixture;
    let repo: TestUserRepository;

    beforeAll(async () => {
        fixture = await bootDbFixture();
        repo = new TestUserRepository(makeMockManager(fixture.prisma) as any);
    });

    afterAll(async () => {
        await fixture.teardown();
    });

    afterEach(async () => {
        await truncateAll(fixture);
    });

    it('client getter 호출 시 prisma 클라이언트 인스턴스를 반환한다', () => {
        const client = (repo as any).client;
        expect(client).toBeDefined();
        expect(typeof client.user.create).toBe('function');
    });

    it('client 를 통해 user 를 create 후 findMany 로 조회할 수 있다', async () => {
        await (repo as any).client.user.create({
            data: { id: 'u1', email: 'a@a.com', name: 'Alice' },
        });
        const all = await (repo as any).client.user.findMany();
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe('u1');
    });

    it('$transaction 내부 작업이 모두 성공하면 commit 된다', async () => {
        await repo.$transaction(async (tx: any) => {
            await tx.user.create({ data: { id: 'u1', email: 'a@a.com', name: 'A' } });
            await tx.user.create({ data: { id: 'u2', email: 'b@b.com', name: 'B' } });
        });
        const all = await fixture.prisma.user.findMany();
        expect(all).toHaveLength(2);
    });

    it('$transaction 내부에서 throw 하면 rollback 되어 row 가 남지 않는다', async () => {
        await expect(
            repo.$transaction(async (tx: any) => {
                await tx.user.create({ data: { id: 'u1', email: 'a@a.com', name: 'A' } });
                throw new Error('intentional rollback');
            }),
        ).rejects.toThrow('intentional rollback');
        const all = await fixture.prisma.user.findMany();
        expect(all).toHaveLength(0);
    });

    it('retryAttempts: 1 (기본) 일 때 재시도 없이 한 번만 실행된다', async () => {
        let calls = 0;
        await expect(
            repo.$transaction(async (tx: any) => {
                calls++;
                await tx.user.create({ data: { id: 'x', email: 'x@x.com', name: 'X' } });
                throw new Error('always fail');
            }),
        ).rejects.toThrow();
        expect(calls).toBe(1);
    });
});
