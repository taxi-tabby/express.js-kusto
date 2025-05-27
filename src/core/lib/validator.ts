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

export type ValidatorType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'email' | 'url';

export interface FieldSchema {
    type: ValidatorType;
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: RegExp;
    enum?: any[];
    custom?: (value: any) => boolean | string;
}

export interface Schema {
    [key: string]: FieldSchema;
}

export class Validator {
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
                break;

            case 'url':
                if (typeof value !== 'string' || !this.isValidUrl(value)) {
                    errors.push({
                        field: fieldName,
                        message: `${fieldName} must be a valid URL`,
                        value
                    });
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
            console.warn(`Extra fields ignored: ${extraFields.join(', ')}`);
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
