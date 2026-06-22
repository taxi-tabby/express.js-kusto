import { bundledExtensionsToDiscovered } from '@lib/extensions/loadExtensions';

/**
 * 회귀 (이 수정의 핵심 계약 — 빌드 분기):
 * 빌드(webpack)에서 loadExtensions 는 fs 스캔 대신 번들된 @core/tmp/extensions-map 의
 * `{ extensions, extensionSources }` 를 읽어 등록한다. 그 매핑 로직(빈/누락 폴백, 진단 라벨)을
 * 순수 함수로 분리해 env/fs 변이 없이 고정한다 — 이게 틀어지면 빌드 서버에서
 * "GET_REACT is not a function" 회귀가 나지만 dev 경로 테스트로는 잡히지 않는다.
 * (require('@core/tmp/extensions-map') 배선 자체는 빌드+serve E2E 로 검증된다.)
 */
describe('bundledExtensionsToDiscovered — 빌드 맵 → 발견 목록 매핑', () => {
    it('extensions 가 있으면 extensionSources 를 source 라벨로 매핑한다', () => {
        const ext = { name: 'react-ext', routerMethods: {} };
        const out = bundledExtensionsToDiscovered({
            extensions: [ext],
            extensionSources: ['../../app/extensions/react'],
        });
        expect(out).toEqual([{ source: '../../app/extensions/react', exported: ext }]);
    });

    it('여럿이면 인덱스로 1:1 매핑하고 순서를 보존한다', () => {
        const a = { name: 'a' };
        const b = { name: 'b' };
        const out = bundledExtensionsToDiscovered({
            extensions: [a, b],
            extensionSources: ['../auth', '../react'],
        });
        expect(out.map((d) => d.source)).toEqual(['../auth', '../react']);
        expect(out.map((d) => d.exported)).toEqual([a, b]);
    });

    it('extensions 가 비면 [] 이다', () => {
        expect(bundledExtensionsToDiscovered({ extensions: [], extensionSources: [] })).toEqual([]);
    });

    it('extensions export 가 없으면(undefined/배열 아님) [] 로 폴백한다', () => {
        expect(bundledExtensionsToDiscovered({})).toEqual([]);
        expect(bundledExtensionsToDiscovered(undefined)).toEqual([]);
        expect(bundledExtensionsToDiscovered({ extensions: 'nope' })).toEqual([]);
    });

    it('extensionSources 가 없으면 인덱스 라벨(extensions-map[i])로 폴백한다', () => {
        const out = bundledExtensionsToDiscovered({ extensions: [{ name: 'x' }, { name: 'y' }] });
        expect(out.map((d) => d.source)).toEqual(['extensions-map[0]', 'extensions-map[1]']);
    });

    it('source 라벨은 loadExtensions 의 잘못된-확장 에러 메시지에 그대로 쓰인다 (진단)', () => {
        // 빌드에서 활성화가 malformed 면 인덱스가 아니라 파일 식별자로 알려야 디버깅이 된다.
        const [d] = bundledExtensionsToDiscovered({
            extensions: [{ nope: true }],
            extensionSources: ['../../app/extensions/broken'],
        });
        expect(d.source).toBe('../../app/extensions/broken');
    });
});
