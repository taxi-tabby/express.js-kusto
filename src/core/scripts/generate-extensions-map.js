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

/** loadExtensions 의 isExtensionFile 과 동일한 규칙: *.ts/*.js, .d.ts/index/AGENTS 제외. */
function isExtensionFile(fileName) {
    if (fileName.endsWith('.d.ts')) return false;
    if (!fileName.endsWith('.ts') && !fileName.endsWith('.js')) return false;
    const base = fileName.replace(/\.(ts|js)$/, '');
    return base !== 'index' && base !== 'AGENTS';
}

/**
 * Build the extensions-map.ts content from a list of import specifiers (relative, no extension).
 *
 * Pure (no I/O) — single source of truth for the codegen. An empty list yields a valid
 * `export const extensions = [];` with no imports (so a project without extensions still
 * builds cleanly). Each specifier becomes a default import collected into `extensions`,
 * preserving order.
 */
function buildExtensionsMapContent(importSpecifiers) {
    const imports = importSpecifiers.map((spec, i) => `import ext_${i} from '${spec}';`).join('\n');
    const arrayItems = importSpecifiers.map((_, i) => `ext_${i}`).join(', ');

    return `/**
 * 자동 생성된 확장 맵 — 빌드 타임에 생성되어 webpack 에서 번들링됩니다. (수정 금지)
 */
${imports}

// 활성화된 확장(KustoExtension)들 — loadExtensions 가 빌드 모드에서 사용한다.
export const extensions = [${arrayItems}];
`;
}

/** EXTENSIONS_DIR 의 활성화 파일을 OUTPUT_FILE 기준 상대 import 경로(확장자 제거)로 변환. */
function resolveImportSpecifiers() {
    if (!fs.existsSync(EXTENSIONS_DIR)) {
        return [];
    }
    return fs
        .readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isExtensionFile(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b)) // loadExtensions 와 동일한 결정적 순서
        .map((fileName) => {
            const abs = path.join(EXTENSIONS_DIR, fileName);
            let rel = path.relative(path.dirname(OUTPUT_FILE), abs).replace(/\\/g, '/');
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

module.exports = { generateExtensionsMap, buildExtensionsMapContent };
