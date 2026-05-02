import { Schema, FieldSchema } from './validator';
import { RequestConfig, ResponseConfig } from './requestHandler';
import fs from 'fs';
import path from 'path';
import { log } from '@ext/winston';


export interface RouteDocumentation {
    method: string;
    path: string;
    summary?: string;
    description?: string;
    parameters?: {
        query?: Schema;
        params?: Schema;
        body?: Schema;
    };
    responses?: ResponseConfig;
    tags?: string[];
}

export interface ApiDocumentation {
    openapi: string;
    info: {
        title: string;
        version: string;
        description?: string;
    };
    servers: Array<{
        url: string;
        description: string;
    }>;
    paths: Record<string, Record<string, any>>;
    components: {
        schemas: Record<string, any>;
    };
}

export class DocumentationGenerator {
    private static routes: RouteDocumentation[] = [];
    private static schemas: Record<string, any> = {};

    /**
     * 라우트 문서 등록
     */
    static registerRoute(route: RouteDocumentation): void {
        // 개발 모드가 아니거나 AUTO_DOCS가 활성화되지 않았으면 무시
        if (!this.isDocumentationEnabled()) {
            return;
        }

        this.routes.push(route);
        log.Debug(`Documentation registered for ${route.method} ${route.path}`);
    }

    /**
     * 등록된 라우트의 경로를 업데이트 (마운트 시 사용)
     */
    static updateRoutePaths(basePath: string, routeIndices?: number[]): void {
        if (!this.isDocumentationEnabled()) {
            return;
        }

        const normalizedBasePath = basePath === '/' ? '' : (basePath.endsWith('/') ? basePath.slice(0, -1) : basePath);
        
        // 특정 라우트만 업데이트하거나 모든 라우트 업데이트
        const indicesToUpdate = routeIndices || [];
        
        if (indicesToUpdate.length === 0) {
            // 모든 라우트 업데이트 (이전 동작과의 호환성)
            return;
        }

        // 지정된 인덱스의 라우트만 업데이트
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

    /**
     * 현재 등록된 라우트 수 반환 (마운트 전후 구분용)
     */
    static getRouteCount(): number {
        return this.routes.length;
    }

    /**
     * 문서화 활성화 여부 확인
     */
    private static isDocumentationEnabled(): boolean {
        return process.env.NODE_ENV !== 'production' && process.env.AUTO_DOCS === 'true';
    }

    /**
     * 스키마를 OpenAPI 형식으로 변환
     */
    private static convertSchemaToOpenAPI(schema: Schema): any {
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const [fieldName, fieldSchema] of Object.entries(schema)) {
            properties[fieldName] = this.convertFieldSchemaToOpenAPI(fieldSchema);
            
            if (fieldSchema.required) {
                required.push(fieldName);
            }
        }

        return {
            type: 'object',
            properties,
            ...(required.length > 0 ? { required } : {})
        };
    }

    /**
     * 필드 스키마를 OpenAPI 형식으로 변환
     */
    private static convertFieldSchemaToOpenAPI(fieldSchema: FieldSchema): any {
        const result: any = {};

        // 타입 변환
        switch (fieldSchema.type) {
            case 'string':
            case 'email':
            case 'url':
                result.type = 'string';
                if (fieldSchema.type === 'email') {
                    result.format = 'email';
                } else if (fieldSchema.type === 'url') {
                    result.format = 'uri';
                }
                break;
            case 'number':
                result.type = 'number';
                break;
            case 'boolean':
                result.type = 'boolean';
                break;
            case 'array':
                result.type = 'array';
                break;
            case 'object':
                result.type = 'object';
                break;
        }

        // 제약조건
        if (fieldSchema.min !== undefined) {
            if (fieldSchema.type === 'string' || fieldSchema.type === 'array') {
                result.minLength = fieldSchema.min;
            } else if (fieldSchema.type === 'number') {
                result.minimum = fieldSchema.min;
            }
        }

        if (fieldSchema.max !== undefined) {
            if (fieldSchema.type === 'string' || fieldSchema.type === 'array') {
                result.maxLength = fieldSchema.max;
            } else if (fieldSchema.type === 'number') {
                result.maximum = fieldSchema.max;
            }
        }

        if (fieldSchema.enum) {
            result.enum = fieldSchema.enum;
        }

        if (fieldSchema.pattern) {
            result.pattern = fieldSchema.pattern.source;
        }

        return result;
    }

