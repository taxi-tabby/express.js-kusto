import { RouteDocumentation, DocumentationGenerator } from './documentationGenerator';
import { Schema, FieldSchema } from './validator';
import { RequestConfig, ResponseConfig } from './requestHandler';
import { log } from '../external/winston';
import * as ejs from 'ejs';
import * as path from 'path';
import * as fs from 'fs';

export interface TestCase {
    name: string;
    description: string;
    type: 'success' | 'failure';
    endpoint: string;
    method: string;
    data?: {
        query?: any;
        params?: any;
        body?: any;
    };
    expectedStatus: number;
    expectedErrors?: string[];
    validationErrors?: string[];
}

export interface RouteTestSuite {
    route: RouteDocumentation;
    testCases: TestCase[];
}

export interface RouteGroup {
    id: string;
    path: string;
    routes: RouteTestSuite[];
    totalTests: number;
}

export interface TestReportStats {
    totalRoutes: number;
    totalTests: number;
    successTests: number;
    failureTests: number;
}

export class TestGenerator {
    private static routes: RouteDocumentation[] = [];
    private static viewsPath = path.join(__dirname, 'views');

    /**
     * 테스트 기능 활성화 여부 확인
     */
    private static isTestingEnabled(): boolean {
        return process.env.NODE_ENV !== 'production' && process.env.AUTO_DOCS === 'true';
    }

    /**
     * 모든 라우트의 테스트 케이스 생성
     */
    static generateAllTestCases(): RouteTestSuite[] {
        if (!this.isTestingEnabled()) {
            return [];
        }

        this.routes = DocumentationGenerator.getRoutes();
        const testSuites: RouteTestSuite[] = [];

        for (const route of this.routes) {
            const testCases = this.generateTestCasesForRoute(route);
            testSuites.push({
                route,
                testCases
            });
        }

        return testSuites;
    }

    /**
     * 특정 라우트의 테스트 케이스 생성
     */
    private static generateTestCasesForRoute(route: RouteDocumentation): TestCase[] {
        const testCases: TestCase[] = [];

        // 1. 성공 케이스 생성
        const successCase = this.generateSuccessCase(route);
        if (successCase) {
            testCases.push(successCase);
        }

        // 2. 실패 케이스 생성
        const failureCases = this.generateFailureCases(route);
        testCases.push(...failureCases);

        return testCases;
    }

    /**
     * 성공 케이스 생성
     */
    private static generateSuccessCase(route: RouteDocumentation): TestCase | null {
        const validData = this.generateValidData(route.parameters);
        
        return {
            name: `${route.method} ${route.path} - Success Case`,
            description: `Valid request with all required fields`,
            type: 'success',
            endpoint: route.path,
            method: route.method,
            data: validData,
            expectedStatus: 200
        };
    }

    /**
     * 실패 케이스 생성
     */
    private static generateFailureCases(route: RouteDocumentation): TestCase[] {
        const failureCases: TestCase[] = [];

        if (!route.parameters) {
            return failureCases;
        }

        // 각 파라미터 위치별로 실패 케이스 생성
        const locations: Array<keyof typeof route.parameters> = ['query', 'params', 'body'];
        
        for (const location of locations) {
            const schema = route.parameters[location];
            if (schema) {
                failureCases.push(...this.generateSchemaFailureCases(route, location, schema));
            }
        }

        return failureCases;
    }

    /**
     * 스키마별 실패 케이스 생성
     */
    private static generateSchemaFailureCases(
        route: RouteDocumentation, 
        location: string, 
        schema: Schema
    ): TestCase[] {
        const cases: TestCase[] = [];

        for (const [fieldName, fieldSchema] of Object.entries(schema)) {
            // Required 필드 누락 테스트
            if (fieldSchema.required) {
                cases.push(...this.generateMissingFieldCase(route, location, fieldName));
            }

            // 타입 검증 실패 테스트
            cases.push(...this.generateTypeValidationCases(route, location, fieldName, fieldSchema));

            // 범위 검증 실패 테스트
            cases.push(...this.generateRangeValidationCases(route, location, fieldName, fieldSchema));
        }

        return cases;
    }

