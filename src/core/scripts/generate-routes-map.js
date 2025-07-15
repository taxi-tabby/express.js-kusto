/**
 * 빌드 타임에 실행되어 라우트 구조를 TypeScript 파일로 생성하는 스크립트
 */
const fs = require('fs');
const path = require('path');

// 라우트 디렉토리 패스 설정 (Windows 경로 처리)
const ROUTES_DIR = path.resolve(process.cwd(), 'src', 'app', 'routes');
const TMP_DIR = path.resolve(process.cwd(), 'src', 'core', 'tmp');
const OUTPUT_FILE = path.resolve(TMP_DIR, 'routes-map.ts');

// 가상 파일 시스템 구조
const virtualFileSystem = {
    routes: {},
    middlewares: {},
    structure: {}
};

/**
 * 디렉토리 스캔 및 라우트 맵 생성
 */
function scanDirectory(dir, virtualPath = '/') {
    // 디렉토리 구조 초기화
    virtualFileSystem.structure[virtualPath] = [];
    
    try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        
        // 라우트 파일 확인
        const routeFile = items.find(item => (item.name === 'route.ts' || item.name === 'route.js') && !item.isDirectory());        if (routeFile) {
            const routePath = virtualPath;
            virtualFileSystem.routes[routePath] = { 
                path: path.relative(process.cwd(), path.join(dir, routeFile.name)),
                importPath: `./${path.relative(process.cwd(), path.join(dir, routeFile.name)).replace(/\\/g, '/')}` 
            };
        }
        
        // 미들웨어 파일 확인
        const middlewareFile = items.find(item => (item.name === 'middleware.ts' || item.name === 'middleware.js') && !item.isDirectory());        if (middlewareFile) {
            const middlewarePath = virtualPath;
            virtualFileSystem.middlewares[middlewarePath] = { 
                path: path.relative(process.cwd(), path.join(dir, middlewareFile.name)),
                importPath: `./${path.relative(process.cwd(), path.join(dir, middlewareFile.name)).replace(/\\/g, '/')}` 
            };
        }
        
        // 하위 디렉토리 스캔
        for (const item of items) {
            if (item.isDirectory()) {
                const fullPath = path.join(dir, item.name);
                const nextVirtualPath = virtualPath === '/' ? `/${item.name}` : `${virtualPath}/${item.name}`;
                
                // 디렉토리 경로 기록
                virtualFileSystem.structure[virtualPath].push(item.name);
                
                // 재귀적으로 하위 디렉토리 스캔
                scanDirectory(fullPath, nextVirtualPath);
            }
        }
    } catch (error) {
        console.error(`❌ Error scanning directory ${dir}:`, error);
    }
}

// 라우트 디렉토리 확인
console.log(`🔍 Checking routes directory: ${ROUTES_DIR}`);
if (!fs.existsSync(ROUTES_DIR)) {
    console.error(`❌ Routes directory does not exist: ${ROUTES_DIR}`);
    process.exit(1);
}

// 라우트 디렉토리 스캔
console.log(`🔍 Scanning routes directory: ${ROUTES_DIR}`);
scanDirectory(ROUTES_DIR);

// 결과 출력
console.log(`📊 Found ${Object.keys(virtualFileSystem.routes).length} routes and ${Object.keys(virtualFileSystem.middlewares).length} middlewares`);
console.log(`📊 Directory structure: ${Object.keys(virtualFileSystem.structure).length} directories`);

// 디렉토리 구조와 경로 출력
console.log(`\n📁 Virtual File System Structure:`);
console.log(JSON.stringify(virtualFileSystem.structure, null, 2));
console.log(`\n📑 Routes:`);
console.log(Object.keys(virtualFileSystem.routes).join('\n'));

// 가져오기 코드 생성
let importCode = [];
let routesMapCode = {};
let middlewaresMapCode = {};

// 라우트 가져오기 코드 생성
Object.entries(virtualFileSystem.routes).forEach(([routePath, routeInfo], index) => {
    const varName = `route_${index}`;
    importCode.push(`import ${varName} from '${routeInfo.importPath}';`);
    routesMapCode[routePath] = varName;
});

// 미들웨어 가져오기 코드 생성
Object.entries(virtualFileSystem.middlewares).forEach(([middlewarePath, middlewareInfo], index) => {
    const varName = `middleware_${index}`;
    importCode.push(`import ${varName} from '${middlewareInfo.importPath}';`);
    middlewaresMapCode[middlewarePath] = `Array.isArray(${varName}) ? ${varName} : [${varName}]`;
});

        // 상대 경로로 변환 (webpack 번들에서 사용 가능하도록)
importCode = importCode.map(line => {
    // 상대 경로 가져오기 ('../../../app/routes/...' 형태로 변환) & .ts 확장자 제거
    return line.replace(/['"].*['"]/g, matched => {
        const importPath = matched.slice(1, -1);
        let relativePath = path.relative(
            path.dirname(OUTPUT_FILE), 
            path.resolve(importPath.startsWith('.') ? importPath : path.join(process.cwd(), importPath))
        ).replace(/\\/g, '/');
        
        // .ts 확장자 제거
        relativePath = relativePath.replace(/\.ts$/, '');
        
        return `'${relativePath.startsWith('.') ? relativePath : './' + relativePath}'`;
    });
});

// 종합 코드 생성
const generatedCode = `/**
 * 자동 생성된 라우트 맵
 * 이 파일은 빌드 타임에 생성되어 Webpack에서 번들링됩니다.
 */
${importCode.join('\n')}

// 라우트 맵 - 경로와 해당 라우트 모듈 연결
export const routesMap = {
${Object.entries(routesMapCode).map(([path, varName]) => `  "${path}": ${varName}`).join(',\n')}
};

// 미들웨어 맵 - 경로와 해당 미들웨어 모듈 연결
export const middlewaresMap = {
${Object.entries(middlewaresMapCode).map(([path, code]) => `  "${path}": ${code}`).join(',\n')}
};

// 디렉토리 구조
export const directoryStructure = ${JSON.stringify(virtualFileSystem.structure, null, 2)};
`;

// 결과 저장
const outputDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`📁 Created tmp directory: ${outputDir}`);
}

// 라우트 맵 파일 생성
fs.writeFileSync(OUTPUT_FILE, generatedCode);

console.log(`✅ Route map generated: ${OUTPUT_FILE}`);
