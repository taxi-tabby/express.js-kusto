import { PrismaModelInfo } from '@lib/devtools/schema-api/crudSchemaTypes';
import { OpenApiSchema, OpenApiObjectSchema, OpenApiSchemaOrRef } from '@lib/devtools/documentation/openApiTypes';
import { fieldToSchema } from '@lib/devtools/documentation/dmmfToOpenApi';

/**
 * JSON:API attributes schema — id 와 관계 필드를 제외한 모든 필드.
 * Prisma 7 의 _runtimeDataModel 은 isId 메타데이터를 일관되게 노출하지 않을 수 있어
 * model.primaryKey.fields 도 함께 제외 기준으로 사용한다.
 */
export function jsonApiAttributes(model: PrismaModelInfo, enumValuesByName: Map<string, string[]>): OpenApiObjectSchema {
    const properties: Record<string, OpenApiSchemaOrRef> = {};
    const required: string[] = [];

    const pkFields = new Set(model.primaryKey?.fields ?? []);

    for (const field of model.fields) {
        if (field.isId) continue;
        if (pkFields.has(field.name)) continue;
        if (field.relationName) continue;
        properties[field.name] = fieldToSchema(field, enumValuesByName);
        if (!field.isOptional && !field.isGenerated) required.push(field.name);
    }

    const result: OpenApiObjectSchema = { type: 'object', properties };
    if (required.length > 0) result.required = required;
    return result;
}

/**
 * JSON:API relationships schema — 관계 필드만, 각 관계는 resource identifier 형식.
 * { data: { type: 'TargetModel', id: string } } (single)
 * 또는 { data: [{ type, id }, ...] } (list).
 */
export function jsonApiRelationships(model: PrismaModelInfo): OpenApiObjectSchema {
    const properties: Record<string, OpenApiSchemaOrRef> = {};

    for (const rel of model.relations) {
        const isList = rel.type === 'one-to-many' || rel.type === 'many-to-many';
        const identifier: OpenApiSchema = {
            type: 'object',
            required: ['type', 'id'],
            properties: {
                type: { type: 'string' },
                id: { type: 'string' },
            },
        };
        const dataSchema: OpenApiSchema = isList
            ? { type: 'array', items: identifier }
            : identifier;
        properties[rel.name] = {
            type: 'object',
            properties: { data: dataSchema },
        };
    }

    return { type: 'object', properties };
}

/**
 * JSON:API resource object schema — id/type/attributes/relationships 4 키.
 * type 은 const = 모델명 으로 고정 (3.1 / JSON Schema 2020-12).
 */
export function jsonApiResource(model: PrismaModelInfo, enumValuesByName: Map<string, string[]>): OpenApiObjectSchema {
    const attributes = jsonApiAttributes(model, enumValuesByName);
    const relationships = jsonApiRelationships(model);

    const properties: Record<string, OpenApiSchemaOrRef> = {
        id: { type: 'string' },
        type: { type: 'string', const: model.name },
        attributes,
    };
    if (Object.keys(relationships.properties).length > 0) {
        properties.relationships = relationships;
    }

    return {
        type: 'object',
        required: ['type', 'attributes'],
        properties,
    };
}

/**
 * JSON:API errors[] 응답 본문 schema — 모든 4xx/5xx 응답에 공통 사용.
 */
export function jsonApiErrorObject(): OpenApiObjectSchema {
    return {
        type: 'object',
        required: ['errors'],
        properties: {
            errors: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['status', 'code', 'title'],
                    properties: {
                        id: { type: 'string' },
                        status: { type: 'string' },
                        code: { type: 'string' },
                        title: { type: 'string' },
                        detail: { type: 'string' },
                        source: {
                            type: 'object',
                            properties: {
                                pointer: { type: 'string' },
                                parameter: { type: 'string' },
                                header: { type: 'string' },
                            },
                        },
                        meta: { type: 'object' },
                    },
                } as OpenApiSchema,
            },
        },
    };
}