    /**
     * 필수 필드 누락 케이스 생성
     */
    private static generateMissingFieldCase(
        route: RouteDocumentation, 
        location: string, 
        fieldName: string
    ): TestCase[] {
        const invalidData = this.generateValidData(route.parameters);
        
        if (invalidData[location] && invalidData[location][fieldName] !== undefined) {
            delete invalidData[location][fieldName];
            
            return [{
                name: `${route.method} ${route.path} - Missing Required ${location}.${fieldName}`,
                description: `Request without required ${location} parameter: ${fieldName}`,
                type: 'failure',
                endpoint: route.path,
                method: route.method,
                data: invalidData,
                expectedStatus: 400,
                validationErrors: [`${fieldName} is required`]
            }];
        }

        return [];
    }

    /**
     * 타입 검증 실패 케이스 생성
     */
    private static generateTypeValidationCases(
        route: RouteDocumentation, 
        location: string, 
        fieldName: string, 
        fieldSchema: FieldSchema
    ): TestCase[] {
        const cases: TestCase[] = [];
        const invalidData = this.generateValidData(route.parameters);
        
        if (!invalidData[location]) return cases;

        let invalidValue: any;
        
        switch (fieldSchema.type) {
            case 'string':
            case 'email':
            case 'url':
                invalidValue = 12345; // 숫자를 문자열 대신 사용
                break;
            case 'number':
                invalidValue = 'not-a-number'; // 문자열을 숫자 대신 사용
                break;
            case 'boolean':
                invalidValue = 'not-a-boolean'; // 문자열을 불린 대신 사용
                break;
            case 'array':
                invalidValue = 'not-an-array'; // 문자열을 배열 대신 사용
                break;
            case 'object':
                invalidValue = 'not-an-object'; // 문자열을 객체 대신 사용
                break;
        }

        if (invalidValue !== undefined) {
            invalidData[location][fieldName] = invalidValue;
            
            cases.push({
                name: `${route.method} ${route.path} - Invalid Type for ${location}.${fieldName}`,
                description: `Request with invalid type for ${location} parameter: ${fieldName}`,
                type: 'failure',
                endpoint: route.path,
                method: route.method,
                data: invalidData,
                expectedStatus: 400,
                validationErrors: [`${fieldName} must be of type ${fieldSchema.type}`]
            });
        }

        return cases;
    }

    /**
     * 범위 검증 실패 케이스 생성
     */
    private static generateRangeValidationCases(
        route: RouteDocumentation, 
        location: string, 
        fieldName: string, 
        fieldSchema: FieldSchema
    ): TestCase[] {
        const cases: TestCase[] = [];

        // Min 값 검증 실패
        if (fieldSchema.min !== undefined) {
            const invalidData = this.generateValidData(route.parameters);
            let invalidValue: any;

            if (fieldSchema.type === 'string' || fieldSchema.type === 'email' || fieldSchema.type === 'url') {
                invalidValue = fieldSchema.min > 0 ? '' : 'x'.repeat(Math.max(0, fieldSchema.min - 1));
            } else if (fieldSchema.type === 'number') {
                invalidValue = fieldSchema.min - 1;
            } else if (fieldSchema.type === 'array') {
                invalidValue = fieldSchema.min > 0 ? [] : new Array(Math.max(0, fieldSchema.min - 1)).fill('item');
            }

            if (invalidValue !== undefined && invalidData[location]) {
                invalidData[location][fieldName] = invalidValue;
                
                cases.push({
                    name: `${route.method} ${route.path} - Below Min for ${location}.${fieldName}`,
                    description: `Request with value below minimum for ${location} parameter: ${fieldName}`,
                    type: 'failure',
                    endpoint: route.path,
                    method: route.method,
                    data: invalidData,
                    expectedStatus: 400,
                    validationErrors: [`${fieldName} must be at least ${fieldSchema.min}`]
                });
            }
        }

        // Max 값 검증 실패
        if (fieldSchema.max !== undefined) {
            const invalidData = this.generateValidData(route.parameters);
            let invalidValue: any;

            if (fieldSchema.type === 'string' || fieldSchema.type === 'email' || fieldSchema.type === 'url') {
                invalidValue = 'x'.repeat(fieldSchema.max + 1);
            } else if (fieldSchema.type === 'number') {
                invalidValue = fieldSchema.max + 1;
            } else if (fieldSchema.type === 'array') {
                invalidValue = new Array(fieldSchema.max + 1).fill('item');
            }

            if (invalidValue !== undefined && invalidData[location]) {
                invalidData[location][fieldName] = invalidValue;
                
                cases.push({
                    name: `${route.method} ${route.path} - Above Max for ${location}.${fieldName}`,
                    description: `Request with value above maximum for ${location} parameter: ${fieldName}`,
                    type: 'failure',
                    endpoint: route.path,
                    method: route.method,
                    data: invalidData,
                    expectedStatus: 400,
                    validationErrors: [`${fieldName} must be at most ${fieldSchema.max}`]
                });
            }
        }

        return cases;
    }

