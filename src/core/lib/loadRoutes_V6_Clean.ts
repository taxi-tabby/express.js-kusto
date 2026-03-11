import { Express, Router } from 'express';
import fs from 'fs';
import path from 'path';
import { log } from '../external/winston';
import { normalizeSlash, getElapsedTimeInString } from '../external/util';
import { DocumentationGenerator } from './documentationGenerator';

// Webpack 빌드 환경에서 자동 생성된 라우트 맵 가져오기 (빌드 타임에 생성된 파일)
let routesMap: Record<string, Router> = {};
let middlewaresMap: Record<string, any[]> = {};
let directoryStructure: Record<string, string[]> = {};

/**
 * 동적 라우트 맵 로드 함수
 */
async function loadDynamicRouteMap(): Promise<void> {
    if (process.env.WEBPACK_BUILD !== 'true') {
        return;
    }

    try {
        log.Debug(`🔄 Loading dynamic route map in webpack build...`);
        // @ts-ignore - 런타임에 생성되는 파일이므로 TypeScript가 찾을 수 없음
        const routeMapModule = await import('../tmp/routes-map');
        routesMap = routeMapModule.routesMap;
        middlewaresMap = routeMapModule.middlewaresMap;
        directoryStructure = routeMapModule.directoryStructure;

        // virtualFS 업데이트
        virtualFS.routes = routesMap;
        virtualFS.middlewares = middlewaresMap;
        virtualFS.structure = directoryStructure;

        log.Debug(`✅ Successfully loaded dynamic route map with ${Object.keys(routesMap).length} routes`);


    } catch (error) {
        log.Error(`❌ Error loading dynamic route map:`, error);
        // 빈 맵으로 초기화
        routesMap = {};
        middlewaresMap = {};
        directoryStructure = { '/': [] };

        virtualFS.routes = {};
        virtualFS.middlewares = {};
        virtualFS.structure = { '/': [] };

    }

}

// Webpack 빌드 환경을 위한 가상 파일 시스템 구조
interface VirtualFileSystem {
    routes: Record<string, any>;  // 라우트 파일들
    middlewares: Record<string, any[]>; // 미들웨어 파일들
    structure: Record<string, string[]>; // 디렉토리 구조
}

// 가상 파일 시스템 (Webpack 빌드 환경용)
const virtualFS: VirtualFileSystem = {
    routes: routesMap,
    middlewares: middlewaresMap,
    structure: directoryStructure
};

/**
 * 환경에 따른 파일 확장자 반환
 */
function getFileExtension(): string {
    // 빌드 환경에서도 .ts 파일을 사용 (webpack이 복사한 .ts 파일들)
    return '.ts';
}

/**
 * 환경에 따른 라우트 디렉토리 경로 반환
 */
function getRoutesDirectory(): string {

    if (process.env.WEBPACK_BUILD === 'true') {
        // 빌드 환경에서는 가상 파일 시스템 사용
        return '/';  // 루트 경로만 사용
    }

    // 개발 환경에서는 src/app/routes 사용
    return './src/app/routes';
}

// 🚀 캐시 시스템
const middlewareCache = new Map<string, any[]>();
const routeCache = new Map<string, Router>();
const fileExistsCache = new Map<string, boolean>();
const moduleResolutionCache = new Map<string, string>();

// 라우트 패턴 정규식
const ROUTE_PATTERNS = {
    regex: /^\[\^(.+)\]$/,
    dynamic: /^\.\.\[\^(.+)\]$/,
    namedParam: /^\[(.+)\]$/
} as const;

interface DirectoryInfo {
    path: string;
    parentRoute: string;
    hasMiddleware: boolean;
    hasRoute: boolean;
    depth: number;
}

/**
 * 스마트 모듈 로더 - TypeScript alias 해석 캐싱
 */
function smartRequire(filePath: string): any {
    const resolvedPath = path.resolve(filePath);

    if (moduleResolutionCache.has(resolvedPath)) {
        const cachedPath = moduleResolutionCache.get(resolvedPath)!;
        return require(cachedPath);
    }

    try {
        const actualPath = require.resolve(resolvedPath);
        moduleResolutionCache.set(resolvedPath, actualPath);
        return require(actualPath);
    } catch (error: any) {
        moduleResolutionCache.set(resolvedPath, resolvedPath);
        return require(resolvedPath);
    }
}

