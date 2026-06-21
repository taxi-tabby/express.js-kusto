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
const { getDatabaseUrl, getDatabaseEnvVarName, commandNeedsDatabaseUrl } = require('@/src/core/scripts/kusto-db-cli');

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

/**
 * 회귀 (Docker/클라우드 빌드 실패):
 * `.env` 없이 OS 환경변수만으로 배포하는 Docker 빌드에서 `npm run db -- generate --all` 이
 * "Database URL not found" 로 죽었다. 근본 원인은 executePrismaCommand 가 generate 에도
 * DB URL 을 무조건 요구했기 때문이다. 하지만 prisma generate 는 스키마만으로 클라이언트를
 * 생성하고 DB 에 연결하지 않으므로 URL 이 필요 없다(format/validate 도 동일). URL 은 임시
 * prisma.config.ts 를 만들어 실제 연결하는 커맨드(migrate/db push 등)에서만 요구해야 한다.
 * 이 함수가 그 "URL 필요 여부" 판정의 단일 출처(SSOT)다.
 */
describe('commandNeedsDatabaseUrl — generate/format/validate 는 DB URL 불필요 (빌드 회귀)', () => {
    it('generate 는 URL 이 필요 없다 (스키마만으로 생성, DB 연결 안 함)', () => {
        expect(commandNeedsDatabaseUrl('generate')).toBe(false);
    });

    it('format 은 URL 이 필요 없다', () => {
        expect(commandNeedsDatabaseUrl('format')).toBe(false);
    });

    it('validate 는 URL 이 필요 없다', () => {
        expect(commandNeedsDatabaseUrl('validate')).toBe(false);
    });

    it('migrate 계열은 URL 이 필요하다 (실제 연결 → 임시 config)', () => {
        expect(commandNeedsDatabaseUrl('migrate deploy')).toBe(true);
        expect(commandNeedsDatabaseUrl('migrate reset --force')).toBe(true);
    });

    it('db push/pull 은 URL 이 필요하다', () => {
        expect(commandNeedsDatabaseUrl('db push --accept-data-loss')).toBe(true);
        expect(commandNeedsDatabaseUrl('db pull')).toBe(true);
    });
});
