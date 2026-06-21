import { PrismaFieldMetadata } from '@lib/devtools/schema-api/crudSchemaTypes';
import { OpenApiSchema, OpenApiSchemaOrRef } from '@lib/devtools/documentation/openApiTypes';
import { log } from '@ext/winston';

/**
 * Prisma 스칼라 타입 → OpenAPI primitive type / format.
 */
function prismaTypeToOpenApi(prismaType: string): {
    type: 'string' | 'number' | 'integer' | 'boolean' | 'object';
    format?: string;
} {
    switch (prismaType) {
        case 'String':
            return { type: 'string' };
        case 'Int':
            return { type: 'integer', format: 'int32' };
        case 'BigInt':
            return { type: 'integer', format: 'int64' };
        case 'Float':
            return { type: 'number', format: 'float' };
        case 'Decimal':
            return { type: 'string', format: 'decimal' };
        case 'Boolean':
            return { type: 'boolean' };
        case 'DateTime':
            return { type: 'string', format: 'date-time' };
        case 'Json':
            return { type: 'object' };
        case 'Bytes':
            return { type: 'string', format: 'byte' };
        default:
            // enum 또는 알 수 없는 타입 — 호출자가 enum 별도 등록을 가정
            return { type: 'string' };
    }
}

/**
 * 단일 필드 → OpenAPI schema. 관계 필드는 호출자가 미리 걸러야 함.
 * isOptional 시 type union (T | null) 으로 표현 (OpenAPI 3.1 / JSON Schema 2020-12).
 * isList 시 array wrapper.
 */
export function fieldToSchema(
    field: PrismaFieldMetadata,
    enumValuesByName: Map<string, string[]>,
): OpenApiSchemaOrRef {
    if (enumValuesByName.has(field.type)) {
        return { $ref: `#/components/schemas/${field.type}` };
    }

    const { type: baseType, format } = prismaTypeToOpenApi(field.type);
    let schema: OpenApiSchema = { type: baseType };
    if (format) schema.format = format;

    if (field.isList) {
        schema = { type: 'array', items: schema };
    }

    if (field.isOptional) {
        // type union 으로 nullable 표현
        const currentType = schema.type;
        if (Array.isArray(currentType)) {
            schema = { ...schema, type: [...currentType, 'null'] };
        } else if (typeof currentType === 'string') {
            schema = { ...schema, type: [currentType, 'null'] };
        }
    }

    if (field.documentation) schema.description = field.documentation;

    return schema;
}

/**
 * Enum 값 배열 → OpenAPI string enum schema.
 */
export function enumToOpenApi(name: string, values: string[]): OpenApiSchema {
    if (values.length === 0) {
        log.warn('Enum has no values', { enumName: name });
        return { type: 'string' };
    }
    return { type: 'string', enum: values };
}