/**
 * 파일 존재 확인 (캐싱) - 빌드 환경에서는 가상 파일 시스템 사용
 */
function fileExists(filePath: string): boolean {
    if (fileExistsCache.has(filePath)) {
        return fileExistsCache.get(filePath)!;
    }

    // Webpack 빌드 환경에서는 가상 파일 시스템 사용
    if (process.env.WEBPACK_BUILD === 'true') {
        // 가상 경로 변환
        const virtualPath = convertToVirtualPath(filePath);

        // 라우트 파일 확인
        if (virtualPath.endsWith('/route')) {
            const routePath = virtualPath.replace(/\/route$/, '');
            const exists = virtualFS.routes[routePath] !== undefined;
            fileExistsCache.set(filePath, exists);
            return exists;
        }

        // 미들웨어 파일 확인
        if (virtualPath.endsWith('/middleware')) {
            const middlewarePath = virtualPath.replace(/\/middleware$/, '');
            const exists = virtualFS.middlewares[middlewarePath] !== undefined;
            fileExistsCache.set(filePath, exists);
            return exists;
        }

        // 디렉토리 확인
        const exists = virtualFS.structure[virtualPath] !== undefined;
        fileExistsCache.set(filePath, exists);
        return exists;
    }

    // 개발 환경에서는 실제 파일 시스템 사용
    try {
        fs.accessSync(filePath);
        fileExistsCache.set(filePath, true);
        return true;
    } catch {
        fileExistsCache.set(filePath, false);
        return false;
    }
}

/**
 * 실제 파일 경로를 가상 경로로 변환
 */
