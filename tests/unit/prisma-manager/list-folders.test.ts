import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listDatabaseFolders } from '@lib/data/database/prismaManager';

/**
 * 회귀 (DB-less 서비스):
 * DB 를 쓰지 않는 서비스는 src/app/db 디렉터리가 아예 없을 수 있다. 과거 prismaManager.initialize()
 * 는 디렉터리 부재 시 `throw new Error('Database directory not found')` 했고, Core 가 이를 잡아
 * _degraded.prisma 를 채워 /healthz 가 영구 503(degraded) 이 되었다 — DB 를 의도적으로 안 쓰는
 * 앱에는 잘못된 상태다. 폴더 목록 해소를 단일 함수로 분리하고, "디렉터리 없음 = DB 없음(빈 목록)"
 * 으로 취급해 throw 하지 않는 것이 이 회귀의 핵심이다.
 */
describe('listDatabaseFolders — DB-less 허용 (디렉터리 부재 = DB 없음)', () => {
    it('존재하지 않는 경로면 throw 하지 않고 빈 배열을 반환한다', () => {
        const result = listDatabaseFolders(path.join(process.cwd(), '__no_such_db_dir__'));
        expect(result).toEqual([]);
    });

    it('실제 src/app/db 경로면 폴더 목록을 반환한다 (default 포함)', () => {
        const dbs = listDatabaseFolders(path.join(process.cwd(), 'src', 'app', 'db'));
        expect(Array.isArray(dbs)).toBe(true);
        expect(dbs).toContain('default');
    });

    it('디렉터리가 있어도 하위 폴더가 없으면(파일만) 빈 배열을 반환한다', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kusto-dbless-'));
        try {
            fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '# not a database');
            fs.writeFileSync(path.join(tmp, '.keep'), '');
            expect(listDatabaseFolders(tmp)).toEqual([]);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('파일은 제외하고 하위 디렉터리만 반환한다 (isDirectory 필터 고정)', () => {
        // 실제 src/app/db 는 하위 폴더(default)와 파일(AGENTS.md/.keep)이 혼재한다.
        // isDirectory() 필터가 빠지면 이 단언이 실패한다.
        const dbs = listDatabaseFolders(path.join(process.cwd(), 'src', 'app', 'db'));
        expect(dbs).toContain('default');
        expect(dbs).not.toContain('AGENTS.md');
        expect(dbs).not.toContain('.keep');
    });
});