    /**
     * 유효한 테스트 데이터 생성
     */
    private static generateValidData(parameters?: {
        query?: Schema;
        params?: Schema;
        body?: Schema;
    }): any {
        const data: any = {};

        if (parameters?.query) {
            data.query = this.generateValidSchemaData(parameters.query);
        }

        if (parameters?.params) {
            data.params = this.generateValidSchemaData(parameters.params);
        }

        if (parameters?.body) {
            data.body = this.generateValidSchemaData(parameters.body);
        }

        return data;
    }

    /**
     * 스키마에 기반한 유효한 데이터 생성
     */
    private static generateValidSchemaData(schema: Schema): any {
        const data: any = {};

        for (const [fieldName, fieldSchema] of Object.entries(schema)) {
            // Required 필드만 생성 (선택적 필드는 랜덤으로 포함)
            if (fieldSchema.required || Math.random() > 0.5) {
                data[fieldName] = this.generateValidFieldValue(fieldSchema);
            }
        }

        return data;
    }

    /**
     * 필드 스키마에 기반한 유효한 값 생성
     */
    private static generateValidFieldValue(fieldSchema: FieldSchema): any {
        switch (fieldSchema.type) {
            case 'string':
                const minLength = fieldSchema.min || 1;
                const maxLength = fieldSchema.max || 50;
                const length = Math.max(minLength, Math.min(maxLength, 10));
                return 'test'.repeat(Math.ceil(length / 4)).substring(0, length);

            case 'email':
                return 'test@example.com';

            case 'url':
                return 'https://example.com';

            case 'number':
                const min = fieldSchema.min || 0;
                const max = fieldSchema.max || 100;
                return Math.floor(Math.random() * (max - min + 1)) + min;

            case 'boolean':
                return Math.random() > 0.5;

            case 'array':
                const arrayMin = fieldSchema.min || 0;
                const arrayMax = fieldSchema.max || 5;
                const arrayLength = Math.max(arrayMin, Math.min(arrayMax, 3));
                return Array.from({ length: arrayLength }, (_, i) => `item${i + 1}`);

            case 'object':
                return { key: 'value', timestamp: new Date().toISOString() };

            default:
                return 'test-value';
        }
    }

    /**
     * 라우트를 경로별로 그룹화
     */
    private static groupRoutesByPath(testSuites: RouteTestSuite[]): RouteGroup[] {
        const groups = new Map<string, RouteTestSuite[]>();

        for (const suite of testSuites) {
            const pathParts = suite.route.path.split('/').filter(part => part && !part.startsWith(':'));
            const basePath = pathParts.length > 0 ? `/${pathParts[0]}` : '/';
            
            if (!groups.has(basePath)) {
                groups.set(basePath, []);
            }
            groups.get(basePath)!.push(suite);
        }

        return Array.from(groups.entries()).map(([path, routes], index) => ({
            id: `group-${index}`,
            path,
            routes,
            totalTests: routes.reduce((sum, route) => sum + route.testCases.length, 0)
        }));
    }

