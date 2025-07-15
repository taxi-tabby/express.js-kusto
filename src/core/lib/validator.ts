import { log } from '../external/winston';

export interface ValidationError {
    field: string;
    message: string;
    value?: any;
}

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    data?: any;
}

export type ValidatorType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'email' | 'url' | 'file' | 'binary' | 'buffer';

export interface FieldSchema {
    type: ValidatorType;
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: RegExp;
    enum?: any[];
    custom?: (value: any) => boolean | string;
    // File upload detection properties
    format?: string;              // Format specification (e.g., 'binary', 'base64')
    contentType?: string;         // Content-Type header for file uploads
    mediaType?: string;           // MIME type specification
    properties?: { [key: string]: FieldSchema }; // Nested properties for object types
    example?: any;                // Example value for documentation and validation
    // Security and sensitivity markers
    sensitive?: boolean;          // Marks field as containing sensitive data
    confidential?: boolean;       // Marks field as confidential
}

export interface Schema {
    [key: string]: FieldSchema;
}

export class Validator {    // Security patterns to detect malicious input
    private static securityPatterns = {
        sqlInjection: [
            // SQL injection with quotes and keywords
            /('[\s]*(or|and|union)[\s]+)/i,
            /(\bor\b|\band\b)[\s]+(1[\s]*=[\s]*1|true|false)[\s]*(--|\#|\/\*)/i,
            
            // Union-based SQL injection
            /(union[\s]+(all[\s]+)?select)/i,
            /((\%27)|(\'))[\s]*(union|select|insert|update|delete|drop|create|alter)/i,
            
            // SQL keywords with potential injection context
            /(;[\s]*(drop|delete|insert|update|create|alter|truncate)[\s]+(table|database|schema|index|view))/i,
            /(exec[\s]*\(|execute[\s]*\(|sp_executesql)/i,
            
            // Comment-based injection
            /(\/\*[\s\S]*\*\/|--[\s]*(drop|delete|insert|update|select))/i,
            
            // Encoded SQL injection attempts
            /(%27|%22).*(%20)*(union|select|insert|update|delete|drop)/i,
            
            // Boolean-based blind SQL injection
            /('[\s]*(and|or)[\s]+['"]*\w+['"]*[\s]*=[\s]*['"]*\w+['"]*[\s]*(--|\#))/i,
            
            // Time-based SQL injection
            /(waitfor[\s]+delay|pg_sleep|benchmark[\s]*\(|sleep[\s]*\()/i        ],
        xss: [
            // Script tags with potential XSS
            /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
            /<script[\s\S]*?>/gi,
            
            // Iframe with suspicious sources
            /<iframe[\s\S]*?(src[\s]*=[\s]*['"](javascript:|data:|vbscript:))/gi,
            
            // Object/embed with suspicious content
            /<(object|embed)[\s\S]*?(data[\s]*=[\s]*['"](javascript:|data:|vbscript:))/gi,
            
            // Link tags with javascript
            /<link[\s\S]*?(href[\s]*=[\s]*['"](javascript:|vbscript:))/gi,
            
            // Meta refresh with javascript
            /<meta[\s\S]*?(content[\s]*=[\s]*['"]\d+[\s]*;[\s]*url[\s]*=[\s]*(javascript:|vbscript:))/gi,
            
            // Event handlers with suspicious content
            /on(load|error|click|focus|blur|change|submit|mouseover|mouseout)[\s]*=[\s]*['"]*[\s]*(javascript:|vbscript:|alert[\s]*\(|confirm[\s]*\(|prompt[\s]*\()/gi,
            
            // Expression in style
            /style[\s]*=[\s]*['"]*[^'"]*expression[\s]*\(/gi,
            
            // Direct javascript/vbscript protocols
            /^[\s]*(javascript|vbscript)[\s]*:/i
        ],
        commandInjection: [
            // Command chaining with suspicious patterns
            /(;[\s]*(rm|del|delete|format|fdisk|dd)[\s]+)/i,
            /(\|[\s]*(rm|del|delete|format|fdisk|dd)[\s]+)/i,
            /(&&[\s]*(rm|del|delete|format|fdisk|dd)[\s]+)/i,
            
            // Command substitution
            /(\$\([^)]*\)|`[^`]*`)/,
            
            // File operations with suspicious paths
            /(cat|type|more|less)[\s]+\/?(etc\/passwd|windows\/system32|boot\.ini)/i,
            
            // Network operations
            /(wget|curl|nc|netcat|telnet)[\s]+\w+/i,
            
            // System information gathering (only in suspicious contexts)
            /(;|&&|\|)[\s]*(whoami|id|uname|ps|netstat|ifconfig)[\s]*($|;|&&|\|)/i
        ]
    };

    // Check if value contains malicious patterns
    private static detectSecurityThreats(value: any, fieldName: string): ValidationError[] {
        const errors: ValidationError[] = [];
        
        if (typeof value !== 'string') return errors;
        
        // Check for SQL injection
        for (const pattern of this.securityPatterns.sqlInjection) {
            if (pattern.test(value)) {
                errors.push({
                    field: fieldName,
                    message: `${fieldName} contains potentially malicious SQL injection patterns`,
                    value
                });
                break;
            }
        }
        
        // Check for XSS
        for (const pattern of this.securityPatterns.xss) {
            if (pattern.test(value)) {
                errors.push({
                    field: fieldName,
                    message: `${fieldName} contains potentially malicious XSS patterns`,
                    value
                });
                break;
            }
        }
        
        // Check for command injection
        for (const pattern of this.securityPatterns.commandInjection) {
            if (pattern.test(value)) {
                errors.push({
                    field: fieldName,
                    message: `${fieldName} contains potentially malicious command injection patterns`,
                    value
                });
                break;
            }
        }
        
        return errors;
    }

    private static validateField(value: any, fieldName: string, schema: FieldSchema): ValidationError[] {
        const errors: ValidationError[] = [];

        // Required 체크
        if (schema.required && (value === undefined || value === null || value === '')) {
            errors.push({
                field: fieldName,
                message: `${fieldName} is required`,
                value
            });
            return errors;
        }

        // 값이 없고 required가 아니면 검증 통과
        if (value === undefined || value === null || value === '') {
            return errors;
        }

        // 타입 검증
        switch (schema.type) {
            case 'string':
                if (typeof value !== 'string') {
                    errors.push({
                        field: fieldName,
                        message: `${fieldName} must be a string`,
                        value
                    });
                }
                break;

            case 'number':
                const numValue = typeof value === 'string' ? parseFloat(value) : value;
                if (isNaN(numValue) || typeof numValue !== 'number') {
                    errors.push({
                        field: fieldName,
                        message: `${fieldName} must be a number`,
                        value
                    });
                } else {
                    value = numValue; // 변환된 값으로 업데이트
                }
                break;

            case 'boolean':
                if (typeof value === 'string') {
                    if (value.toLowerCase() === 'true') value = true;
                    else if (value.toLowerCase() === 'false') value = false;
                    else {
                        errors.push({
                            field: fieldName,
                            message: `${fieldName} must be a boolean`,
                            value
                        });
                    }
                } else if (typeof value !== 'boolean') {
                    errors.push({
                        field: fieldName,
                        message: `${fieldName} must be a boolean`,
                        value
                    });
                }
                break;

            case 'array':
                if (!Array.isArray(value)) {
                    errors.push({
                        field: fieldName,
                        message: `${fieldName} must be an array`,
                        value
                    });
                }
                break;

            case 'object':
                if (typeof value !== 'object' || Array.isArray(value)) {
                    errors.push({
                        field: fieldName,
                        message: `${fieldName} must be an object`,
                        value
                    });
                }
                break;

            case 'email':
                if (typeof value !== 'string' || !this.isValidEmail(value)) {
                    errors.push({
                        field: fieldName,
                        message: `${fieldName} must be a valid email`,
                        value
                    });
                }
                break;            case 'url':
                if (typeof value !== 'string' || !this.isValidUrl(value)) {
                    errors.push({
                        field: fieldName,
                        message: `${fieldName} must be a valid URL`,
                        value
                    });
                }
                break;

            case 'file':
            case 'binary':
            case 'buffer':
                // File types are typically handled at the middleware level (e.g., multer)
                // Here we just ensure the value exists and is either a string (file path) 
                // or Buffer/File object
                if (value !== undefined && value !== null) {
                    const isValidFileType = typeof value === 'string' || 
                                          Buffer.isBuffer(value) ||
                                          (typeof value === 'object' && value.constructor && 
                                           (value.constructor.name === 'File' || value.constructor.name === 'Blob'));
                    
                    if (!isValidFileType) {
                        errors.push({
                            field: fieldName,
                            message: `${fieldName} must be a valid file, buffer, or file path`,
                            value
                        });
                    }
                }
                break;
        }

        // 길이 검증 (string, array)
        if ((typeof value === 'string' || Array.isArray(value)) && errors.length === 0) {
            if (schema.min !== undefined && value.length < schema.min) {
                errors.push({
                    field: fieldName,
                    message: `${fieldName} must be at least ${schema.min} characters/items`,
                    value
                });
            }
            if (schema.max !== undefined && value.length > schema.max) {
                errors.push({
                    field: fieldName,
                    message: `${fieldName} must be at most ${schema.max} characters/items`,
                    value
                });
            }
        }

        // 숫자 범위 검증
        if (typeof value === 'number' && errors.length === 0) {
            if (schema.min !== undefined && value < schema.min) {
                errors.push({
                    field: fieldName,
                    message: `${fieldName} must be at least ${schema.min}`,
                    value
                });
            }
            if (schema.max !== undefined && value > schema.max) {
                errors.push({
                    field: fieldName,
                    message: `${fieldName} must be at most ${schema.max}`,
                    value
                });
            }
        }

        // 패턴 검증
        if (schema.pattern && typeof value === 'string' && errors.length === 0) {
            if (!schema.pattern.test(value)) {
                errors.push({
                    field: fieldName,
                    message: `${fieldName} does not match required pattern`,
                    value
                });
            }
        }

        // Enum 검증
        if (schema.enum && errors.length === 0) {
            if (!schema.enum.includes(value)) {
                errors.push({
                    field: fieldName,
                    message: `${fieldName} must be one of: ${schema.enum.join(', ')}`,
                    value
                });
            }
        }

        // 커스텀 검증
        if (schema.custom && errors.length === 0) {
            const customResult = schema.custom(value);
            if (typeof customResult === 'string') {
                errors.push({
                    field: fieldName,
                    message: customResult,
                    value
                });
            } else if (customResult === false) {
                errors.push({
                    field: fieldName,
                    message: `${fieldName} failed custom validation`,
                    value
                });
            }
        }

        // 보안 검증
        const securityErrors = this.detectSecurityThreats(value, fieldName);
        errors.push(...securityErrors);

        return errors;
    }

    private static isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    private static isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    static validate(data: any, schema: Schema): ValidationResult {
        const errors: ValidationError[] = [];
        const validatedData: any = {};

        // 스키마에 정의된 필드들 검증
        for (const [fieldName, fieldSchema] of Object.entries(schema)) {
            const fieldErrors = this.validateField(data[fieldName], fieldName, fieldSchema);
            errors.push(...fieldErrors);

            // 에러가 없으면 검증된 데이터에 추가
            if (fieldErrors.length === 0) {
                if (data[fieldName] !== undefined) {
                    validatedData[fieldName] = data[fieldName];
                }
            }
        }        
        
        // 스키마에 없는 추가 필드들 체크 (필터링)
        const allowedFields = Object.keys(schema);
        const extraFields = Object.keys(data || {}).filter(key => !allowedFields.includes(key));
        
        if (extraFields.length > 0) {
            // 개발 환경에서만 로그 출력
            if (process.env.NODE_ENV !== 'production') {
                log.Debug(`Extra fields ignored: ${extraFields.join(', ')}`);
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            data: errors.length === 0 ? validatedData : undefined
        };
    }

    static validateBody(data: any, schema: Schema): ValidationResult {
        return this.validate(data, schema);
    }

    static validateQuery(data: any, schema: Schema): ValidationResult {
        return this.validate(data, schema);
    }

    static validateParams(data: any, schema: Schema): ValidationResult {
        return this.validate(data, schema);
    }
}
