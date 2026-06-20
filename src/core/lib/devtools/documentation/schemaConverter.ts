import { FieldSchema, Schema, ValidatorType } from '@lib/http/validation/validator';
import { OpenApiSchema, OpenApiObjectSchema } from '@lib/devtools/documentation/openApiTypes';

const KNOWN_TYPES: ReadonlySet<ValidatorType> = new Set([
    'string', 'number', 'boolean', 'array', 'object',
    'email', 'url', 'file', 'binary', 'buffer',
]);

/**
 * validator.ts 의 FieldSchema 한 개를 OpenAPI 3.1 schema 로 변환한다.
 * 알 수 없는 type 은 fail-fast (throw).
 */
export function fieldToOpenApi(field: FieldSchema): OpenApiSchema {
    if (!KNOWN_TYPES.has(field.type)) {
        throw new Error(`Unknown FieldSchema type: ${String(field.type)}`);
    }

    const result: OpenApiSchema = {};

    switch (field.type) {
        case 'string':
            result.type = 'string';
            break;
        case 'email':
            result.type = 'string';
            result.format = 'email';
            break;
        case 'url':
            result.type = 'string';
            result.format = 'uri';
            break;
        case 'file':
        case 'binary':
        case 'buffer':
            result.type = 'string';
            result.format = 'binary';
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

    // min/max — type 별로 다른 키
    if (field.min !== undefined) {
        if (result.type === 'string') result.minLength = field.min;
        else if (result.type === 'array') result.minItems = field.min;
        else if (result.type === 'number') result.minimum = field.min;
    }
    if (field.max !== undefined) {
        if (result.type === 'string') result.maxLength = field.max;
        else if (result.type === 'array') result.maxItems = field.max;
        else if (result.type === 'number') result.maximum = field.max;
    }

    if (field.enum !== undefined) result.enum = field.enum;
    if (field.pattern !== undefined) result.pattern = field.pattern.source;
    if (field.example !== undefined) result.example = field.example;

    return result;
}

/**
 * validator.ts 의 Schema (필드명 → FieldSchema 매핑) 를 OpenAPI 3.1 object schema 로 변환한다.
 */
export function schemaToOpenApi(schema: Schema): OpenApiObjectSchema {
    const properties: Record<string, OpenApiSchema> = {};
    const required: string[] = [];

    for (const [name, field] of Object.entries(schema)) {
        properties[name] = fieldToOpenApi(field);
        if (field.required) required.push(name);
    }

    const result: OpenApiObjectSchema = { type: 'object', properties };
    if (required.length > 0) result.required = required;
    return result;
}