    /**
     * 통계 정보 생성
     */
    private static generateStats(testSuites: RouteTestSuite[]): TestReportStats {
        return {
            totalRoutes: testSuites.length,
            totalTests: testSuites.reduce((sum, suite) => sum + suite.testCases.length, 0),
            successTests: testSuites.reduce((sum, suite) => 
                sum + suite.testCases.filter(tc => tc.type === 'success').length, 0),
            failureTests: testSuites.reduce((sum, suite) => 
                sum + suite.testCases.filter(tc => tc.type === 'failure').length, 0)
        };
    }

    /**
     * EJS 템플릿을 사용한 HTML 테스트 리포트 생성
     */
    static async generateTestReport(): Promise<string> {
        if (!this.isTestingEnabled()) {
            return '<h1>Testing is not enabled</h1><p>Set NODE_ENV=development and AUTO_DOCS=true to enable testing.</p>';
        }

        try {
            const testSuites = this.generateAllTestCases();
            const routeGroups = this.groupRoutesByPath(testSuites);
            const stats = this.generateStats(testSuites);

            const templatePath = path.join(this.viewsPath, 'test-report.ejs');
            
            const html = await ejs.renderFile(templatePath, {
                stats,
                routeGroups,
                testSuites
            }, {
                views: [this.viewsPath]
            });

            return html;        } catch (error: any) {
            log.error('Failed to generate test report', { error: error.message });
            return `
                <h1>Error generating test report</h1>
                <p>Error: ${error.message}</p>
                <p>Make sure the views directory exists at: ${this.viewsPath}</p>
            `;
        }
    }

