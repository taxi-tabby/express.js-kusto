import { OpenApiObjectSchema } from '@lib/documentation/openApiTypes';

/**
 * CRUD 라우트가 등록할 JSON:API request body schema 를 생성.
 * - 'create': data.type/attributes 만 required, id 옵셔널 (server-side 생성).
 * - 'update': data.type/id/attributes 모두 required.
 * attributes 는 {Model}Attributes 로 $ref (M3 의 syncSchemas 가 미리 등록).
 */
export function jsonApiBody(modelName: string, op: 'create' | 'update'): OpenApiObjectSchema {
    const dataRequired = op === 'update' ? ['type', 'id', 'attributes'] : ['type', 'attributes'];

    return {
        type: 'object',
        required: ['data'],
        properties: {
            data: {
                type: 'object',
                required: dataRequired,
                properties: {
                    type: { type: 'string' },
                    id: { type: 'string' },
                    attributes: { $ref: `#/components/schemas/${modelName}Attributes` },
                    relationships: { $ref: `#/components/schemas/${modelName}Relationships` },
                },
            },
        },
    };
}

/**
 * 단일 resource 응답: data 가 {Model} resource object.
 */
export function jsonApiResponse(modelName: string, _statusCode: number): OpenApiObjectSchema {
    return {
        type: 'object',
        required: ['data'],
        properties: {
            data: { $ref: `#/components/schemas/${modelName}` },
        },
    };
}

/**
 * 4xx/5xx 응답: errors 가 JsonApiError 의 errors[] 배열.
 */
export function jsonApiErrorResponse(_statusCode: number): OpenApiObjectSchema {
    return {
        type: 'object',
        required: ['errors'],
        properties: {
            errors: { $ref: '#/components/schemas/JsonApiError' },
        },
    };
}

/**
 * JSON:API 컬렉션 응답: data 가 {Model} 의 배열, meta 옵셔널.
 * GET / (index) 라우트가 사용.
 */
export function jsonApiCollectionResponse(modelName: string): OpenApiObjectSchema {
    return {
        type: 'object',
        required: ['data'],
        properties: {
            data: {
                type: 'array',
                items: { $ref: `#/components/schemas/${modelName}` },
            },
            meta: {
                type: 'object',
            },
        },
    };
}
