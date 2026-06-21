export {};
// Suppress CLI side effects before importing the module
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

 
const { getDatabaseEnvVarName } = require('@/src/core/scripts/kusto-db-cli');

process.argv = originalArgv;
process.exit = originalExit;
console.error = origErr;
console.log = origLog;

describe('getDatabaseEnvVarName', () => {
    it('단순 폴더명 default 일 때 DEFAULT__KUSTO_RDB_URL 을 반환한다', () => {
        expect(getDatabaseEnvVarName('default')).toBe('DEFAULT__KUSTO_RDB_URL');
    });

    it('camelCase 폴더명 myData 일 때 MY_DATA__KUSTO_RDB_URL 을 반환한다', () => {
        expect(getDatabaseEnvVarName('myData')).toBe('MY_DATA__KUSTO_RDB_URL');
    });

    it('이미 snake_case 인 폴더명 user_account 일 때 USER_ACCOUNT__KUSTO_RDB_URL 을 반환한다', () => {
        expect(getDatabaseEnvVarName('user_account')).toBe('USER_ACCOUNT__KUSTO_RDB_URL');
    });
});
