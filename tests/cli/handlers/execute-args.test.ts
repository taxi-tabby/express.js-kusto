export {};
// CLI 모듈은 import 시 program.parse(process.argv) 등 top-level 부작용이 있으므로 억제한다.
const originalArgv = process.argv;
const originalExit = process.exit;
process.argv = ['node', 'kusto-db-cli'];
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - mock exit during import
process.exit = ((_code?: number) => undefined) as never;
const origErr = console.error;
const origLog = console.log;
console.error = () => {};
console.log = () => {};

const { buildExecuteArgs, getDatabaseEnvVarName } = require('@/src/core/scripts/kusto-db-cli');

const { folderNameToEnvVarName } = require('@lib/data/database/dbNaming');

process.argv = originalArgv;
process.exit = originalExit;
console.error = origErr;
console.log = origLog;

/**
 * P1-8 회귀 테스트: execute -c 의 SQL 은 셸 문자열이 아니라 stdin 으로 전달되어야 한다.
 * (과거 `echo "${command}" | npx ...` 는 따옴표/`$()`/`;` 로 임의 OS 명령 주입이 가능했다.)
 */
describe('buildExecuteArgs (P1-8 — no shell injection)', () => {
    const SCHEMA = '/repo/src/app/db/default/schema.prisma';
    const CONFIG = '/repo/prisma.config.default.ts';

    it('SQL --command 는 stdin 으로 전달하고 args 에는 평문 SQL 이 들어가지 않는다', () => {
        const malicious = 'SELECT 1; DROP TABLE users; --"$(rm -rf /)`whoami`';
        const { args, stdin } = buildExecuteArgs({ command: malicious }, SCHEMA, CONFIG);

        // SQL 은 stdin 으로만 전달
        expect(stdin).toBe(malicious);
        // args 에는 --stdin 플래그만, 평문 SQL 은 절대 포함되지 않음
        expect(args).toContain('--stdin');
        expect(args.some((a: string) => a.includes('DROP TABLE') || a.includes('rm -rf'))).toBe(
            false,
        );
        // echo 셸 파이프 흔적이 전혀 없어야 함
        expect(args.some((a: string) => a.includes('echo') || a.includes('|'))).toBe(false);
    });

    it('--file 경로는 공백이 있어도 단일 argv 요소로 유지된다', () => {
        const file = '/tmp/my migration file.sql';
        const { args, stdin } = buildExecuteArgs({ file }, SCHEMA, CONFIG);
        expect(stdin).toBeUndefined();
        expect(args).toContain('--file');
        // 경로가 쪼개지지 않고 정확히 하나의 요소로 존재
        expect(args.filter((a: string) => a === file)).toHaveLength(1);
    });

    it('schema/config 경로는 개별 argv 요소로 분리된다', () => {
        const { args } = buildExecuteArgs({ command: 'SELECT 1' }, SCHEMA, CONFIG);
        expect(args).toEqual(expect.arrayContaining(['--schema', SCHEMA, '--config', CONFIG]));
    });
});

/**
 * P1-10a 회귀 테스트: CLI 의 getDatabaseEnvVarName 은 단일 출처와 동일 결과를 낸다.
 */
describe('getDatabaseEnvVarName delegates to canonical folderNameToEnvVarName (P1-10a)', () => {
    it.each(['default', 'myData', 'user_account', 'APIClient', ''])(
        'is equivalent for "%s"',
        (input) => {
            expect(getDatabaseEnvVarName(input)).toBe(folderNameToEnvVarName(input));
        },
    );
});
