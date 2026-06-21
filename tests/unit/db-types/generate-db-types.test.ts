export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildDatabaseTypesContent } = require('@/src/core/scripts/generate-db-types');

/**
 * 회귀 (DB-less 빌드):
 * DB 를 쓰지 않는 서비스(src/app/db 부재/빈 폴더)에서도 `npm run generate` 가 유효한 타입 파일을
 * 만들어야 typecheck 가 통과한다. 과거에는 DB 가 0개면 `export type DatabaseNamesUnion = ;` 같은
 * 잘못된 TS 가 생성됐고(빈 union), 디렉터리 부재 시에는 파일을 아예 안 써서 없는 client 를 참조하던
 * stale 타입이 남아 깨졌다. 코드 생성 본문(순수 함수)이 그 계약의 단일 출처다.
 */
describe('buildDatabaseTypesContent — DB 타입 코드 생성 (DB-less 빌드 회귀)', () => {
    it('DB 가 0개면 유효한 TS 를 생성한다 (DatabaseNamesUnion = never)', () => {
        const out = buildDatabaseTypesContent([]);
        expect(out).toContain('export type DatabaseNamesUnion = never;');
    });

    it('DB 가 0개면 깨진 빈 union(= ;) 을 만들지 않는다', () => {
        const out = buildDatabaseTypesContent([]);
        expect(out).not.toMatch(/=\s*;/);
    });

    it('DB 가 0개면 client import 가 없다 (없는 모듈 참조 금지)', () => {
        const out = buildDatabaseTypesContent([]);
        expect(out).not.toContain("from '@app/db/");
    });

    it('DB 가 있으면 해당 client import 와 union 을 생성한다', () => {
        const out = buildDatabaseTypesContent(['default']);
        expect(out).toContain(
            "import { PrismaClient as DefaultPrismaClient } from '@app/db/default/client';",
        );
        expect(out).toContain("export type DatabaseNamesUnion = 'default';");
    });

    it('DB 가 여럿이면 union 을 | 로 잇는다', () => {
        const out = buildDatabaseTypesContent(['default', 'analytics']);
        expect(out).toContain("export type DatabaseNamesUnion = 'default' | 'analytics';");
    });
});
