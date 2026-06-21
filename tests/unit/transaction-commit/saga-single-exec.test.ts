import { TransactionCommitManager } from '@lib/data/database/transactionCommitManager';

/**
 * P0-4 회귀 테스트: Saga 분산 트랜잭션은 각 참여자 operation 을 단 한 번만 실행해야 한다.
 *
 * 버그(수정 전): preparePhase 의 simulateOperation 이 operation 을 실행 후 롤백하고,
 * commitParticipant 가 operation 을 다시 실행하여 비멱등 작업이 두 번 실행됨.
 */
describe('TransactionCommitManager — Saga single-execution (P0-4)', () => {
    function makeFakeClient() {
        return {
            // checkDatabaseResources 의 `SELECT 1` 헬스 체크용 (tagged template)
            $queryRaw: jest.fn(async () => [{ ok: 1 }]),
            // 콜백을 실제 실행하여 operation 호출 횟수를 그대로 노출시킨다.
            $transaction: jest.fn(async (cb: any, _opts?: any) => cb({})),
        };
    }

    function makeManager(client: any) {
        const fakePrisma: any = {
            isConnected: jest.fn(() => true),
            healthCheck: jest.fn(async () => ({
                databases: [{ name: 'default', status: 'healthy' }],
            })),
            getClientSync: jest.fn(() => client),
            getProviderForDatabase: jest.fn(() => 'sqlite'),
        };
        return new TransactionCommitManager(fakePrisma);
    }

    it('executes each participant operation exactly once (not twice)', async () => {
        const client = makeFakeClient();
        const manager = makeManager(client);
        const operation = jest.fn(async (_tx: any) => ({ id: 1 }));

        const result = await manager.executeDistributedTransaction(
            [{ database: 'default', operation } as any],
            { enableLogging: false },
        );

        expect(result.success).toBe(true);
        expect(operation).toHaveBeenCalledTimes(1);
    });
});
