export {};
// Suppress CLI side effects before importing module:
// 1) program.parse(process.argv) at the bottom of kusto-db-cli.ts
//    interprets jest argv as CLI args and calls process.exit.
// 2) loadEnvironmentConfig() runs immediately at import.
const originalArgv = process.argv;
const originalExit = process.exit;
process.argv = ['node', 'kusto-db-cli'];
// @ts-ignore - mock exit during import
process.exit = ((code?: number) => undefined) as never;
// Silence noisy console output during import
const origErr = console.error;
const origLog = console.log;
console.error = () => {};
console.log = () => {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generateSecurityCode } = require('@/src/core/scripts/kusto-db-cli');

// Restore originals after import
process.argv = originalArgv;
process.exit = originalExit;
console.error = origErr;
console.log = origLog;

describe('generateSecurityCode', () => {
    it('호출될 때 [A-Z0-9]{4} 패턴의 문자열을 반환한다', () => {
        for (let i = 0; i < 100; i++) {
            const code = generateSecurityCode();
            expect(code).toMatch(/^[A-Z0-9]{4}$/);
        }
    });
});
