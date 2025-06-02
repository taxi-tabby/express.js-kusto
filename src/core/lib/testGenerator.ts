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
    expectedData?: any; // Expected response data for validation
    expectedErrors?: string[];
    validationErrors?: string[];
    securityTestType?: string; // SQL injection, XSS, etc.
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
    securityTests: number;
    philosophyTests: number;
    philosophyScore: number; // 전체 철학 준수 점수
    philosophyViolations: PhilosophyViolation[];
}

export interface PhilosophyViolation {
    type: 'naming' | 'restful' | 'http-spec' | 'structure';
    severity: 'error' | 'warning';
    message: string;
    suggestion?: string;
    route: string;
    method: string;
}

export interface PhilosophyValidationResult {
    violations: PhilosophyViolation[];
    isValid: boolean;
    score: number; // 0-100, 철학 준수 점수
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
    }    /**
     * 특정 라우트의 테스트 케이스 생성
     */
    private static generateTestCasesForRoute(route: RouteDocumentation): TestCase[] {
        const testCases: TestCase[] = [];

        // 0. 개발 철학 검증 케이스 생성
        const philosophyCases = this.generatePhilosophyTestCases(route);
        testCases.push(...philosophyCases);

        // 1. 성공 케이스 생성
        const successCase = this.generateSuccessCase(route);
        if (successCase) {
            testCases.push(successCase);
        }

        // 2. 실패 케이스 생성
        const failureCases = this.generateFailureCases(route);
        testCases.push(...failureCases);

        return testCases;
    }/**
     * 성공 케이스 생성
     */
    private static generateSuccessCase(route: RouteDocumentation): TestCase | null {
        const validData = this.generateValidData(route.parameters);
        
        // Determine expected status code from response schema
        let expectedStatus = 200;
        let expectedData = undefined;
        
        if (route.responses) {
            // Find the success status code (2xx range)
            const statusCodes = Object.keys(route.responses).map(Number);
            const successStatusCode = statusCodes.find(code => code >= 200 && code < 300);
            
            if (successStatusCode) {
                expectedStatus = successStatusCode;
                const responseSchema = route.responses[successStatusCode];
                
                // Generate expected response data based on schema
                if (responseSchema && typeof responseSchema === 'object') {
                    expectedData = this.generateExpectedResponseData(responseSchema, validData);
                }
            }
        }
        
        const testCase: TestCase = {
            name: `${route.method} ${route.path} - Success Case`,
            description: `Valid request with all required fields`,
            type: 'success',
            endpoint: route.path,
            method: route.method,
            data: validData,
            expectedStatus
        };
        
        // Add expected data if available
        if (expectedData) {
            testCase.expectedData = expectedData;
        }
        
        return testCase;
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
            
            // 보안 공격 테스트 케이스 생성
            cases.push(...this.generateSecurityTestCases(route, location, fieldName, fieldSchema));
        }

        return cases;
    }

    /**
     * 보안 공격 테스트 케이스 생성 (SQL 인젝션, 특수문자)
     */
    private static generateSecurityTestCases(
        route: RouteDocumentation, 
        location: string, 
        fieldName: string, 
        fieldSchema: FieldSchema
    ): TestCase[] {
        const cases: TestCase[] = [];
        const invalidData = this.generateValidData(route.parameters);
        
        if (!invalidData[location]) return cases;
        
        // 필드 타입에 따라 다른 공격 패턴 적용
        const attackPatterns = this.getSecurityAttackPatterns(fieldSchema.type);
        
        for (const pattern of attackPatterns) {
            const attackData = JSON.parse(JSON.stringify(invalidData)); // 깊은 복사
            attackData[location][fieldName] = pattern.value;
              cases.push({
                name: `${route.method} ${route.path} - Security Attack: ${pattern.type} for ${location}.${fieldName}`,
                description: `${pattern.description} in ${location} parameter: ${fieldName}`,
                type: 'failure',
                endpoint: route.path,
                method: route.method,
                data: attackData,
                expectedStatus: 400,
                validationErrors: [`${fieldName} contains potentially malicious content`],
                securityTestType: pattern.type
            });
        }
        
        return cases;
    }
    
    /**
     * 필드 타입별 보안 공격 패턴 생성
     */
    private static getSecurityAttackPatterns(fieldType: string): Array<{type: string, value: any, description: string}> {
        const patterns: Array<{type: string, value: any, description: string}> = [];
        
        // 공통 SQL Injection 패턴
        const sqlInjectionPatterns = [
            { 
                type: 'SQLi-Basic', 
                value: "' OR '1'='1", 
                description: 'Basic SQL injection attack' 
            },
            { 
                type: 'SQLi-Comment', 
                value: "'; --", 
                description: 'SQL injection with comment' 
            },
            { 
                type: 'SQLi-Union', 
                value: "' UNION SELECT username,password FROM users; --", 
                description: 'UNION-based SQL injection attack' 
            },
            { 
                type: 'SQLi-Batch', 
                value: "'; DROP TABLE users; --", 
                description: 'Batch SQL injection attack' 
            }
        ];
        
        // 타입별 특수 공격 패턴
        switch (fieldType) {
            case 'string':
                // 문자열 타입에 대한 공격
                patterns.push(...sqlInjectionPatterns);
                patterns.push(
                    { 
                        type: 'XSS-Basic', 
                        value: "<script>alert('XSS')</script>", 
                        description: 'Basic XSS attack' 
                    },
                    { 
                        type: 'XSS-Attribute', 
                        value: "\" onmouseover=\"alert('XSS')\" ", 
                        description: 'Event-based XSS attack' 
                    },
                    { 
                        type: 'Command-Injection', 
                        value: "$(cat /etc/passwd)", 
                        description: 'Command injection attack' 
                    },
                    { 
                        type: 'Special-Chars', 
                        value: "!@#$%^&*()_+{}[]|\\:;\"'<>,.?/~`", 
                        description: 'Special character injection' 
                    }
                );
                break;
                
            case 'email':
                // 이메일 타입에 대한 공격
                patterns.push(
                    { 
                        type: 'Email-SQLi', 
                        value: "user@example.com' OR '1'='1", 
                        description: 'SQL injection in email field' 
                    },
                    { 
                        type: 'Email-XSS', 
                        value: "user@<script>alert('XSS')</script>.com", 
                        description: 'XSS in email field' 
                    },
                    { 
                        type: 'Email-Special', 
                        value: "user+bypass@example.com';--", 
                        description: 'Email with special characters and SQL injection' 
                    }
                );
                break;
                
            case 'url':
                // URL 타입에 대한 공격
                patterns.push(
                    { 
                        type: 'URL-SQLi', 
                        value: "https://example.com?id=' OR '1'='1", 
                        description: 'SQL injection in URL field' 
                    },
                    { 
                        type: 'URL-XSS', 
                        value: "javascript:alert('XSS')", 
                        description: 'JavaScript URL XSS attack' 
                    },
                    { 
                        type: 'URL-SSRF', 
                        value: "http://localhost:3000/admin", 
                        description: 'Server Side Request Forgery attempt' 
                    },
                    { 
                        type: 'URL-PathTraversal', 
                        value: "https://example.com/../../../etc/passwd", 
                        description: 'Path traversal attack in URL' 
                    }
                );
                break;
                
            case 'number':
                // 숫자 타입에 대한 공격
                patterns.push(
                    { 
                        type: 'Number-SQLi', 
                        value: "1 OR 1=1", 
                        description: 'SQL injection in numeric field' 
                    },
                    { 
                        type: 'Number-Overflow', 
                        value: Number.MAX_SAFE_INTEGER + 1, 
                        description: 'Integer overflow attack' 
                    },
                    { 
                        type: 'Number-Negative', 
                        value: -1, 
                        description: 'Negative number attack' 
                    },
                    { 
                        type: 'Number-Zero', 
                        value: 0, 
                        description: 'Zero value attack' 
                    }
                );
                break;
                
            case 'boolean':
                // 불리언 타입에 대한 공격
                patterns.push(
                    { 
                        type: 'Boolean-SQLi', 
                        value: "true OR 1=1", 
                        description: 'SQL injection in boolean field' 
                    },
                    { 
                        type: 'Boolean-String', 
                        value: "true; DROP TABLE users;", 
                        description: 'SQL injection with string in boolean field' 
                    }
                );
                break;
                
            case 'array':
                // 배열 타입에 대한 공격
                patterns.push(
                    { 
                        type: 'Array-SQLi', 
                        value: ["normal", "'; DROP TABLE users; --"], 
                        description: 'SQL injection in array item' 
                    },
                    { 
                        type: 'Array-XSS', 
                        value: ["normal", "<script>alert('XSS')</script>"], 
                        description: 'XSS in array item' 
                    },
                    { 
                        type: 'Array-Overflow', 
                        value: Array(1000).fill("x"), 
                        description: 'Array overflow attack with excessive items' 
                    }
                );
                break;
                
            case 'object':
                // 객체 타입에 대한 공격
                patterns.push(
                    { 
                        type: 'Object-Pollution', 
                        value: { "__proto__": { "polluted": true } }, 
                        description: 'Prototype pollution attack' 
                    },
                    { 
                        type: 'Object-SQLi', 
                        value: { "key": "value", "injection": "' OR '1'='1" }, 
                        description: 'SQL injection in object property' 
                    },
                    { 
                        type: 'Object-XSS', 
                        value: { "key": "<script>alert('XSS')</script>" }, 
                        description: 'XSS in object property' 
                    },
                    { 
                        type: 'Object-DoS', 
                        value: JSON.parse('{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{}}}}}}}}}}}'), 
                        description: 'Deeply nested object DoS attack' 
                    }
                );
                break;
                
            default:
                // 기본 공격 패턴
                patterns.push(...sqlInjectionPatterns);
                patterns.push(
                    { 
                        type: 'XSS-Basic', 
                        value: "<script>alert('XSS')</script>", 
                        description: 'Basic XSS attack' 
                    }
                );
        }
        
        return patterns;
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
    }    /**
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
        let shouldGenerateTypeCase = true;
        
        // For GET/HEAD requests with query parameters, we can't send non-string types
        // since HTTP query parameters are always strings. Instead, generate constraint violations.
        const isQueryParam = location === 'query' && ['GET', 'HEAD'].includes(route.method.toUpperCase());
        
        switch (fieldSchema.type) {
            case 'string':
            case 'email':
            case 'url':
                if (isQueryParam) {
                    // For query parameters, generate a constraint violation instead
                    if (fieldSchema.min !== undefined && fieldSchema.min > 0) {
                        // Generate a string shorter than minimum length
                        invalidValue = fieldSchema.min === 1 ? '' : 'x'.repeat(fieldSchema.min - 1);
                        shouldGenerateTypeCase = true;
                    } else {
                        // Skip type validation for string query params without constraints
                        shouldGenerateTypeCase = false;
                    }
                } else {
                    invalidValue = 12345; // 숫자를 문자열 대신 사용
                }
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

        if (invalidValue !== undefined && shouldGenerateTypeCase) {
            invalidData[location][fieldName] = invalidValue;
            
            const testName = isQueryParam && (fieldSchema.type === 'string' || fieldSchema.type === 'email' || fieldSchema.type === 'url')
                ? `${route.method} ${route.path} - Below Min Length for ${location}.${fieldName}`
                : `${route.method} ${route.path} - Invalid Type for ${location}.${fieldName}`;
                
            const description = isQueryParam && (fieldSchema.type === 'string' || fieldSchema.type === 'email' || fieldSchema.type === 'url')
                ? `Request with value below minimum length for ${location} parameter: ${fieldName}`
                : `Request with invalid type for ${location} parameter: ${fieldName}`;
                
            const expectedError = isQueryParam && (fieldSchema.type === 'string' || fieldSchema.type === 'email' || fieldSchema.type === 'url')
                ? `${fieldName} must be at least ${fieldSchema.min} characters/items`
                : `${fieldName} must be of type ${fieldSchema.type}`;
            
            cases.push({
                name: testName,
                description: description,
                type: 'failure',
                endpoint: route.path,
                method: route.method,
                data: invalidData,
                expectedStatus: 400,
                validationErrors: [expectedError]
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
                return { key: 'value', timestamp: new Date().toISOString() };            default:
                return 'test-value';
        }
    }

    /**
     * 응답 스키마에 기반한 예상 응답 데이터 생성
     */
    private static generateExpectedResponseData(responseSchema: Schema, inputData?: any): any {
        // For schema validation mode
        if (Object.keys(responseSchema).every(key => typeof responseSchema[key] === 'string')) {
            return {
                mode: 'schema',
                schema: responseSchema
            };
        }
        
        // Generate sample response data with partial matching for dynamic fields
        const expectedData: any = {};
        
        for (const [fieldName, fieldSchema] of Object.entries(responseSchema)) {
            if (fieldSchema.required) {
                // For required fields, generate expected values
                if (fieldName === 'id') {
                    // ID fields should exist but value can vary
                    expectedData[fieldName] = { type: 'number', required: true };
                } else if (fieldName === 'createdAt' || fieldName === 'updatedAt' || fieldName === 'timestamp') {
                    // Timestamp fields should exist but value can vary
                    expectedData[fieldName] = { type: 'string', required: true, pattern: 'ISO8601' };
                } else if (fieldName === 'message' && inputData?.query?.name) {
                    // Message fields often have predictable content
                    expectedData[fieldName] = `Hello ${inputData.query.name}!`;
                } else if (fieldName === 'name' && inputData?.body?.name) {
                    // Echo back input data
                    expectedData[fieldName] = inputData.body.name;
                } else if (fieldName === 'email' && inputData?.body?.email) {
                    // Echo back input data
                    expectedData[fieldName] = inputData.body.email;
                } else {
                    // Generate sample value for other required fields
                    expectedData[fieldName] = this.generateValidFieldValue(fieldSchema);
                }
            }
        }
        
        // Return as partial match mode for flexible validation
        return {
            mode: 'partial',
            value: expectedData
        };
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
    }    /**
     * 통계 정보 생성
     */    private static generateStats(testSuites: RouteTestSuite[]): TestReportStats {
        // 전체 철학 검증 수행
        const philosophyResult = this.validateDevelopmentPhilosophy();
        
        return {
            totalRoutes: testSuites.length,
            totalTests: testSuites.reduce((sum, suite) => sum + suite.testCases.length, 0),
            successTests: testSuites.reduce((sum, suite) => 
                sum + suite.testCases.filter(tc => tc.type === 'success').length, 0),
            failureTests: testSuites.reduce((sum, suite) => 
                sum + suite.testCases.filter(tc => tc.type === 'failure').length, 0),
            securityTests: testSuites.reduce((sum, suite) => 
                sum + suite.testCases.filter(tc => 
                    tc.name.includes('Security Attack')).length, 0),
            philosophyTests: testSuites.reduce((sum, suite) => 
                sum + suite.testCases.filter(tc => 
                    tc.securityTestType && tc.securityTestType.includes('philosophy')).length, 0),
            philosophyScore: philosophyResult.score,
            philosophyViolations: philosophyResult.violations
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
<head>    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">    <title>API Test Report</title>
    <link rel="stylesheet" href="/test-styles.css">
    <link rel="stylesheet" href="/summary-styles.css">
    <script src="/test-scripts-optimized.js"></script>
    <script src="/test-fixes.js"></script>
    <script src="/progress-fix.js"></script>
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
                </div>                <div class="stat-card">
                    <div class="stat-number failure">${stats.failureTests}</div>
                    <div class="stat-label">Failure Cases</div>
                </div>                <div class="stat-card">
                    <div class="stat-number security" style="color: #FF5722;">${stats.securityTests}</div>
                    <div class="stat-label">Security Tests</div>
                </div>
            </div>
        </div>

        <div class="controls">
            <div class="search-container">
                <input type="text" class="search-input" id="searchInput" placeholder="🔍 Search test cases...">
            </div>            <div class="filter-container">
                <button class="filter-btn active" data-filter="all">All</button>
                <button class="filter-btn" data-filter="success">Success</button>
                <button class="filter-btn" data-filter="failure">Failure</button>
                <button class="filter-btn" data-filter="security">Security</button>
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
        </div>    </div>
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
        
        return `            <div class="test-case ${testCase.type} ${testCase.securityTestType ? 'security' : ''}" 
                 data-type="${testCase.type}" 
                 data-method="${testCase.method}" 
                 data-endpoint="${testCase.endpoint}"
                 ${testCase.securityTestType ? `data-security-type="${testCase.securityTestType}"` : ''}>
                
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
                metadata: {                    generatedAt: new Date().toISOString(),
                    totalRoutes: stats.totalRoutes,
                    totalTests: stats.totalTests,
                    successTests: stats.successTests,
                    failureTests: stats.failureTests,
                    securityTests: stats.securityTests
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
                    }                    // Add test script with additional test for security cases
                    const execScript = [
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
                    ];
                    
                    // Add additional tests for security test cases
                    if (testCase.securityTestType) {
                        execScript.push(
                            '',
                            `// Additional security test: ${testCase.securityTestType}`,
                            'pm.test("Response should contain security validation error", function () {',
                            '    const jsonData = pm.response.json();',
                            '    pm.expect(jsonData.errors).to.exist;',
                            '    const errorsExist = Array.isArray(jsonData.errors) && jsonData.errors.length > 0;',
                            '    pm.expect(errorsExist).to.be.true;',
                            '});'
                        );
                    }
                    
                    request.event = [{
                        listen: 'test',
                        script: {
                            type: 'text/javascript',
                            exec: execScript
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

    /**
     * CMS 개발 철학 검증
     */
    static validateDevelopmentPhilosophy(): PhilosophyValidationResult {
        if (!this.isTestingEnabled()) {
            return {
                violations: [],
                isValid: true,
                score: 100
            };
        }

        this.routes = DocumentationGenerator.getRoutes();
        const violations: PhilosophyViolation[] = [];

        for (const route of this.routes) {
            // 1. 라우트 경로 네이밍 검증
            violations.push(...this.validateRouteNaming(route));
            
            // 2. RESTful API 스펙 검증
            violations.push(...this.validateRESTfulSpecs(route));
            
            // 3. HTTP 스펙 검증
            violations.push(...this.validateHTTPSpecs(route));
        }

        const score = this.calculatePhilosophyScore(violations);
        const isValid = violations.filter(v => v.severity === 'error').length === 0;

        return {
            violations,
            isValid,
            score
        };
    }

    /**
     * 라우트 네이밍 규칙 검증
     * 1. 대문자 금지
     * 2. 단일 단어 사용
     * 3. 공통 기능의 경우 중복 단어를 앞으로
     */
    private static validateRouteNaming(route: RouteDocumentation): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];
        const pathSegments = route.path.split('/').filter(segment => segment && !segment.startsWith(':'));

        // 1. 대문자 검증
        for (const segment of pathSegments) {
            if (/[A-Z]/.test(segment)) {
                violations.push({
                    type: 'naming',
                    severity: 'error',
                    message: `라우트 경로에 대문자가 포함되어 있습니다: '${segment}'`,
                    suggestion: `'${segment.toLowerCase()}'로 변경하세요`,
                    route: route.path,
                    method: route.method
                });
            }
        }

        // 2. 단일 단어 규칙 검증 (하이픈이나 언더스코어로 연결된 경우 검증)
        for (const segment of pathSegments) {
            if (segment.includes('-') || segment.includes('_')) {
                const words = segment.split(/[-_]/);
                if (words.length > 2) {
                    violations.push({
                        type: 'naming',
                        severity: 'warning',
                        message: `라우트 세그먼트가 너무 복잡합니다: '${segment}'`,
                        suggestion: `더 간단한 단일 단어로 변경하거나 리소스 구조를 재검토하세요`,
                        route: route.path,
                        method: route.method
                    });
                }
            }
        }

        // 3. 공통 기능 네이밍 검증
        violations.push(...this.validateCommonResourceNaming(route, pathSegments));

        return violations;
    }

    /**
     * 공통 리소스 네이밍 규칙 검증
     */
    private static validateCommonResourceNaming(route: RouteDocumentation, pathSegments: string[]): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];
        
        // 모든 라우트에서 공통 패턴 찾기
        const allRoutes = this.routes;
        const commonPatterns = this.findCommonPatterns(allRoutes);
        
        for (const pattern of commonPatterns) {
            const routeHasPattern = pathSegments.some(segment => 
                pattern.words.some(word => segment.includes(word))
            );
            
            if (routeHasPattern) {
                // 공통 단어가 경로의 앞쪽에 있는지 확인
                const patternWords = pattern.words;
                const firstSegmentIndex = pathSegments.findIndex(segment =>
                    patternWords.some(word => segment.includes(word))
                );
                
                if (firstSegmentIndex > 1) { // /api 등의 기본 prefix 제외
                    violations.push({
                        type: 'structure',
                        severity: 'warning',
                        message: `공통 기능 '${pattern.words.join(', ')}'이 경로 뒤쪽에 위치합니다`,
                        suggestion: `공통 기능을 경로 앞쪽으로 이동하세요 (예: /${pattern.words[0]}/.../)`,
                        route: route.path,
                        method: route.method
                    });
                }
            }
        }
        
        return violations;
    }

    /**
     * 공통 패턴 찾기
     */
    private static findCommonPatterns(routes: RouteDocumentation[]): Array<{words: string[], count: number}> {
        const wordCount: Map<string, number> = new Map();
        const patterns: Array<{words: string[], count: number}> = [];
        
        // 모든 라우트에서 단어 추출
        for (const route of routes) {
            const segments = route.path.split('/').filter(segment => segment && !segment.startsWith(':'));
            for (const segment of segments) {
                const words = segment.split(/[-_]/);
                for (const word of words) {
                    if (word.length > 2) { // 짧은 단어 제외
                        wordCount.set(word, (wordCount.get(word) || 0) + 1);
                    }
                }
            }
        }
        
        // 2개 이상의 라우트에서 사용되는 단어들을 공통 패턴으로 간주
        for (const [word, count] of wordCount.entries()) {
            if (count >= 2) {
                patterns.push({words: [word], count});
            }
        }
        
        return patterns.sort((a, b) => b.count - a.count);
    }

    /**
     * RESTful API 스펙 검증
     */
    private static validateRESTfulSpecs(route: RouteDocumentation): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];

        // HTTP 메서드와 경로 패턴 검증
        const pathSegments = route.path.split('/').filter(segment => segment);
        const hasIdParam = pathSegments.some(segment => segment.startsWith(':'));
        const method = route.method.toUpperCase();

        // 1. GET 요청 검증
        if (method === 'GET') {
            // GET /resources/:id 패턴 검증
            if (hasIdParam && !route.path.endsWith('/:id') && !route.path.includes('/:id/')) {
                violations.push({
                    type: 'restful',
                    severity: 'warning',
                    message: 'GET 요청에서 ID 파라미터는 일반적으로 /:id 형식을 사용합니다',
                    suggestion: '리소스 식별자를 /:id 형식으로 변경하세요',
                    route: route.path,
                    method: route.method
                });
            }
        }

        // 2. POST 요청 검증
        if (method === 'POST') {
            if (hasIdParam) {
                violations.push({
                    type: 'restful',
                    severity: 'error',
                    message: 'POST 요청은 일반적으로 ID 파라미터를 포함하지 않습니다',
                    suggestion: 'POST는 컬렉션 경로에 사용하고, 특정 리소스 수정은 PUT/PATCH를 사용하세요',
                    route: route.path,
                    method: route.method
                });
            }
        }

        // 3. PUT/PATCH 요청 검증
        if (method === 'PUT' || method === 'PATCH') {
            if (!hasIdParam) {
                violations.push({
                    type: 'restful',
                    severity: 'error',
                    message: `${method} 요청은 특정 리소스를 대상으로 해야 하므로 ID 파라미터가 필요합니다`,
                    suggestion: '경로에 /:id 파라미터를 추가하세요',
                    route: route.path,
                    method: route.method
                });
            }
        }

        // 4. DELETE 요청 검증
        if (method === 'DELETE') {
            if (!hasIdParam) {
                violations.push({
                    type: 'restful',
                    severity: 'error',
                    message: 'DELETE 요청은 특정 리소스를 대상으로 해야 하므로 ID 파라미터가 필요합니다',
                    suggestion: '경로에 /:id 파라미터를 추가하세요',
                    route: route.path,
                    method: route.method
                });
            }
        }

        // 5. 복수형 리소스명 검증
        const resourceSegment = pathSegments.find(segment => !segment.startsWith(':'));
        if (resourceSegment) {
            violations.push(...this.validateResourcePluralization(route, resourceSegment));
        }

        // 6. 중첩 리소스 깊이 검증
        const nestingLevel = pathSegments.filter(segment => segment.startsWith(':')).length;
        if (nestingLevel > 2) {
            violations.push({
                type: 'restful',
                severity: 'warning',
                message: '중첩 리소스가 너무 깊습니다 (3단계 이상)',
                suggestion: '리소스 구조를 단순화하거나 쿼리 파라미터를 사용하는 것을 고려하세요',
                route: route.path,
                method: route.method
            });
        }

        return violations;
    }

    /**
     * 리소스 복수형 검증
     */
    private static validateResourcePluralization(route: RouteDocumentation, resourceName: string): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];
        
        // 일반적인 복수형 패턴 검증
        const commonSingulars = ['user', 'post', 'comment', 'file', 'image', 'document', 'category', 'tag'];
        const singularToPlural: {[key: string]: string} = {
            'user': 'users',
            'post': 'posts', 
            'comment': 'comments',
            'file': 'files',
            'image': 'images',
            'document': 'documents',
            'category': 'categories',
            'tag': 'tags'
        };

        for (const singular of commonSingulars) {
            if (resourceName === singular) {
                violations.push({
                    type: 'restful',
                    severity: 'warning',
                    message: `리소스명이 단수형입니다: '${singular}'`,
                    suggestion: `복수형 '${singularToPlural[singular]}'을 사용하세요`,
                    route: route.path,
                    method: route.method
                });
                break;
            }
        }

        return violations;
    }

    /**
     * HTTP 스펙 검증
     */
    private static validateHTTPSpecs(route: RouteDocumentation): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];

        // 1. HTTP 메서드 검증
        const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
        if (!validMethods.includes(route.method.toUpperCase())) {
            violations.push({
                type: 'http-spec',
                severity: 'error',
                message: `유효하지 않은 HTTP 메서드: ${route.method}`,
                suggestion: `표준 HTTP 메서드 중 하나를 사용하세요: ${validMethods.join(', ')}`,
                route: route.path,
                method: route.method
            });
        }

        // 2. 응답 상태 코드 검증
        if (route.responses) {
            for (const statusCode of Object.keys(route.responses)) {
                const code = parseInt(statusCode);
                if (isNaN(code) || code < 100 || code > 599) {
                    violations.push({
                        type: 'http-spec',
                        severity: 'error',
                        message: `유효하지 않은 HTTP 상태 코드: ${statusCode}`,
                        suggestion: '100-599 범위의 표준 HTTP 상태 코드를 사용하세요',
                        route: route.path,
                        method: route.method
                    });
                }
            }
        }

        // 3. 메서드별 적절한 응답 코드 검증
        violations.push(...this.validateMethodSpecificResponses(route));

        // 4. 콘텐츠 타입 검증
        violations.push(...this.validateContentTypes(route));

        return violations;
    }

    /**
     * 메서드별 응답 코드 검증
     */
    private static validateMethodSpecificResponses(route: RouteDocumentation): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];
        
        if (!route.responses) return violations;

        const method = route.method.toUpperCase();
        const statusCodes = Object.keys(route.responses).map(Number);

        switch (method) {
            case 'GET':
                if (!statusCodes.includes(200) && !statusCodes.includes(404)) {
                    violations.push({
                        type: 'http-spec',
                        severity: 'warning',
                        message: 'GET 요청은 일반적으로 200 또는 404 응답을 포함해야 합니다',
                        suggestion: '성공 시 200, 리소스를 찾을 수 없을 때 404 응답을 추가하세요',
                        route: route.path,
                        method: route.method
                    });
                }
                break;

            case 'POST':
                if (!statusCodes.includes(201) && !statusCodes.includes(200)) {
                    violations.push({
                        type: 'http-spec',
                        severity: 'warning',
                        message: 'POST 요청은 일반적으로 201 (Created) 또는 200 응답을 포함해야 합니다',
                        suggestion: '리소스 생성 시 201, 처리 완료 시 200 응답을 추가하세요',
                        route: route.path,
                        method: route.method
                    });
                }
                break;

            case 'PUT':
            case 'PATCH':
                if (!statusCodes.includes(200) && !statusCodes.includes(204)) {
                    violations.push({
                        type: 'http-spec',
                        severity: 'warning',
                        message: `${method} 요청은 일반적으로 200 또는 204 응답을 포함해야 합니다`,
                        suggestion: '업데이트 성공 시 200 (응답 본문 포함) 또는 204 (응답 본문 없음)를 추가하세요',
                        route: route.path,
                        method: route.method
                    });
                }
                break;

            case 'DELETE':
                if (!statusCodes.includes(204) && !statusCodes.includes(200)) {
                    violations.push({
                        type: 'http-spec',
                        severity: 'warning',
                        message: 'DELETE 요청은 일반적으로 204 또는 200 응답을 포함해야 합니다',
                        suggestion: '삭제 성공 시 204 (응답 본문 없음) 또는 200 (응답 본문 포함)을 추가하세요',
                        route: route.path,
                        method: route.method
                    });
                }
                break;
        }

        return violations;
    }

    /**
     * 콘텐츠 타입 검증
     */
    private static validateContentTypes(route: RouteDocumentation): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];
        
        // POST, PUT, PATCH 요청에 대한 요청 본문 검증
        const methodsWithBody = ['POST', 'PUT', 'PATCH'];
        if (methodsWithBody.includes(route.method.toUpperCase())) {
            if (!route.parameters?.body) {
                violations.push({
                    type: 'http-spec',
                    severity: 'warning',
                    message: `${route.method} 요청에 요청 본문 스키마가 정의되지 않았습니다`,
                    suggestion: '요청 본문 스키마를 정의하여 Content-Type을 명확히 하세요',
                    route: route.path,
                    method: route.method
                });
            }
        }

        return violations;
    }

    /**
     * 철학 준수 점수 계산
     */
    private static calculatePhilosophyScore(violations: PhilosophyViolation[]): number {
        let score = 100;
        
        for (const violation of violations) {
            switch (violation.severity) {
                case 'error':
                    score -= 10;
                    break;
                case 'warning':
                    score -= 5;
                    break;
            }
        }
        
        return Math.max(0, score);
    }    /**
     * 개발 철학 검증 테스트 케이스 생성
     */
    private static generatePhilosophyTestCases(route: RouteDocumentation): TestCase[] {
        const testCases: TestCase[] = [];
        
        // 개발 철학 검증 실행
        const philosophyResult = this.validateSingleRoutePhilosophy(route);
        
        if (philosophyResult.violations.length > 0) {
            // 위반 타입별로 그룹화하여 더 구체적인 테스트 케이스 생성
            const violationsByType = this.groupViolationsByType(philosophyResult.violations);
            
            for (const [type, violations] of Object.entries(violationsByType)) {
                const severityLevel = violations.some(v => v.severity === 'error') ? 'error' : 'warning';
                const failureReasons = violations.map(v => `${v.message}${v.suggestion ? ` (제안: ${v.suggestion})` : ''}`);
                
                testCases.push({
                    name: `${route.method} ${route.path} - Philosophy Violation: ${type}`,
                    description: this.generatePhilosophyFailureDescription(type, violations),
                    type: 'failure',
                    endpoint: route.path,
                    method: route.method,
                    data: undefined,
                    expectedStatus: severityLevel === 'error' ? 500 : 400,
                    validationErrors: failureReasons,
                    expectedErrors: failureReasons,
                    securityTestType: `philosophy-${type}`
                });
            }
            
            // 전체 철학 준수 점수를 표시하는 종합 테스트 케이스
            testCases.push({
                name: `${route.method} ${route.path} - Philosophy Score`,
                description: `철학 준수 점수: ${philosophyResult.score}/100 (${philosophyResult.violations.length}개 위반사항)`,
                type: philosophyResult.score >= 80 ? 'success' : 'failure',
                endpoint: route.path,
                method: route.method,
                data: undefined,
                expectedStatus: philosophyResult.score >= 80 ? 200 : 400,
                validationErrors: [`Philosophy Score: ${philosophyResult.score}/100`],
                securityTestType: 'philosophy-score'
            });
        } else {
            // 철학을 완벽히 준수하는 경우 긍정적인 테스트 케이스 생성
            testCases.push({
                name: `${route.method} ${route.path} - Philosophy Compliance`,
                description: `🎉 개발 철학을 완벽히 준수하는 라우트입니다 (점수: ${philosophyResult.score}/100)`,
                type: 'success',
                endpoint: route.path,
                method: route.method,
                data: undefined,
                expectedStatus: 200,
                securityTestType: 'philosophy-compliance'
            });
        }
        
        return testCases;
    }

    /**
     * 위반사항을 타입별로 그룹화
     */
    private static groupViolationsByType(violations: PhilosophyViolation[]): {[key: string]: PhilosophyViolation[]} {
        return violations.reduce((acc, violation) => {
            if (!acc[violation.type]) {
                acc[violation.type] = [];
            }
            acc[violation.type].push(violation);
            return acc;
        }, {} as {[key: string]: PhilosophyViolation[]});
    }

    /**
     * 철학 위반 타입별 실패 설명 생성
     */
    private static generatePhilosophyFailureDescription(type: string, violations: PhilosophyViolation[]): string {
        const errorCount = violations.filter(v => v.severity === 'error').length;
        const warningCount = violations.filter(v => v.severity === 'warning').length;
        
        const typeDescription = {
            'naming': '네이밍 규칙',
            'restful': 'RESTful API 스펙',
            'http-spec': 'HTTP 스펙',
            'structure': '구조적 규칙'
        }[type] || type;
        
        let description = `❌ ${typeDescription} 위반 (`;
        if (errorCount > 0) description += `${errorCount}개 오류`;
        if (warningCount > 0) {
            if (errorCount > 0) description += ', ';
            description += `${warningCount}개 경고`;
        }
        description += ')';
        
        // 첫 번째 위반사항의 메시지와 제안 추가
        if (violations.length > 0) {
            const firstViolation = violations[0];
            description += `\n\n주요 문제: ${firstViolation.message}`;
            if (firstViolation.suggestion) {
                description += `\n💡 해결방법: ${firstViolation.suggestion}`;
            }
        }
        
        return description;
    }

    /**
     * 단일 라우트에 대한 개발 철학 검증
     */
    private static validateSingleRoutePhilosophy(route: RouteDocumentation): PhilosophyValidationResult {
        const violations: PhilosophyViolation[] = [];

        // 1. 라우트 경로 네이밍 검증
        violations.push(...this.validateRouteNaming(route));
        
        // 2. RESTful API 스펙 검증
        violations.push(...this.validateRESTfulSpecs(route));
        
        // 3. HTTP 스펙 검증
        violations.push(...this.validateHTTPSpecs(route));

        const score = this.calculatePhilosophyScore(violations);
        const isValid = violations.filter(v => v.severity === 'error').length === 0;

        return {
            violations,
            isValid,
            score
        };
    }
}
