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

 
const {
    extractTableName,
    extractAlterAddColumn,
    extractIndexName,
} = require('@/src/core/scripts/kusto-db-cli');

process.argv = originalArgv;
process.exit = originalExit;
console.error = origErr;
console.log = origLog;

describe('extractTableName', () => {
    it('CREATE TABLE 문이 더블쿼트로 감싼 이름과 unquoted 이름 둘 다 같은 결과를 반환한다', () => {
        expect(extractTableName('CREATE TABLE "users" (id INT)')).toBe('users');
        expect(extractTableName('CREATE TABLE users (id INT)')).toBe('users');
    });
});

describe('extractAlterAddColumn', () => {
    it('표준 ALTER TABLE ADD COLUMN 문이 들어올 때 tableName 과 columnName 을 분리한다', () => {
        const result = extractAlterAddColumn('ALTER TABLE users ADD COLUMN email TEXT');
        expect(result).toEqual({ tableName: 'users', columnName: 'email' });
    });
});

describe('extractIndexName', () => {
    it('CREATE INDEX 문이 들어올 때 인덱스 이름을 반환한다', () => {
        const result = extractIndexName('CREATE INDEX idx_users_email ON users (email)');
        expect(result).toBe('idx_users_email');
    });
});
