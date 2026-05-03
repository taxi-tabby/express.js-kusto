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
const { generateRollbackSQL } = require('@/src/core/scripts/kusto-db-cli');

process.argv = originalArgv;
process.exit = originalExit;
console.error = origErr;
console.log = origLog;

describe('generateRollbackSQL', () => {
    it('CREATE TABLE 문이 들어올 때 DROP TABLE 문을 반환한다', () => {
        const result = generateRollbackSQL('CREATE TABLE users (id INT, name TEXT)');
        expect(result).toMatch(/DROP TABLE.*users/i);
    });

    it('ALTER TABLE ADD COLUMN 문이 들어올 때 DROP COLUMN 문을 포함한다', () => {
        const result = generateRollbackSQL('ALTER TABLE users ADD COLUMN email TEXT');
        expect(result).toMatch(/ALTER TABLE.*users.*DROP COLUMN.*email/i);
    });
});
