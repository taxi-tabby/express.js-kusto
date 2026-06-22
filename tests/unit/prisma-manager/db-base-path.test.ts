import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { getAppDbBasePath } from '@lib/data/database/prismaManager';

describe('getAppDbBasePath — dist-aware DB folder base', () => {
    const ORIG = { WEBPACK_BUILD: process.env.WEBPACK_BUILD, NODE_ENV: process.env.NODE_ENV };
    afterEach(() => {
        if (ORIG.WEBPACK_BUILD === undefined) delete process.env.WEBPACK_BUILD;
        else process.env.WEBPACK_BUILD = ORIG.WEBPACK_BUILD;
        if (ORIG.NODE_ENV === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = ORIG.NODE_ENV;
    });

    it('dev(소스 트리): WEBPACK_BUILD 미설정 → src/app/db', () => {
        delete process.env.WEBPACK_BUILD;
        process.env.NODE_ENV = 'development';
        expect(getAppDbBasePath('/proj')).toBe(path.join('/proj', 'src', 'app', 'db'));
    });

    it('번들: WEBPACK_BUILD=true → dist/src/app/db', () => {
        process.env.WEBPACK_BUILD = 'true';
        expect(getAppDbBasePath('/proj')).toBe(path.join('/proj', 'dist', 'src', 'app', 'db'));
    });

    it('production + dist/server.js 존재 → dist/src/app/db (WEBPACK_BUILD 없어도)', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kusto-dbpath-'));
        fs.mkdirSync(path.join(tmp, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'dist', 'server.js'), '');
        delete process.env.WEBPACK_BUILD;
        process.env.NODE_ENV = 'production';
        try {
            expect(getAppDbBasePath(tmp)).toBe(path.join(tmp, 'dist', 'src', 'app', 'db'));
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('production 인데 dist/server.js 부재 → 소스 트리로 폴백', () => {
        delete process.env.WEBPACK_BUILD;
        process.env.NODE_ENV = 'production';
        expect(getAppDbBasePath('/no-such-proj-xyz')).toBe(
            path.join('/no-such-proj-xyz', 'src', 'app', 'db'),
        );
    });
});
