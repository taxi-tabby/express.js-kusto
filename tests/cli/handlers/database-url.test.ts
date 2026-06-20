export {};
// CLI 모듈은 import 시 program 정의/환경 로딩 등 top-level 부작용이 있으므로 억제한다.
const originalArgv = process.argv;
const originalExit = process.exit;
process.argv = ['node', 'kusto-db-cli'];
// @ts-ignore - mock exit during import
process.exit = ((code?: number) => undefined) as never;
const origErr = console.error;
const origLog = console.log;
console.error = () => {};
console.log = () => {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDatabaseUrl, getDatabaseEnvVarName } = require('@/src/core/scripts/kusto-db-cli');

process.argv = originalArgv;
process.exit = originalExit;
console.error = origErr;
console.log = origLog;

/**
 * 회귀 (CI generate 실패):
 * CI 에서 `npm run db -- generate -a` 가 깨졌던 근본 원인은 DEFAULT__KUSTO_RDB_URL 미설정으로
 * getDatabaseUrl('default') 가 undefined → CLI 가 "Database URL not found" 를 던졌고,
 * 그 결과 client 가 생성되지 않아 후속 tsc 가 `@app/db/default/client` 를 못 찾은 것이다.
 * CI 는 더미 env 를 임의 지정해 이 URL 검사 경로를 통과시킨다. 아래 테스트는
 * "env 가 있으면 통과 / 없으면 undefined" 라는 그 해소 메커니즘을 회귀로 고정한다.
 */
describe('getDatabaseUrl — env 기반 DB URL 해소 (CI generate 회귀)', () => {
    const KEY = getDatabaseEnvVarName('default'); // 'DEFAULT__KUSTO_RDB_URL'
    let saved: string | undefined;

    beforeEach(() => { saved = process.env[KEY]; });
    afterEach(() => {
        if (saved === undefined) delete process.env[KEY];
        else process.env[KEY] = saved;
    });

    it('해당 env 가 설정되어 있으면 그 값을 반환한다 (CI 더미 env 가 통하는 이유)', () => {
        const dummy = 'postgresql://ci:ci@127.0.0.1:5432/ci_dummy';
        process.env[KEY] = dummy;
        expect(getDatabaseUrl('default')).toBe(dummy);
    });

    it('해당 env 가 없으면 undefined 를 반환한다 (CLI 가 "Database URL not found" 를 던지는 조건)', () => {
        delete process.env[KEY];
        expect(getDatabaseUrl('default')).toBeUndefined();
    });

    it('빈 문자열 env 는 falsy 이므로 URL 미설정과 동일하게 취급된다', () => {
        process.env[KEY] = '';
        // CLI 의 `if (!databaseUrl)` 가 빈 문자열도 미설정으로 본다.
        expect(getDatabaseUrl('default') || undefined).toBeUndefined();
    });

    it('폴더명별 env 키를 사용한다 (myData → MY_DATA__KUSTO_RDB_URL)', () => {
        const k = getDatabaseEnvVarName('myData');
        const prev = process.env[k];
        process.env[k] = 'postgresql://x';
        try {
            expect(getDatabaseUrl('myData')).toBe('postgresql://x');
        } finally {
            if (prev === undefined) delete process.env[k];
            else process.env[k] = prev;
        }
    });
});
