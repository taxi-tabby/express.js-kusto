import * as fs from 'fs';
import * as path from 'path';

/**
 * 경로 별칭 단일 소스 정합성 가드.
 *
 * tsconfig.json 의 compilerOptions.paths 가 별칭의 단일 소스다.
 * - jest 는 pathsToModuleNameMapper 로, webpack 은 buildAliasesFromTsconfig 로 tsconfig 에서 파생하므로
 *   구조적으로 drift 할 수 없다(이 테스트 스위트가 import 를 해석해 실행되는 것 자체가 jest 파생의 증거).
 * - 런타임용 package.json `_moduleAliases` 만 유일한 수기 사본이므로, 여기서 tsconfig 와 동치를 강제한다.
 */
const root = path.resolve(__dirname, '..', '..', '..');

const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf-8')) as {
    compilerOptions: { paths: Record<string, string[]> };
};
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
    _moduleAliases: Record<string, string>;
};

/** "@lib/*" → "@lib", "src/core/lib/*"|"./src/core/lib" → "src/core/lib", "./*"|"./"|"." → "" (root). */
const normTarget = (t: string): string =>
    t.replace(/\/\*$/, '').replace(/^\.\//, '').replace(/^\.$/, '').replace(/\/$/, '');
const normKey = (k: string): string => k.replace(/\/\*$/, '');

describe('경로 별칭 단일 소스 정합성', () => {
    const tsPaths = tsconfig.compilerOptions.paths;
    const moduleAliases = pkg._moduleAliases;

    it('tsconfig 의 모든 별칭이 package.json _moduleAliases 에 동일 대상으로 존재', () => {
        for (const [key, targets] of Object.entries(tsPaths)) {
            const alias = normKey(key);
            expect(targets.length).toBe(1);
            expect(moduleAliases[alias]).toBeDefined();
            expect(normTarget(moduleAliases[alias])).toBe(normTarget(targets[0]));
        }
    });

    it('package.json _moduleAliases 에 tsconfig 에 없는 별칭이 없음', () => {
        for (const alias of Object.keys(moduleAliases)) {
            const tsEntry = tsPaths[`${alias}/*`] ?? tsPaths[alias];
            expect(tsEntry).toBeDefined();
        }
    });

    it('기대하는 핵심 별칭이 모두 정의되어 있음', () => {
        for (const alias of ['@', '@app', '@core', '@lib', '@ext', '@db', '@tests']) {
            expect(tsPaths[`${alias}/*`]).toBeDefined();
            expect(moduleAliases[alias]).toBeDefined();
        }
    });

    it('webpack resolve.alias 도 tsconfig 에서 동일하게 파생됨', () => {
        // webpack.config.js 의 자체 파생 로직(buildAliasesFromTsconfig)이 tsconfig 와 일치하는지 검증.
        // jest 파생은 이 스위트 실행 자체가 증거지만, webpack 파생은 별도 코드이므로 명시적으로 확인한다.

        const wpConfig = require(path.join(root, 'webpack.config.js'))({}, { mode: 'production' });
        const wpAlias = wpConfig.resolve.alias as Record<string, string>;

        expect(Object.keys(wpAlias).sort()).toEqual(Object.keys(tsPaths).map(normKey).sort());
        for (const [key, targets] of Object.entries(tsPaths)) {
            const alias = normKey(key);
            expect(wpAlias[alias]).toBeDefined();
            expect(path.resolve(wpAlias[alias])).toBe(path.resolve(root, normTarget(targets[0])));
        }
    });
});
