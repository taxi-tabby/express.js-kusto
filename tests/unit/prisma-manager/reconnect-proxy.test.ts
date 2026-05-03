import { PrismaManager } from '@lib/prismaManager';

/**
 * connection 에러 mock client 팩토리. failures 회만큼 connection 에러를 throw 후 정상 응답.
 * Prisma 모델 형태(`client.user.findMany`)와 $ 접두사 메서드(`client.$queryRaw`)를 모두 노출한다.
 */
function makeFlakeyClient(failures: number) {
    let calls = 0;
    return {
        user: {
            findMany: jest.fn(async () => {
                calls++;
                if (calls <= failures) {
                    const err: any = new Error('Connection lost');
                    err.code = 'P1001'; // Prisma connection error
                    throw err;
                }
                return [{ id: 'u1' }];
            })
        },
        $disconnect: jest.fn(async () => {})
    };
}

/**
 * 항상 성공하는 fresh client (재연결 후 교체용).
 */
function makeFreshClient() {
    return {
        user: {
            findMany: jest.fn(async () => [{ id: 'u1' }])
        },
        $disconnect: jest.fn(async () => {})
    };
}

describe('PrismaManager.getWrap 재연결 Proxy', () => {
    let manager: PrismaManager;

    beforeEach(() => {
        manager = PrismaManager.getInstance();
        // singleton 내부 상태 초기화 (다른 테스트에 영향 주지 않도록 깨끗한 시작 보장)
        (manager as any).databases = new Map();
        (manager as any).reconnectionAttempts = new Map();
        (manager as any).reconnectionCooldowns = new Map();
        (manager as any).initialized = true; // getWrap 가 initialized 검사를 하므로 우회
        // reconnectDatabase mock — 실제 Prisma 호출 회피, 정상 client 로 교체
        (manager as any).reconnectDatabase = jest.fn(async (name: string) => {
            (manager as any).databases.set(name, makeFreshClient());
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('client 메서드가 정상 응답할 때 Proxy 가 그 결과를 그대로 반환한다', async () => {
        const client = makeFlakeyClient(0);
        (manager as any).databases.set('test', client);

        const wrap = manager.getWrap('test');
        const result = await wrap.user.findMany();

        expect(result).toEqual([{ id: 'u1' }]);
        expect(client.user.findMany).toHaveBeenCalledTimes(1);
    });

    it('client 메서드가 connection 에러로 1회 실패 후 성공할 때 Proxy 가 재시도하여 결과를 반환한다', async () => {
        jest.useFakeTimers();
        const client = makeFlakeyClient(1);
        (manager as any).databases.set('test', client);
        // reconnectDatabase 가 호출되어도 동일 client 를 유지 (재시도 시 같은 client 의 findMany 가 다시 호출됨)
        (manager as any).reconnectDatabase = jest.fn(async () => {
            // databases 교체하지 않음 — 같은 client 재사용
        });

        const wrap = manager.getWrap('test');
        const promise = wrap.user.findMany();

        // 첫 호출 실패 후 setTimeout(2000) 대기 → 타이머 진행
        await jest.advanceTimersByTimeAsync(2500);

        const result = await promise;
        expect(result).toEqual([{ id: 'u1' }]);
        expect(client.user.findMany).toHaveBeenCalledTimes(2);
        expect((manager as any).reconnectDatabase).toHaveBeenCalledTimes(1);
    });

    it('client 메서드가 connection 에러를 항상 throw 할 때 Proxy 가 재시도 한계 후 마지막 에러를 던진다', async () => {
        jest.useFakeTimers();
        const client = makeFlakeyClient(99); // 항상 fail
        (manager as any).databases.set('test', client);
        // reconnectDatabase 도 같은 패턴으로 만들어 재시도해도 계속 실패
        (manager as any).reconnectDatabase = jest.fn(async () => {
            // 교체하지 않음 — 동일 flakey client 유지
        });

        const wrap = manager.getWrap('test');
        const promise = wrap.user.findMany();

        // catch handler 를 미리 부착하여 unhandled rejection 방지
        const assertion = expect(promise).rejects.toThrow('Connection lost');

        // 모든 retry 사이의 setTimeout 진행 (3 retries: 2s + 3s + 4.5s = 9.5s, 여유롭게 20s)
        await jest.advanceTimersByTimeAsync(20000);

        await assertion;
        // maxRetries=3 이지만 attempt 0..3 까지 4번 시도
        expect(client.user.findMany).toHaveBeenCalledTimes(4);
    });

    it('client 메서드가 connection 이 아닌 에러를 throw 할 때 Proxy 가 재시도하지 않고 즉시 throw 한다', async () => {
        const client: any = {
            user: {
                findMany: jest.fn(async () => {
                    const err: any = new Error('Validation failed');
                    err.code = 'P2025'; // not a connection error (record not found)
                    throw err;
                })
            },
            $disconnect: jest.fn()
        };
        (manager as any).databases.set('test', client);

        const wrap = manager.getWrap('test');
        await expect(wrap.user.findMany()).rejects.toThrow('Validation failed');
        // 재시도 없이 즉시 throw — findMany 는 1번만 호출
        expect(client.user.findMany).toHaveBeenCalledTimes(1);
        expect((manager as any).reconnectDatabase).not.toHaveBeenCalled();
    });

    it('등록되지 않은 db 이름을 조회할 때 throw 한다', () => {
        expect(() => manager.getWrap('nonexistent')).toThrow(/nonexistent/);
    });
});
