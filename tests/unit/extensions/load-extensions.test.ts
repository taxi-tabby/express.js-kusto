import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExpressRouter } from '@lib/http/routing/expressRouter';
import { extensionRegistry } from '@lib/extensions/extensionRegistry';
import { loadExtensions } from '@lib/extensions/loadExtensions';

/**
 * loadExtensions — CoC 발견. 임시 폴더에 .js 활성화 파일을 써서
 * 발견/검증/메서드 등록/스킵 규칙/순서/no-op 을 검증한다.
 */
describe('loadExtensions (CoC 발견)', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kusto-ext-'));
    });
    afterEach(() => {
        ExpressRouter.clearExtensionMethods();
        extensionRegistry.clear();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    const writeExt = (file: string, body: string) => fs.writeFileSync(path.join(tmp, file), body);

    it('폴더가 없으면 no-op([]) 이다', () => {
        expect(loadExtensions(path.join(tmp, 'does-not-exist'))).toEqual([]);
    });

    it('default export 확장을 발견·등록하고 routerMethods 를 적용한다', () => {
        writeExt(
            'a.js',
            `module.exports.default = { name: 'ext-a', routerMethods: { GET_AAA: function (ctx) {} } };`,
        );
        const loaded = loadExtensions(tmp);
        expect(loaded.map((e) => e.name)).toEqual(['ext-a']);
        expect(extensionRegistry.getAll().length).toBe(1);
        expect(typeof (ExpressRouter.prototype as any).GET_AAA).toBe('function');
    });

    it('.d.ts / index / AGENTS 파일은 무시한다', () => {
        writeExt('index.js', `module.exports.default = { name: 'idx' };`);
        writeExt('AGENTS.js', `module.exports.default = { name: 'agents' };`);
        writeExt('types.d.ts', `export {};`);
        writeExt('real.js', `module.exports.default = { name: 'real' };`);
        const loaded = loadExtensions(tmp);
        expect(loaded.map((e) => e.name)).toEqual(['real']);
    });

    it('잘못된 default export 는 명확한 에러로 throw 한다', () => {
        writeExt('bad.js', `module.exports.default = { nope: true };`);
        expect(() => loadExtensions(tmp)).toThrow(/valid KustoExtension/);
    });

    it('파일명 순서로 로드한다', () => {
        writeExt('b.js', `module.exports.default = { name: 'b' };`);
        writeExt('a.js', `module.exports.default = { name: 'a' };`);
        const loaded = loadExtensions(tmp);
        expect(loaded.map((e) => e.name)).toEqual(['a', 'b']);
    });

    it('이름이 같은 확장은 건너뛰어 loaded[] 와 레지스트리가 일치한다', () => {
        writeExt('a.js', `module.exports.default = { name: 'dup' };`);
        writeExt('b.js', `module.exports.default = { name: 'dup' };`);
        const loaded = loadExtensions(tmp);
        expect(loaded.map((e) => e.name)).toEqual(['dup']);
        expect(extensionRegistry.getAll().length).toBe(1);
    });
});
