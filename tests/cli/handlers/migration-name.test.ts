// Suppress CLI side effects before importing the module
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
const {
    parseMigrationName,
    validateMigrationTarget
} = require('@/src/core/scripts/kusto-db-cli');

process.argv = originalArgv;
process.exit = originalExit;
console.error = origErr;
console.log = origLog;

describe('parseMigrationName', () => {
    it('표준 디렉토리명 20240101_create_users 일 때 timestamp 와 name 을 분리한다', () => {
        const result = parseMigrationName('20240101_create_users');
        expect(result).toEqual({ timestamp: '20240101', name: 'create_users' });
    });
});

describe('validateMigrationTarget', () => {
    it('migrate -t 인자가 존재하지 않는 db 와 큰 인덱스일 때 null 또는 string 메시지를 반환하고 throw 하지 않는다', () => {
        // validateMigrationTarget calls console.error / console.log internally;
        // silence them inside the test as well so the suite output stays clean.
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const result = validateMigrationTarget('_nonexistent_db_xyz', '9999');
            expect(result === null || typeof result === 'string').toBe(true);
        } finally {
            errSpy.mockRestore();
            logSpy.mockRestore();
        }
    });
});
