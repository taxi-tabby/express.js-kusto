/**
 * 테스트별 process.env 격리 헬퍼.
 *
 * 사용 예:
 * ```
 * import { snapshotEnv } from '@tests/_setup/env-fixture';
 * describe('...', () => {
 *   const restoreEnv = snapshotEnv();
 *   afterEach(() => restoreEnv());
 *   it('...', () => { process.env.X = 'y'; ... });
 * });
 * ```
 */
export function snapshotEnv(): () => void {
    const original = { ...process.env };
    return () => {
        // 새로 추가된 키 제거
        for (const key of Object.keys(process.env)) {
            if (!(key in original)) {
                delete process.env[key];
            }
        }
        // 원래 값 복원
        for (const [key, value] of Object.entries(original)) {
            process.env[key] = value;
        }
    };
}

/**
 * 특정 env 만 임시로 설정하고 끝나면 복원하는 헬퍼.
 *
 * 사용 예:
 * ```
 * await withEnv({ NODE_ENV: 'test' }, async () => { ... });
 * ```
 */
export async function withEnv<T>(
    overrides: Record<string, string | undefined>,
    fn: () => T | Promise<T>
): Promise<T> {
    const original: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
        original[key] = process.env[key];
        if (overrides[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = overrides[key];
        }
    }
    try {
        return await fn();
    } finally {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}
