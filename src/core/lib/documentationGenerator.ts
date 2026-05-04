import { Schema } from './validator';
import { ResponseConfig } from './requestHandler';
import { log } from '@ext/winston';
import {
    buildOpenApiDocument,
    OpenApiSchemaOrRef,
    OpenApiDocument,
    ContentTypeMode,
} from './documentation';

export interface RouteDocumentation {
    method: string;
    path: string;
    summary?: string;
    description?: string;
    parameters?: {
        query?: Schema;
        params?: Schema;
        body?: Schema | OpenApiSchemaOrRef;
    };
    responses?: ResponseConfig | Record<string | number, OpenApiSchemaOrRef>;
    tags?: string[];
    contentType?: ContentTypeMode;
}

/** 기존 ApiDocumentation 호환 alias */
export type ApiDocumentation = OpenApiDocument;

const FALLBACK_PACKAGE_JSON = { name: 'kusto-api', version: '0.0.0' };

function loadPackageJson(): { name?: string; version?: string; description?: string } {
    try {
        // webpack bundling 시 inline. dev 모드에서는 ts-node 가 require 해석.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('../../../package.json');
    } catch {
        log.Warn('package.json not found for OpenAPI info, using fallback');
        return FALLBACK_PACKAGE_JSON;
    }
}

export class DocumentationGenerator {
    private static routes: RouteDocumentation[] = [];
    private static schemas: Record<string, OpenApiSchemaOrRef> = {};

    /** 라우트 문서 등록 */
    static registerRoute(route: RouteDocumentation): void {
        if (!this.isDocumentationEnabled()) return;
        this.routes.push(route);
        log.Debug(`Documentation registered for ${route.method} ${route.path}`);
    }

    /** 등록된 라우트의 경로를 업데이트 (마운트 시 사용) */
    static updateRoutePaths(basePath: string, routeIndices?: number[]): void {
        if (!this.isDocumentationEnabled()) return;

        const normalizedBasePath = basePath === '/' ? '' : (basePath.endsWith('/') ? basePath.slice(0, -1) : basePath);
        const indicesToUpdate = routeIndices || [];
        if (indicesToUpdate.length === 0) return;

        for (const index of indicesToUpdate) {
            if (index >= 0 && index < this.routes.length) {
                const route = this.routes[index];
                if (!route.path.startsWith(normalizedBasePath)) {
                    const newPath = route.path === '/'
                        ? normalizedBasePath || '/'
                        : `${normalizedBasePath}${route.path}`;
                    log.Debug(`Updating route path: ${route.path} -> ${newPath}`);
                    route.path = newPath;
                }
            }
        }
    }

    static getRouteCount(): number {
        return this.routes.length;
    }

    /** 스키마 등록 (M3 의 syncDocumentationSchemas 가 사용 예정) */
    static registerSchema(name: string, schema: OpenApiSchemaOrRef): void {
        if (!this.isDocumentationEnabled()) return;
        this.schemas[name] = schema;
    }

    private static isDocumentationEnabled(): boolean {
        return process.env.NODE_ENV !== 'production' && process.env.AUTO_DOCS === 'true';
    }

    /** OpenAPI 문서 생성 */
    static generateOpenAPISpec(): ApiDocumentation {
        if (!this.isDocumentationEnabled()) {
            throw new Error('Documentation is not enabled');
        }
        return buildOpenApiDocument({
            routes: this.routes as Parameters<typeof buildOpenApiDocument>[0]['routes'],
            schemas: this.schemas,
            env: process.env,
            packageJson: loadPackageJson(),
        });
    }

    /** HTML 문서 생성 (Swagger UI 5.x) */
    static generateHTMLDocumentation(): string {
        if (!this.isDocumentationEnabled()) {
            return '<h1>Documentation is not enabled</h1>';
        }
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Documentation</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.0.0/swagger-ui.css" />
    <style>
        body { margin: 0; padding: 0; }
        .swagger-ui .topbar { display: none; }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.0.0/swagger-ui-bundle.js"></script>
    <script>
        window.onload = function() {
            SwaggerUIBundle({
                url: '/docs/openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIBundle.presets.standalone
                ],
                plugins: [SwaggerUIBundle.plugins.DownloadUrl]
            });
        };
    </script>
</body>
</html>`;
    }

    static getRoutes(): RouteDocumentation[] {
        return [...this.routes];
    }

    static reset(): void {
        this.routes = [];
        this.schemas = {};
    }

    /** 개발 모드 정보 페이지 생성 (기존 동작 보존) */
    static generateDevInfoPage(): string {
        const totalRoutes = this.routes.length;
        const routesByMethod = this.routes.reduce((acc, route) => {
            acc[route.method] = (acc[route.method] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Development Info</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
        .stats { display: flex; gap: 20px; margin: 20px 0; }
        .stat-card { background: white; border: 1px solid #e9ecef; padding: 15px; border-radius: 8px; min-width: 120px; }
        .stat-number { font-size: 24px; font-weight: bold; color: #0d6efd; }
        .stat-label { color: #6c757d; font-size: 14px; }
        .route-list { margin-top: 20px; }
        .route-item { background: white; border: 1px solid #e9ecef; padding: 10px 15px; margin: 5px 0; border-radius: 4px; display: flex; align-items: center; }
        .method { font-weight: bold; margin-right: 15px; padding: 3px 8px; border-radius: 3px; font-size: 12px; }
        .method.GET { background: #d4edda; color: #155724; }
        .method.POST { background: #cce5ff; color: #004085; }
        .method.PUT { background: #fff3cd; color: #856404; }
        .method.DELETE { background: #f8d7da; color: #721c24; }
        .path { font-family: monospace; color: #495057; }
        .links { margin-top: 30px; }
        .link-button { display: inline-block; background: #0d6efd; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin-right: 10px; }
        .link-button:hover { background: #0b5ed7; }
    </style>
</head>
<body>
    <div class="header">
        <h1>API Development Dashboard</h1>
        <p>Auto-generated documentation for Express Kusto API</p>
        <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'} | <strong>Auto Docs:</strong> ${process.env.AUTO_DOCS}</p>
    </div>

    <div class="stats">
        <div class="stat-card">
            <div class="stat-number">${totalRoutes}</div>
            <div class="stat-label">Total Routes</div>
        </div>
        ${Object.entries(routesByMethod).map(([method, count]) => `
        <div class="stat-card">
            <div class="stat-number">${count}</div>
            <div class="stat-label">${method} Routes</div>
        </div>
        `).join('')}
    </div>

    <h2>Registered Routes</h2>
    <div class="route-list">
        ${this.routes.map(route => `
        <div class="route-item">
            <span class="method ${route.method}">${route.method}</span>
            <span class="path">${route.path}</span>
            ${route.summary ? `<span style="margin-left: auto; color: #6c757d; font-style: italic;">${route.summary}</span>` : ''}
        </div>
        `).join('')}
    </div>
    <div class="links">
        <a href="/docs/openapi.json" class="link-button">OpenAPI JSON</a>
    </div>

    <script>
        if (window.location.search.includes('refresh=true')) {
            setTimeout(() => window.location.reload(), 5000);
        }
    </script>
</body>
</html>`;
    }
}
