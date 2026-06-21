import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * 회귀 (DB-less 부팅 — 헤드라인 동작):
 * PrismaManager.initialize() 는 src/app/db 가 없거나 비어 있으면 과거처럼
 * `throw new Error('Database directory not found')` 하지 않고, 0개 DB 로 정상 부팅한다
 * (initialized=true, 로그, return). 이 테스트는 헬퍼(listDatabaseFolders)가 아니라
 * 실제 initialize() 본문의 빈 분기를 end-to-end 로 고정한다 — 그래야 그 분기가 다시 throw
 * 하도록 회귀하면 테스트가 잡아낸다.
 *
 * 방법: src/app/db 가 없는 임시 디렉터리를 cwd 로 위장(process.cwd 스파이)한다. fs 자체는
 * 모킹하지 않으므로(ESM 네임스페이스 sealed) 실제 파일시스템 분기를 그대로 탄다.
 */
describe('PrismaManager.initialize() — DB-less 부팅', () => {
    it('src/app/db 가 없으면 throw 하지 않고 0개 DB 로 부팅한다', async () => {
        const realCwd = process.cwd();
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kusto-dbless-cwd-'));
        const prevNodeEnv = process.env.NODE_ENV;
        const prevLogDir = process.env.LOG_DIR;

        process.env.NODE_ENV = 'test';
        // winston 은 실제 로그 디렉터리에 쓰게 둔다(임시 cwd 에 파일 핸들 남기지 않도록)
        process.env.LOG_DIR = path.join(realCwd, 'logs');
        const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpRoot);

        try {
            // cwd 스파이가 적용된 상태에서 로드해야 생성자/initialize 가 임시 cwd 를 본다
             
            const { prismaManager } = require('@lib/data/database/prismaManager');

            await expect(prismaManager.initialize()).resolves.toBeUndefined();

            const status = prismaManager.getStatus();
            expect(status.initialized).toBe(true);
            expect(status.totalDatabases).toBe(0);
            expect(prismaManager.getAvailableDatabases()).toEqual([]);
        } finally {
            cwdSpy.mockRestore();
            process.env.NODE_ENV = prevNodeEnv;
            if (prevLogDir === undefined) delete process.env.LOG_DIR;
            else process.env.LOG_DIR = prevLogDir;
            try {
                fs.rmSync(tmpRoot, { recursive: true, force: true });
            } catch {
                /* 정리 실패는 무시 */
            }
        }
    });
});
