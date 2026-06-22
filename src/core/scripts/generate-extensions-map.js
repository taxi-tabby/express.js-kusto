/**
 * 빌드 타임에 실행되어 src/app/extensions/ 의 활성화 파일들을 정적 import 하는
 * extensions-map.ts 를 생성한다. webpack 이 이 파일(과 그것이 import 하는 확장 모듈들)을
 * 번들에 포함하므로, 빌드된 서버에서도 loadExtensions 가 확장 메서드(예: GET_REACT)를
 * 등록할 수 있다. (routes-map 과 동일한 패턴 — 런타임 fs 스캔은 번들에서 동작하지 않는다.)
 */
const fs = require('fs');
const path = require('path');

const EXTENSIONS_DIR = path.resolve(process.cwd(), 'src', 'app', 'extensions');
const TMP_DIR = path.resolve(process.cwd(), 'src', 'core', 'tmp');
const OUTPUT_FILE = path.resolve(TMP_DIR, 'extensions-map.ts');

/**
 * 활성화 파일 판별 규칙: *.ts/*.js, .d.ts/index/AGENTS 제외.
 *
 * 주의(SSOT 쌍): 이 규칙은 loadExtensions.ts 의 isExtensionFile 과 반드시 동일해야 한다 —
 * dev(런타임 fs 스캔)와 build(이 codegen)가 같은 파일 집합을 골라야 dev/build 동작이 일치한다.
 * 한쪽만 바꾸면 빌드가 dev 와 다른 확장을 등록하는 회귀가 생긴다. 둘의 동치는
 * tests/unit/extensions/extension-file-filter-parity.test.ts 가 고정한다.
 */
function isExtensionFile(fileName) {
    if (fileName.endsWith('.d.ts')) return false;
    if (!fileName.endsWith('.ts') && !fileName.endsWith('.js')) return false;
    const base = fileName.replace(/\.(ts|js)$/, '');
    return base !== 'index' && base !== 'AGENTS';
}

/**
 * Build the extensions-map.ts content from a list of import specifiers (relative, no extension).
 *
 * Pure (no I/O) — single source of truth for the codegen. Emits a verbatim default import per
 * specifier collected into `extensions` (order preserved), plus a parallel `extensionSources`
 * array of the specifiers so loadExtensions can report a meaningful name (not just an index)
 * when a build-bundled activation is malformed. An empty list yields valid empty arrays.
 */
function buildExtensionsMapContent(importSpecifiers) {
    const imports = importSpecifiers.map((spec, i) => `import ext_${i} from '${spec}';`).join('\n');
    const arrayItems = importSpecifiers.map((_, i) => `ext_${i}`).join(', ');
    const sourceItems = importSpecifiers.map((spec) => JSON.stringify(spec)).join(', ');

    return `/**
 * 자동 생성된 확장 맵 — 빌드 타임에 생성되어 webpack 에서 번들링됩니다. (수정 금지)
 */
${imports}

// 활성화된 확장(KustoExtension)들 — loadExtensions 가 빌드 모드에서 사용한다.
export const extensions = [${arrayItems}];

// 각 확장의 소스 식별자(진단용) — extensions 와 인덱스가 1:1 대응한다.
export const extensionSources = [${sourceItems}];
`;
}

/**
 * 주어진 확장 디렉터리의 활성화 파일들을, OUTPUT_FILE 기준 상대 import 경로(확장자 제거,
 * 슬래시 정규화, 결정적 정렬)로 변환한다. 빌드의 핵심 변환부 — OS/경로에 민감하다.
 * 디렉터리가 없으면 빈 배열.
 */
function resolveImportSpecifiers(extensionsDir = EXTENSIONS_DIR, outputFile = OUTPUT_FILE) {
    if (!fs.existsSync(extensionsDir)) {
        return [];
    }
    return fs
        .readdirSync(extensionsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isExtensionFile(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b)) // loadExtensions 와 동일한 결정적 순서
        .map((fileName) => {
            const abs = path.join(extensionsDir, fileName);
            let rel = path.relative(path.dirname(outputFile), abs).replace(/\\/g, '/');
            rel = rel.replace(/\.(ts|js)$/, '');
            return rel.startsWith('.') ? rel : `./${rel}`;
        });
}

function generateExtensionsMap() {
    const specifiers = resolveImportSpecifiers();
    console.log(`Found extensions: ${specifiers.length}`);

    const content = buildExtensionsMapContent(specifiers);

    if (!fs.existsSync(TMP_DIR)) {
        fs.mkdirSync(TMP_DIR, { recursive: true });
        console.log(`Created tmp directory: ${TMP_DIR}`);
    }
    fs.writeFileSync(OUTPUT_FILE, content);
    console.log(`Extensions map generated: ${OUTPUT_FILE}`);

    return { specifiers, outputPath: OUTPUT_FILE };
}

if (require.main === module) {
    try {
        generateExtensionsMap();
    } catch (error) {
        console.error('Error generating extensions map:', error);
        process.exit(1);
    }
}

module.exports = {
    generateExtensionsMap,
    buildExtensionsMapContent,
    resolveImportSpecifiers,
    isExtensionFile,
};
