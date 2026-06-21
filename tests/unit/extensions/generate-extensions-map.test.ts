export {};

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const {
    buildExtensionsMapContent,
    resolveImportSpecifiers,
} = require('@/src/core/scripts/generate-extensions-map');

/**
 * 회귀 (빌드에서 확장 메서드 누락):
 * `loadExtensions` 는 dev 에서 src/app/extensions/*.ts 를 런타임 fs 스캔 + require 하지만,
 * webpack 번들엔 그 파일들이 들어가지 않아(codegen/복사 없음) 빌드 실행 시 확장 메서드
 * (예: GET_REACT)가 등록되지 않는다 → 라우트가 "GET_REACT is not a function" 으로 깨진다.
 * 라우트(routes-map)와 동일하게, 빌드타임에 확장을 정적 import 하는 extensions-map 을 생성해
 * webpack 이 번들하도록 한다. 이 모듈이 그 코드 생성의 단일 출처(SSOT)다.
 */
describe('buildExtensionsMapContent — 확장 맵 코드 생성 (verbatim emit)', () => {
    it('확장이 0개면 유효한 빈 맵을 생성한다 (extensions/extensionSources 모두 [])', () => {
        const out = buildExtensionsMapContent([]);
        expect(out).toContain('export const extensions = [];');
        expect(out).toContain('export const extensionSources = [];');
        expect(out).not.toContain('import '); // 없는 모듈 import 금지
    });

    it('받은 specifier 를 그대로 default import 하고 extensions 배열에 모은다', () => {
        const out = buildExtensionsMapContent(['../../app/extensions/react']);
        expect(out).toContain("import ext_0 from '../../app/extensions/react';");
        expect(out).toContain('export const extensions = [ext_0];');
    });

    it('extensionSources 를 extensions 와 1:1 인덱스로 emit 한다 (진단 라벨용)', () => {
        const out = buildExtensionsMapContent([
            '../../app/extensions/auth',
            '../../app/extensions/react',
        ]);
        expect(out).toContain('export const extensions = [ext_0, ext_1];');
        expect(out).toContain(
            'export const extensionSources = ["../../app/extensions/auth", "../../app/extensions/react"];',
        );
    });

    it('specifier 를 가공하지 않고 그대로 emit 한다 (확장자 처리는 resolveImportSpecifiers 책임)', () => {
        // buildExtensionsMapContent 는 변환을 하지 않는다 — .ts 가 들어오면 .ts 가 그대로 나온다.
        const out = buildExtensionsMapContent(['../../app/extensions/react.ts']);
        expect(out).toContain("import ext_0 from '../../app/extensions/react.ts';");
    });
});

/**
 * resolveImportSpecifiers 가 빌드의 핵심 변환부다 — 활성화 파일 발견(.d.ts/index/AGENTS 제외),
 * 결정적 정렬, OUTPUT_FILE 기준 상대경로화, 백슬래시 정규화, .ts/.js 확장자 제거. 이 변환이
 * 틀어지면 webpack/ts-node 모듈 해석이 깨지므로 실제 파일시스템(임시 디렉터리)으로 검증한다.
 */
describe('resolveImportSpecifiers — 발견 + 경로 변환 (빌드 핵심)', () => {
    let tmp: string;
    const fakeOutput = path.join(os.tmpdir(), '__kusto_fake_tmp__', 'extensions-map.ts');

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kusto-extmap-'));
    });
    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    const write = (name: string) => fs.writeFileSync(path.join(tmp, name), '');

    it('디렉터리가 없으면 빈 배열', () => {
        expect(resolveImportSpecifiers(path.join(tmp, 'nope'), fakeOutput)).toEqual([]);
    });

    it('.d.ts/index/AGENTS/비-ts·js 는 제외하고, 정렬된 활성화 파일만 반환한다', () => {
        [
            'react.ts',
            'auth.js',
            'helper.d.ts',
            'index.ts',
            'AGENTS.md',
            'notes.md',
            'data.json',
        ].forEach(write);
        const specs = resolveImportSpecifiers(tmp, fakeOutput);
        // basename(확장자 제거됨) 기준 — auth, react 만, localeCompare 정렬
        expect(specs.map((s: string) => s.split('/').pop())).toEqual(['auth', 'react']);
    });

    it('.ts/.js 확장자를 제거하고, 백슬래시를 슬래시로 정규화하며, 상대경로로 시작한다', () => {
        write('react.ts');
        const [spec] = resolveImportSpecifiers(tmp, fakeOutput);
        expect(spec).not.toMatch(/\.(ts|js)$/); // 확장자 제거 (이게 빠지면 webpack 해석 실패)
        expect(spec).not.toContain('\\'); // 슬래시 정규화 (Windows)
        expect(spec.startsWith('.')).toBe(true); // 상대 import
        expect(spec.split('/').pop()).toBe('react');
    });
});