function convertToVirtualPath(filePath: string): string {
    if (process.env.WEBPACK_BUILD !== 'true') {
        return filePath;
    }

    // 디버깅을 위한 로그
    log.Debug(`🔍 Converting path: ${filePath}`);

    // 경로 정규화: 백슬래시를 슬래시로 변환하고 연속 슬래시 제거
    let normalizedPath = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');

    // 라우트 파일인 경우 (route.ts)
    if (normalizedPath.endsWith('/route.ts') || normalizedPath.endsWith('/route.js')) {
        const pathWithoutFile = normalizedPath.replace(/\/route\.(ts|js)$/, '');

        log.Debug(`🔍 Path without file: ${pathWithoutFile}`);

        // 절대 경로를 상대 경로로 변환
        if (pathWithoutFile.includes('/app/routes/')) {
            const relativePath = pathWithoutFile.split('/app/routes/')[1] || '';
            const result = relativePath ? `/${relativePath}` : '/';
            log.Debug(`✅ Found /app/routes/ pattern, result: ${result}`);
            return result;
        }

        if (pathWithoutFile.includes('/src/app/routes/')) {
            const relativePath = pathWithoutFile.split('/src/app/routes/')[1] || '';
            const result = relativePath ? `/${relativePath}` : '/';
            log.Debug(`✅ Found /src/app/routes/ pattern, result: ${result}`);
            return result;
        }

        if (pathWithoutFile.includes('/routes/')) {
            const relativePath = pathWithoutFile.split('/routes/')[1] || '';
            const result = relativePath ? `/${relativePath}` : '/';
            log.Debug(`✅ Found /routes/ pattern, result: ${result}`);
            return result;
        }

        // 경로에서 routes 이후의 전체 경로 추출
        const parts = pathWithoutFile.split('/').filter(Boolean);
        const routesIndex = parts.lastIndexOf('routes');
        if (routesIndex !== -1 && routesIndex < parts.length - 1) {
            const relativePath = parts.slice(routesIndex + 1).join('/');
            const result = `/${relativePath}`;
            log.Debug(`✅ Found routes index pattern, result: ${result}`);
            return result;
        }

        // routes가 없는 경우에도 전체 경로 시도 (app, src 등이 포함된 절대 경로인 경우)
        // Windows 드라이브 문자 제거 (C:, D: 등)
        let cleanPath = pathWithoutFile.replace(/^[A-Za-z]:/, '');

        // 시작 슬래시 정규화
        if (!cleanPath.startsWith('/')) {
            cleanPath = '/' + cleanPath;
        }

        // app이나 src 디렉토리 이후의 경로만 추출
        if (cleanPath.includes('/app/')) {
            const appIndex = cleanPath.lastIndexOf('/app/');
            cleanPath = cleanPath.substring(appIndex + 5); // '/app/' 이후
        } else if (cleanPath.includes('/src/')) {
            const srcIndex = cleanPath.lastIndexOf('/src/');
            cleanPath = cleanPath.substring(srcIndex + 5); // '/src/' 이후
        }

        // 시작 슬래시 보장
        const result = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
        log.Debug(`✅ Fallback pattern, result: ${result}`);
        return result;
    }

    // 미들웨어 파일인 경우 (middleware.ts)
    if (normalizedPath.endsWith('/middleware.ts') || normalizedPath.endsWith('/middleware.js')) {
        const pathWithoutFile = normalizedPath.replace(/\/middleware\.(ts|js)$/, '');

        // 절대 경로를 상대 경로로 변환
        if (pathWithoutFile.includes('/app/routes/')) {
            const relativePath = pathWithoutFile.split('/app/routes/')[1] || '';
            return relativePath ? `/${relativePath}` : '/';
        }

        if (pathWithoutFile.includes('/src/app/routes/')) {
            const relativePath = pathWithoutFile.split('/src/app/routes/')[1] || '';
            return relativePath ? `/${relativePath}` : '/';
        }

        if (pathWithoutFile.includes('/routes/')) {
            const relativePath = pathWithoutFile.split('/routes/')[1] || '';
            return relativePath ? `/${relativePath}` : '/';
        }

        // 경로에서 routes 이후의 전체 경로 추출
        const parts = pathWithoutFile.split('/').filter(Boolean);
        const routesIndex = parts.lastIndexOf('routes');
        if (routesIndex !== -1 && routesIndex < parts.length - 1) {
            const relativePath = parts.slice(routesIndex + 1).join('/');
            return `/${relativePath}`;
        }
    }

    // 일반 디렉토리 경로 처리
    if (normalizedPath.includes('/app/routes/')) {
        const relativePath = normalizedPath.split('/app/routes/')[1] || '';
        return relativePath ? `/${relativePath}` : '/';
    }

    if (normalizedPath.includes('/src/app/routes/')) {
        const relativePath = normalizedPath.split('/src/app/routes/')[1] || '';
        return relativePath ? `/${relativePath}` : '/';
    }

    // 이미 루트 경로인 경우 그대로 반환
    if (normalizedPath === '/' || normalizedPath === '') {
        return '/';
    }

    // 기타 경로: 시작의 점이나 슬래시 제거
    normalizedPath = normalizedPath.replace(/^\.\//, '');

    return `/${normalizedPath}`;
}

/**
 * 라우트 경로 생성
 */
function buildRoutePath(parentRoute: string, dirName: string): string {
    const regexMatch = dirName.match(ROUTE_PATTERNS.regex);
    const dynamicMatch = dirName.match(ROUTE_PATTERNS.dynamic);
    const namedMatch = dirName.match(ROUTE_PATTERNS.namedParam);

    if (regexMatch) return `${parentRoute}/:${regexMatch[1]}([^/]+)`;
    if (dynamicMatch) return `${parentRoute}/:${dynamicMatch[1]}*`;
    if (namedMatch) return `${parentRoute}/:${namedMatch[1]}`;
    return `${parentRoute}/${dirName}`;
}

/**
 * 디렉토리 스캔 - 빌드 환경에서는 가상 파일 시스템 사용
 */
function getDirectories(dir: string): string[] {
    
    // Webpack 빌드 환경에서는 가상 파일 시스템 사용
    if (process.env.WEBPACK_BUILD === 'true') {
        const virtualPath = convertToVirtualPath(dir);
        return virtualFS.structure[virtualPath] || [];
    }

    // 개발 환경에서는 실제 파일 시스템 사용
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    } catch {
        return [];
    }
}