    /**
     * 동기적 HTML 테스트 리포트 생성 (fallback)
     */
    static generateTestReportSync(): string {
        if (!this.isTestingEnabled()) {
            return '<h1>Testing is not enabled</h1><p>Set NODE_ENV=development and AUTO_DOCS=true to enable testing.</p>';
        }

        const testSuites = this.generateAllTestCases();
        const routeGroups = this.groupRoutesByPath(testSuites);
        const stats = this.generateStats(testSuites);

        // Simple HTML template as fallback
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Test Report</title>
    <link rel="stylesheet" href="/test-styles.css">
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 API Test Report</h1>
            <p>Automated test cases for API routes</p>
            
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-number routes">${stats.totalRoutes}</div>
                    <div class="stat-label">Routes</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number total">${stats.totalTests}</div>
                    <div class="stat-label">Total Tests</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number success">${stats.successTests}</div>
                    <div class="stat-label">Success Cases</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number failure">${stats.failureTests}</div>
                    <div class="stat-label">Failure Cases</div>
                </div>
            </div>
        </div>

        <div class="controls">
            <div class="search-container">
                <input type="text" class="search-input" id="searchInput" placeholder="🔍 Search test cases...">
            </div>
            <div class="filter-container">
                <button class="filter-btn active" data-filter="all">All</button>
                <button class="filter-btn" data-filter="success">Success</button>
                <button class="filter-btn" data-filter="failure">Failure</button>
            </div>
        </div>
        
        <div class="bulk-actions">
            <button class="bulk-btn expand-all" onclick="expandAll()">Expand All</button>
            <button class="bulk-btn collapse-all" onclick="collapseAll()">Collapse All</button>
            <button class="bulk-btn run-all" onclick="runAllTests()">Run All Tests</button>
        </div>
        
        <div id="testResults">
            ${this.generateRouteGroupsHTML(routeGroups)}
        </div>
        
        <div id="noResults" class="no-results" style="display: none;">
            <h3>No test cases found</h3>
            <p>Try adjusting your search or filter criteria</p>
        </div>
    </div>
    
    <script src="/test-scripts.js"></script>
</body>
</html>`;
    }

    /**
     * 라우트 그룹 HTML 생성 (fallback용)
     */
    private static generateRouteGroupsHTML(routeGroups: RouteGroup[]): string {
        return routeGroups.map(group => `
            <div class="route-group" data-path="${group.path}">
                <div class="route-group-header" onclick="toggleGroup('${group.id}')">
                    <div class="route-group-title">
                        <span class="path-icon">📁</span>
                        ${group.path || 'Root Path'}
                    </div>
                    <div class="route-group-stats">
                        <span class="route-count">${group.routes.length} routes</span>
                        <span class="test-count">${group.totalTests} tests</span>
                        <span class="collapse-icon">▼</span>
                    </div>
                </div>
                
                <div class="route-group-content" id="${group.id}">
                    ${group.routes.map(testSuite => this.generateTestSuiteHTML(testSuite)).join('')}
                </div>
            </div>
        `).join('');
    }

    /**
     * 테스트 스위트 HTML 생성 (fallback용)
     */
    private static generateTestSuiteHTML(testSuite: RouteTestSuite): string {
        const suiteId = `${testSuite.route.method}-${testSuite.route.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
        
        return `
            <div class="test-suite" data-method="${testSuite.route.method}" data-path="${testSuite.route.path}">
                <div class="suite-header" onclick="toggleSuite('${suiteId}')">
                    <div class="suite-title">
                        <div class="route-info">
                            <span class="method-badge ${testSuite.route.method}">${testSuite.route.method}</span>
                            <span class="route-path">${testSuite.route.path}</span>
                            ${testSuite.route.summary ? `<span class="route-summary"> - ${testSuite.route.summary}</span>` : ''}
                        </div>
                        <div class="suite-stats">
                            <span class="test-count">${testSuite.testCases.length} tests</span>
                            <span class="collapse-icon">▼</span>
                        </div>
                    </div>
                </div>
                
                <div class="suite-content" id="suite-${suiteId}">
                    ${testSuite.testCases.map((testCase, index) => 
                        this.generateTestCaseHTML(testCase, index, suiteId)).join('')}
                </div>
            </div>
        `;
    }

    /**
     * 테스트 케이스 HTML 생성 (fallback용)
     */
    private static generateTestCaseHTML(testCase: TestCase, index: number, suiteId: string): string {
        const testDataJson = testCase.data ? JSON.stringify(testCase.data, null, 2) : '';
        const testDataStr = JSON.stringify(testCase.data || {}).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
        
        return `
            <div class="test-case ${testCase.type}" 
                 data-type="${testCase.type}" 
                 data-method="${testCase.method}" 
                 data-endpoint="${testCase.endpoint}">
                
                <div class="test-info">
                    <div class="test-name">${testCase.name}</div>
                    <div class="test-description">${testCase.description}</div>
                    <div class="test-details">
                        Expected Status: <strong>${testCase.expectedStatus}</strong>
                        ${testCase.expectedErrors && testCase.expectedErrors.length > 0 ? 
                            `| Expected Errors: <strong>${testCase.expectedErrors.join(', ')}</strong>` : ''}
                    </div>
                    
                    ${testCase.data && Object.keys(testCase.data).length > 0 ? `
                        <div class="test-data" onclick="toggleTestData('${suiteId}-${index}')">
                            <div class="data-header">
                                📋 Test Data <span class="expand-icon">▼</span>
                                <button class="copy-btn" onclick="event.stopPropagation(); copyTestData('${testDataStr}')">
                                    Copy
                                </button>
                            </div>
                            <div class="data-content" id="data-${suiteId}-${index}" style="display: none;">
                                <pre>${testDataJson}</pre>
                            </div>
                        </div>
                    ` : ''}
                </div>
                
                <div class="test-actions">
                    <span class="test-badge ${testCase.type}">${testCase.type}</span>
                    <button class="run-test-btn" 
                            onclick="runTest(
                                '${testCase.method}', 
                                '${testCase.endpoint}', 
                                ${testDataStr}, 
                                ${testCase.expectedStatus}, 
                                'result-${suiteId}-${index}'
                            )">
                        Run Test
                    </button>
                </div>
                
                <div id="result-${suiteId}-${index}" class="test-result" style="display: none;"></div>
            </div>
        `;
    }

    /**
     * 테스트 케이스 JSON 반환
     */
    static generateTestCasesJSON(): any {
        if (!this.isTestingEnabled()) {
            return { error: 'Testing is not enabled' };
        }

        try {
            const testSuites = this.generateAllTestCases();
            const stats = this.generateStats(testSuites);

            return {
                metadata: {
                    generatedAt: new Date().toISOString(),
                    totalRoutes: stats.totalRoutes,
                    totalTests: stats.totalTests,
                    successTests: stats.successTests,
                    failureTests: stats.failureTests
                },
                testSuites: testSuites.map(suite => ({
                    route: {
                        method: suite.route.method,
                        path: suite.route.path,
                        summary: suite.route.summary,
                        description: suite.route.description,
                        tags: suite.route.tags
                    },
                    testCases: suite.testCases
                }))
            };
        } catch (error: any) {
            log.error('Failed to generate test cases JSON', { error: error.message });
            return { error: 'Failed to generate test cases JSON', details: error.message };
        }
    }

    /**
     * Postman Collection 생성
     */
    static generatePostmanCollection(): any {
        if (!this.isTestingEnabled()) {
            return { error: 'Testing is not enabled' };
        }

        try {
            const testSuites = this.generateAllTestCases();
            const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

            const collection = {
                info: {
                    name: 'Express Kusto API Test Collection',
                    description: 'Auto-generated test collection for API routes',
                    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                },
                variable: [
                    {
                        key: 'baseUrl',
                        value: baseUrl,
                        type: 'string'
                    }
                ],
                item: [] as any[]
            };

            for (const testSuite of testSuites) {
                const folder = {
                    name: `${testSuite.route.method.toUpperCase()} ${testSuite.route.path}`,
                    description: testSuite.route.description || testSuite.route.summary,
                    item: [] as any[]
                };

                for (const testCase of testSuite.testCases) {
                    const request: any = {
                        name: testCase.name,
                        request: {
                            method: testCase.method.toUpperCase(),
                            header: [
                                {
                                    key: 'Content-Type',
                                    value: 'application/json'
                                }
                            ],
                            url: {
                                raw: `{{baseUrl}}${testCase.endpoint}`,
                                host: ['{{baseUrl}}'],
                                path: testCase.endpoint.split('/').filter(p => p)
                            }
                        },
                        response: []
                    };

                    // Add query parameters
                    if (testCase.data?.query) {
                        request.request.url.query = Object.entries(testCase.data.query).map(([key, value]) => ({
                            key,
                            value: String(value),
                            disabled: false
                        }));
                    }

                    // Add body data
                    if (testCase.data?.body && ['POST', 'PUT', 'PATCH'].includes(testCase.method.toUpperCase())) {
                        request.request.body = {
                            mode: 'raw',
                            raw: JSON.stringify(testCase.data.body, null, 2),
                            options: {
                                raw: {
                                    language: 'json'
                                }
                            }
                        };
                    }

                    // Add test script
                    request.event = [{
                        listen: 'test',
                        script: {
                            type: 'text/javascript',
                            exec: [
                                `// ${testCase.description}`,
                                `pm.test("Status code is ${testCase.expectedStatus}", function () {`,
                                `    pm.response.to.have.status(${testCase.expectedStatus});`,
                                `});`,
                                '',
                                'pm.test("Response time is less than 2000ms", function () {',
                                '    pm.expect(pm.response.responseTime).to.be.below(2000);',
                                '});',
                                '',
                                'pm.test("Response has JSON body", function () {',
                                '    pm.response.to.be.json;',
                                '});'
                            ]
                        }
                    }];

                    folder.item.push(request);
                }

                collection.item.push(folder);
            }

            return collection;
        } catch (error: any) {
            log.error('Failed to generate Postman collection', { error: error.message });
            return { error: 'Failed to generate Postman collection', details: error.message };
        }
    }
}
