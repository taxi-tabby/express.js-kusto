/**
 * OpenAPI 3.1.0 — JSON Schema 2020-12 정렬.
 * 본 프레임워크가 생성·소비하는 형태에 맞춘 부분 타입.
 * 전체 spec: https://spec.openapis.org/oas/v3.1.0
 */

export type OpenApiPrimitiveType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

export interface OpenApiSchema {
    type?: OpenApiPrimitiveType | OpenApiPrimitiveType[];
    format?: string;
    description?: string;
    enum?: unknown[];
    example?: unknown;
    examples?: unknown[];
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    properties?: Record<string, OpenApiSchema | OpenApiRef>;
    required?: string[];
    items?: OpenApiSchema | OpenApiRef;
    additionalProperties?: boolean | OpenApiSchema | OpenApiRef;
    nullable?: boolean;
    $ref?: string;
    oneOf?: Array<OpenApiSchema | OpenApiRef>;
    allOf?: Array<OpenApiSchema | OpenApiRef>;
    anyOf?: Array<OpenApiSchema | OpenApiRef>;
}

export interface OpenApiRef {
    $ref: string;
}

export type OpenApiSchemaOrRef = OpenApiSchema | OpenApiRef;

export interface OpenApiObjectSchema extends OpenApiSchema {
    type: 'object';
    properties: Record<string, OpenApiSchemaOrRef>;
}

export interface OpenApiInfo {
    title: string;
    version: string;
    description?: string;
    termsOfService?: string;
    contact?: { name?: string; url?: string; email?: string };
    license?: { name: string; url?: string };
}

export interface OpenApiServer {
    url: string;
    description?: string;
    variables?: Record<string, { default: string; enum?: string[]; description?: string }>;
}

export interface OpenApiParameter {
    name: string;
    in: 'query' | 'path' | 'header' | 'cookie';
    description?: string;
    required?: boolean;
    schema?: OpenApiSchemaOrRef;
    example?: unknown;
}

export interface OpenApiMediaTypeObject {
    schema?: OpenApiSchemaOrRef;
    example?: unknown;
    examples?: Record<string, { value: unknown; summary?: string }>;
}

export interface OpenApiRequestBody {
    description?: string;
    required?: boolean;
    content: Record<string, OpenApiMediaTypeObject>;
}

export interface OpenApiResponse {
    description: string;
    content?: Record<string, OpenApiMediaTypeObject>;
    headers?: Record<string, OpenApiSchemaOrRef>;
}

export interface OpenApiOperation {
    summary?: string;
    description?: string;
    operationId?: string;
    tags?: string[];
    parameters?: OpenApiParameter[];
    requestBody?: OpenApiRequestBody;
    responses: Record<string, OpenApiResponse>;
    deprecated?: boolean;
}

export type OpenApiPathItem = Partial<Record<'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head', OpenApiOperation>> & {
    parameters?: OpenApiParameter[];
};

export interface OpenApiComponents {
    schemas?: Record<string, OpenApiSchemaOrRef>;
    parameters?: Record<string, OpenApiParameter>;
    responses?: Record<string, OpenApiResponse>;
    requestBodies?: Record<string, OpenApiRequestBody>;
}

export interface OpenApiExternalDocs {
    url: string;
    description?: string;
}

/** 문서 레벨 태그 정의(Swagger 그룹 헤더 + 설명). */
export interface OpenApiTag {
    name: string;
    description?: string;
    externalDocs?: OpenApiExternalDocs;
}

export interface OpenApiDocument {
    openapi: string;
    info: OpenApiInfo;
    servers?: OpenApiServer[];
    tags?: OpenApiTag[];
    paths: Record<string, OpenApiPathItem>;
    components?: OpenApiComponents;
}

/** 등록되는 path/method/스키마의 contentType 결정에 사용 */
export type ContentTypeMode = 'json' | 'jsonapi';