/**
 * 미들웨어 로드 - 빌드 환경에서는 가상 파일 시스템 사용
 */
function loadMiddleware(dir: string): any[] {
    if (middlewareCache.has(dir)) {
        return middlewareCache.get(dir)!;
    }

    // Webpack 빌드 환경에서는 가상 파일 시스템 사용
    if (process.env.WEBPACK_BUILD === 'true') {
        const virtualPath = convertToVirtualPath(dir);
        const middlewares = virtualFS.middlewares[virtualPath] || [];

        // 빌드 환경에서는 이미 로드된 미들웨어 배열이므로 배열의 길이를 정확히 측정
        const result = Array.isArray(middlewares) ? middlewares : (middlewares ? [middlewares] : []);
        middlewareCache.set(dir, result);
        return result;
    }

    // 개발 환경에서는 실제 파일 시스템 사용
    const fileExt = getFileExtension();
    const middlewarePath = path.join(dir, `middleware${fileExt}`);

    if (!fileExists(middlewarePath)) {
        middlewareCache.set(dir, []);
        return [];
    }

    try {
        // 개발 환경에서만 캐시 무효화
        if (process.env.NODE_ENV === 'development') {
            delete require.cache[path.resolve(middlewarePath)];
        }
        const middlewares = smartRequire(middlewarePath);
        const result = middlewares && middlewares.default
            ? (Array.isArray(middlewares.default) ? middlewares.default : [middlewares.default])
            : (Array.isArray(middlewares) ? middlewares : [middlewares]);

        middlewareCache.set(dir, result);
        return result;
    } catch (error) {
        log.Warn(`⚠️ Failed to load middleware: ${middlewarePath}`, error);
        middlewareCache.set(dir, []);
        return [];
    }
}

/**
 * 라우트 파일 로드 - 빌드 환경에서는 가상 파일 시스템 사용
 */