    /**
     * OpenAPI 문서 생성
     */
    static generateOpenAPISpec(): ApiDocumentation {
        if (!this.isDocumentationEnabled()) {
            throw new Error('Documentation is not enabled');
        }

        const paths: Record<string, Record<string, any>> = {};

        for (const route of this.routes) {
            if (!paths[route.path]) {
                paths[route.path] = {};
            }

            const operation: any = {
                summary: route.summary || `${route.method.toUpperCase()} ${route.path}`,
                description: route.description,
                tags: route.tags || ['API'],
                parameters: [],
                responses: {}
            };

            // 파라미터 처리
            if (route.parameters?.query) {
                for (const [paramName, paramSchema] of Object.entries(route.parameters.query)) {
                    operation.parameters.push({
                        name: paramName,
                        in: 'query',
                        required: paramSchema.required || false,
                        schema: this.convertFieldSchemaToOpenAPI(paramSchema)
                    });
                }
            }

            if (route.parameters?.params) {
                for (const [paramName, paramSchema] of Object.entries(route.parameters.params)) {
                    operation.parameters.push({
                        name: paramName,
                        in: 'path',
                        required: true, // path 파라미터는 항상 required
                        schema: this.convertFieldSchemaToOpenAPI(paramSchema)
                    });
                }
            }

            // 요청 바디 처리
            if (route.parameters?.body) {
                operation.requestBody = {
                    required: true,
                    content: {
                        'application/json': {
                            schema: this.convertSchemaToOpenAPI(route.parameters.body)
                        }
                    }
                };
            }

            // 응답 처리
            if (route.responses) {
                for (const [statusCode, responseSchema] of Object.entries(route.responses)) {
                    operation.responses[statusCode] = {
                        description: `Response ${statusCode}`,
                        content: {
                            'application/json': {
                                schema: this.convertSchemaToOpenAPI(responseSchema)
                            }
                        }
                    };
                }
            }

            // 기본 응답 추가
            if (Object.keys(operation.responses).length === 0) {
                operation.responses['200'] = {
                    description: 'Success',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    success: { type: 'boolean' },
                                    data: { type: 'object' },
                                    timestamp: { type: 'string', format: 'date-time' }
                                }
                            }
                        }
                    }
                };
            }

            paths[route.path][route.method.toLowerCase()] = operation;
        }

        return {
            openapi: '3.0.0',
            info: {
                title: 'Express Kusto API',
                version: '1.0.0',
                description: 'Auto-generated API documentation'
            },
            servers: [
                {
                    url: `http://localhost:${process.env.PORT || 3000}`,
                    description: 'Development server'
                }
            ],
            paths,
            components: {
                schemas: this.schemas
            }
        };
    }

    /**
     * HTML 문서 생성
     */
    static generateHTMLDocumentation(): string {
        if (!this.isDocumentationEnabled()) {
            return '<h1>Documentation is not enabled</h1>';
        }

        const openApiSpec = this.generateOpenAPISpec();
        
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
                plugins: [
                    SwaggerUIBundle.plugins.DownloadUrl
                ]
            });
        };
    </script>
</body>
</html>`;
    }

    /**
     * 라우트 목록 반환
     */
    static getRoutes(): RouteDocumentation[] {
        return [...this.routes];
    }

    /**
     * 문서 초기화
     */
    static reset(): void {
        this.routes = [];
        this.schemas = {};
    }

    /**
     * 개발 모드 정보 페이지 생성
     */
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
        <h1>🚀 API Development Dashboard</h1>
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

    <h2>📋 Registered Routes</h2>
    <div class="route-list">
        ${this.routes.map(route => `
        <div class="route-item">
            <span class="method ${route.method}">${route.method}</span>
            <span class="path">${route.path}</span>
            ${route.summary ? `<span style="margin-left: auto; color: #6c757d; font-style: italic;">${route.summary}</span>` : ''}
        </div>
        `).join('')}
    </div>    <div class="links">
        <a href="/docs/openapi.json" class="link-button">📄 OpenAPI JSON</a>
    </div>

    <script>
        // 자동 새로고침 (개발 중 편의를 위해)
        if (window.location.search.includes('refresh=true')) {
            setTimeout(() => window.location.reload(), 5000);
        }
    </script>
</body>
</html>`;
    }
}
