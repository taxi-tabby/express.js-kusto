export {};

const { buildExtensionsMapContent } = require('@/src/core/scripts/generate-extensions-map');

/**
 * 회귀 (빌드에서 확장 메서드 누락):
 * `loadExtensions` 는 dev 에서 src/app/extensions/*.ts 를 런타임 fs 스캔 + require 하지만,
 * webpack 번들엔 그 파일들이 들어가지 않아(codegen/복사 없음) 빌드 실행 시 확장 메서드
 * (예: GET_REACT)가 등록되지 않는다 → 라우트가 "GET_REACT is not a function" 으로 깨진다.
 * 라우트(routes-map)와 동일하게, 빌드타임에 확장을 정적 import 하는 extensions-map 을 생성해
 * webpack 이 번들하도록 한다. 이 함수가 그 코드 생성의 순수 단일 출처(SSOT)다.
 */
describe('buildExtensionsMapContent — 확장 맵 코드 생성 (빌드 회귀)', () => {
    it('확장이 0개면 유효한 빈 맵을 생성한다 (extensions = [])', () => {
        const out = buildExtensionsMapContent([]);
        expect(out).toContain('export const extensions = [];');
        expect(out).not.toContain('import '); // 없는 모듈 import 금지
    });

    it('확장이 있으면 정적 default import + 배열을 생성한다', () => {
        const out = buildExtensionsMapContent(['../../app/extensions/react']);
        expect(out).toContain("import ext_0 from '../../app/extensions/react';");
        expect(out).toContain('export const extensions = [ext_0];');
    });

    it('확장이 여럿이면 순서대로 import 하고 배열에 모은다', () => {
        const out = buildExtensionsMapContent([
            '../../app/extensions/auth',
            '../../app/extensions/react',
        ]);
        expect(out).toContain("import ext_0 from '../../app/extensions/auth';");
        expect(out).toContain("import ext_1 from '../../app/extensions/react';");
        expect(out).toContain('export const extensions = [ext_0, ext_1];');
    });

    it('생성된 코드는 .ts 확장자를 import 경로에 남기지 않는다', () => {
        const out = buildExtensionsMapContent(['../../app/extensions/react']);
        expect(out).not.toMatch(/from '[^']*\.ts'/);
    });
});