function loadRoute(filePath: string): Router {
    if (routeCache.has(filePath)) {
        return routeCache.get(filePath)!;
    }

    // Webpack 빌드 환경에서는 가상 파일 시스템 사용
    if (process.env.WEBPACK_BUILD === 'true') {
        // 경로에서 route.ts 부분을 제거하고 가상 경로로 변환
        let virtualPath = convertToVirtualPath(filePath);
        if (virtualPath.endsWith('/route')) {
            virtualPath = virtualPath.replace(/\/route$/, '');
        } else if (virtualPath.endsWith('.ts') || virtualPath.endsWith('.js')) {
            virtualPath = virtualPath.replace(/\.(ts|js)$/, '');
        }

        // 경로에서 연속된 슬래시 제거
        virtualPath = virtualPath.replace(/\/+/g, '/');

        log.Debug(`📌 Looking for route in virtual FS: ${filePath.replace(/\\/g, '/')} => ${virtualPath}`);

        // 정확한 경로로 먼저 시도
        if (virtualFS.routes[virtualPath]) {
            log.Debug(`✅ Found route in virtual FS: ${virtualPath}`);
            const route = virtualFS.routes[virtualPath];
            routeCache.set(filePath, route);
            return route;
        }

        // 다양한 경로 형식 시도 
        const alternativePaths = [
            virtualPath,
            virtualPath.replace(/^\//, ''),  // 시작 슬래시 제거
            `/${virtualPath.replace(/^\//, '')}`, // 시작 슬래시 보장
            virtualPath.replace(/\/+/g, '/'), // 중복 슬래시 제거
        ];

        // 라우트 맵에 등록된 모든 키를 체크하여 비슷한 경로가 있는지 확인
        const availableRoutes = Object.keys(virtualFS.routes);
        log.Debug(`🔍 Available routes in virtual FS: ${availableRoutes.join(', ')}`);

        for (const altPath of alternativePaths) {
            if (virtualFS.routes[altPath]) {
                log.Debug(`✅ Found route in virtual FS (alternative path): ${altPath}`);
                const route = virtualFS.routes[altPath];
                routeCache.set(filePath, route);
                return route;
            }
        }

        // 확인용: 모든 디렉토리 구조 출력
        log.Debug('📊 Virtual FS Directory Structure:', JSON.stringify(virtualFS.structure, null, 2));

        throw new Error(`Failed to load route from virtual FS: ${virtualPath}`);
    }

    // 개발 환경에서는 실제 파일 시스템 사용
    // 개발 환경에서만 캐시 무효화
    if (process.env.NODE_ENV === 'development') {
        delete require.cache[path.resolve(filePath)];
    }
    try {
        const route = smartRequire(filePath)?.default || smartRequire(filePath);
        if (!route || typeof route !== 'function') {
            throw new Error(`Route file does not export a valid router: ${filePath}`);
        }
        routeCache.set(filePath, route);
        return route;
    } catch (error) {
        log.Error(`❌ Failed to load route: ${filePath}`, error);
        throw error;
    }
}

/**
 * 전체 디렉토리 구조 스캔 - 빌드 환경에서는 가상 파일 시스템 사용
 */
function scanDirectories(rootDir: string): DirectoryInfo[] {
    // Webpack 빌드 환경에서는 가상 파일 시스템 구조 생성
    if (process.env.WEBPACK_BUILD === 'true') {
        const directories: DirectoryInfo[] = [];
        const queue: Array<{ path: string; parentRoute: string; depth: number }> = [
            { path: '/', parentRoute: '', depth: 0 }
        ];

        // BFS로 가상 파일 구조 탐색
        while (queue.length > 0) {
            const current = queue.shift()!;
            const virtualPath = current.path;

            const dirInfo: DirectoryInfo = {
                path: virtualPath,
                parentRoute: current.parentRoute,
                hasMiddleware: virtualFS.middlewares[virtualPath] !== undefined,
                hasRoute: virtualFS.routes[virtualPath] !== undefined,
                depth: current.depth
            };

            directories.push(dirInfo);

            // 하위 디렉토리 추가
            const subdirs = virtualFS.structure[virtualPath] || [];
            for (const subdir of subdirs) {
                const childPath = `${virtualPath}${virtualPath === '/' ? '' : '/'}${subdir}`;
                const routePath = buildRoutePath(current.parentRoute, subdir);

                queue.push({
                    path: childPath,
                    parentRoute: routePath,
                    depth: current.depth + 1
                });
            }
        }

        return directories;
    }

    // 개발 환경에서는 실제 파일 시스템 스캔
    const directories: DirectoryInfo[] = [];
    const queue: Array<{ dir: string; parentRoute: string; depth: number }> = [
        { dir: rootDir, parentRoute: '', depth: 0 }
    ];

    const fileExt = getFileExtension();

    while (queue.length > 0) {
        const current = queue.shift()!;

        const dirInfo: DirectoryInfo = {
            path: current.dir,
            parentRoute: current.parentRoute,
            hasMiddleware: fileExists(path.join(current.dir, `middleware${fileExt}`)),
            hasRoute: fileExists(path.join(current.dir, `route${fileExt}`)),
            depth: current.depth
        };

        directories.push(dirInfo);

        // 하위 디렉토리 추가
        const subdirs = getDirectories(current.dir);
        for (const subdir of subdirs) {
            const fullPath = path.join(current.dir, subdir);
            const routePath = buildRoutePath(current.parentRoute, subdir);

            queue.push({
                dir: fullPath,
                parentRoute: routePath,
                depth: current.depth + 1
            });
        }
    }

    return directories;
}

/**
 * 경로의 모든 미들웨어 수집 (깊은 곳에서 낮은 곳으로 역방향)
 * excludeGlobal이 true이면 최상위(전역) 미들웨어는 제외
 */
function collectMiddlewares(targetPath: string, allDirectories: DirectoryInfo[], excludeGlobal: boolean = false): any[] {
    const middlewares: any[] = [];

    if (process.env.WEBPACK_BUILD === 'true') {
        // 빌드 환경에서는 가상 경로 기반으로 미들웨어 수집
        const virtualPath = convertToVirtualPath(targetPath);
        const pathParts = virtualPath.split('/').filter(Boolean);

        // 깊은 경로부터 상위 경로로 역방향 미들웨어 수집
        let currentPath = '/';
        if (!excludeGlobal && virtualFS.middlewares[currentPath]) {
            middlewares.push(...virtualFS.middlewares[currentPath]);
        }

        for (let i = 0; i < pathParts.length; i++) {
            currentPath = currentPath === '/' ? `/${pathParts[i]}` : `${currentPath}/${pathParts[i]}`;
            if (virtualFS.middlewares[currentPath]) {
                middlewares.push(...virtualFS.middlewares[currentPath]);
            }
        }

        return middlewares;
    }

    // 개발 환경에서는 실제 파일 경로 기반으로 미들웨어 수집
    const pathParts = targetPath.split(path.sep);

    // 상위 경로부터 깊은 경로로 정방향 미들웨어 수집 (올바른 실행 순서)
    for (let i = 0; i < pathParts.length; i++) {
        const partialPath = pathParts.slice(0, i + 1).join(path.sep);
        const dirInfo = allDirectories.find(d => normalizeSlash(d.path) === normalizeSlash(partialPath));

        if (dirInfo?.hasMiddleware) {
            // 전역 미들웨어 제외 옵션이 활성화되고, 현재 디렉토리가 루트인 경우 건너뛰기
            if (excludeGlobal && (dirInfo.parentRoute === '' || dirInfo.parentRoute === '/')) {
                continue;
            }

            const dirMiddlewares = loadMiddleware(dirInfo.path);
            middlewares.push(...dirMiddlewares);
        }
    }

    return middlewares;
}

/**
 * 🚀 클린 라우트 로더 V6
 */
async function loadRoutes(app: Express, dir?: string): Promise<void> {
    const startTime = process.hrtime();

    // Webpack 빌드 환경에서는 먼저 동적 라우트 맵 로드
    await loadDynamicRouteMap();

    // 환경에 맞는 라우트 디렉토리 사용
    const routesDir = dir || getRoutesDirectory();

    log.Route(`🚀 Starting Clean V6 route loader: ${routesDir}`);
    log.Route(`📍 Environment: ${process.env.WEBPACK_BUILD === 'true' ? 'Build (Production)' : 'Development'}`);
    log.Route(`📁 File extension: ${getFileExtension()}`);

    try {

        // 1. 디렉토리 구조 스캔
        const directories = scanDirectories(routesDir);
        const routeDirectories = directories.filter(d => d.hasRoute);

        log.Route(`📊 Found ${directories.length} directories, ${routeDirectories.length} routes in ${routesDir}`);

        if (routeDirectories.length === 0) {
            log.Route(`⚠️ No routes found in ${routesDir}`);
            return;
        }

        // 1.5. 전역 미들웨어 먼저 등록 (최상위 middleware.ts)
        const rootDirectory = directories.find(d => d.parentRoute === '' || d.parentRoute === '/');
        if (rootDirectory && rootDirectory.hasMiddleware) {
            const globalMiddlewares = loadMiddleware(rootDirectory.path);
            if (globalMiddlewares && globalMiddlewares.length > 0) {
                app.use(...globalMiddlewares);
                log.Route(`🌍 Global middlewares registered: ${globalMiddlewares.length} middlewares from ${rootDirectory.path}`);
            }
        }

        // 2. 모든 라우트 모듈 사전 로드
        const routeModules = new Map<string, Router>();
        const middlewareCollections = new Map<string, any[]>();



        // 라우트별로 모듈과 미들웨어 준비
        for (const dirInfo of routeDirectories) {
            const fileExt = getFileExtension();
            const routeFilePath = path.join(dirInfo.path, `route${fileExt}`);
            try {
                const route = loadRoute(routeFilePath);
                const middlewares = collectMiddlewares(dirInfo.path, directories, true); // 전역 미들웨어 제외

                routeModules.set(dirInfo.path, route);
                middlewareCollections.set(dirInfo.path, middlewares);

                if (process.env.NODE_ENV === 'development') {
                    log.Route(`📦 Loaded: ${routeFilePath} (${middlewares.length} middlewares)`);
                }
            } catch (error) {
                log.Error(`❌ Failed to load route: ${routeFilePath}`, error);
            }
        }

        // 3. Express에 라우트 등록 (구체적인 경로 우선)
        const sortedRoutes = routeDirectories.sort((a, b) => {
            // 경로 길이로 먼저 정렬 (긴 경로가 먼저)
            const pathLengthDiff = b.parentRoute.length - a.parentRoute.length;
            if (pathLengthDiff !== 0) return pathLengthDiff;

            // 경로 길이가 같으면 깊이로 정렬
            return a.depth - b.depth;
            
        }); 
        
        for (const dirInfo of sortedRoutes) {
            const route = routeModules.get(dirInfo.path);
            const middlewares = middlewareCollections.get(dirInfo.path); if (route && middlewares) {
                const routePath = normalizeSlash("/" + dirInfo.parentRoute);

                // 라우트에 basePath 설정 (ExpressRouter의 setBasePath 메서드 호출)
                if (route && 'setBasePath' in route && typeof (route as any).setBasePath === 'function') {
                    (route as any).setBasePath(routePath);
                }

                // 문서화 경로 업데이트를 위해 라우트 로드 전후의 등록된 라우트 수 추적
                const routeCountBefore = DocumentationGenerator.getRouteCount();

                app.use(routePath, ...middlewares, route);

                const routeCountAfter = DocumentationGenerator.getRouteCount();

                // 새로 등록된 라우트들의 경로를 업데이트
                if (routeCountAfter > routeCountBefore && routePath !== '/') {
                    const newRouteIndices = Array.from(
                        { length: routeCountAfter - routeCountBefore },
                        (_, i) => routeCountBefore + i
                    );
                    DocumentationGenerator.updateRoutePaths(routePath, newRouteIndices);
                }

                log.Route(`🔗 ${routePath} (${middlewares.length} middlewares)`);
            }
        }
        // 4. 완료 통계
        const endTime = process.hrtime(startTime);
        const stats = getCacheStats();

        // 빌드 환경에서 추가 디버깅 정보
        if (process.env.WEBPACK_BUILD === 'true') {
            const virtualMiddlewareKeys = Object.keys(virtualFS.middlewares);
            const actualMiddlewareFiles = virtualMiddlewareKeys.filter(key => {
                const middlewares = virtualFS.middlewares[key];
                return Array.isArray(middlewares) && middlewares.length > 0;
            });

            log.Route(`🔍 Debug - VirtualFS middleware keys: ${virtualMiddlewareKeys.length}`);
            log.Route(`🔍 Debug - Actual middleware files: ${actualMiddlewareFiles.length}`);
            log.Route(`🔍 Debug - MiddlewareCache size: ${middlewareCache.size}`);
            log.Route(`🔍 Debug - Middleware files with content: ${actualMiddlewareFiles.join(', ')}`);
        }

        log.Route(`✅ Clean V6 completed: ${getElapsedTimeInString(endTime)}`);
        log.Route(`   Routes: ${stats.routes}, Middlewares: ${stats.middlewares}`);

    } catch (error) {
        log.Error(`❌ Route loading failed:`, error);
        throw error;
    }
}

/**
 * 캐시 통계
 */
function getCacheStats() {
    // 빌드 환경에서는 실제 virtualFS에서 미들웨어 수를 계산
    let actualMiddlewareCount = middlewareCache.size;

    if (process.env.WEBPACK_BUILD === 'true') {
        // 빌드 환경에서는 virtualFS.middlewares에서 실제 미들웨어 수 계산
        actualMiddlewareCount = Object.keys(virtualFS.middlewares).filter(key => {
            const middlewares = virtualFS.middlewares[key];
            return Array.isArray(middlewares) && middlewares.length > 0;
        }).length;
    }

    return {
        routes: routeCache.size,
        middlewares: actualMiddlewareCount,
        fileStats: fileExistsCache.size,
        moduleResolutions: moduleResolutionCache.size
    };
}

/**
 * 캐시 초기화
 */
export function clearCache(): void {
    middlewareCache.clear();
    routeCache.clear();
    fileExistsCache.clear();
    moduleResolutionCache.clear();
    log.Route(`🧹 Cache cleared`);
}

export default loadRoutes;