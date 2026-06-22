import { isExtensionFile as loaderIsExtensionFile } from '@lib/extensions/loadExtensions';

const {
    isExtensionFile: codegenIsExtensionFile,
} = require('@/src/core/scripts/generate-extensions-map');

/**
 * SSOT 가드 (dev/build 발견 규칙 동치):
 * 활성화 파일 판별(isExtensionFile)이 두 곳에 존재한다 — TS 런타임 loadExtensions(dev fs 스캔)와
 * JS 빌드 codegen generate-extensions-map(.ts/.js 경계로 모듈을 공유할 수 없어 부득이 중복).
 * 둘이 어긋나면 빌드가 dev 와 다른 확장 집합을 등록하는 회귀(예: "GET_REACT is not a function")가
 * 재발한다. 이 테스트가 두 구현의 동치를 고정한다(한쪽만 바꾸면 CI 가 잡는다).
 * (참고: alias-consistency.test.ts 가 _moduleAliases↔tsconfig 를 같은 방식으로 가드한다.)
 */
describe('isExtensionFile 동치 — loadExtensions(TS) ↔ generate-extensions-map(JS)', () => {
    const samples = [
        'react.ts',
        'react.js',
        'react.d.ts',
        'index.ts',
        'index.js',
        'AGENTS.md',
        'AGENTS.ts',
        'notes.md',
        'auth.js',
        'x.mts',
        'x.cts',
        'x.tsx',
        'plain',
        '.hidden',
        'sub.module.ts',
    ];

    it.each(samples)('두 구현이 "%s" 를 동일하게 분류한다', (name) => {
        expect(codegenIsExtensionFile(name)).toBe(loaderIsExtensionFile(name));
    });

    it('계약 자체도 고정한다 (.ts/.js 만, .d.ts/index/AGENTS 제외, 그 외 확장자 제외)', () => {
        expect(loaderIsExtensionFile('react.ts')).toBe(true);
        expect(loaderIsExtensionFile('auth.js')).toBe(true);
        expect(loaderIsExtensionFile('sub.module.ts')).toBe(true);
        expect(loaderIsExtensionFile('react.d.ts')).toBe(false);
        expect(loaderIsExtensionFile('index.ts')).toBe(false);
        expect(loaderIsExtensionFile('AGENTS.ts')).toBe(false);
        expect(loaderIsExtensionFile('notes.md')).toBe(false);
        expect(loaderIsExtensionFile('x.mts')).toBe(false); // .ts/.js 가 아님
    });
});
