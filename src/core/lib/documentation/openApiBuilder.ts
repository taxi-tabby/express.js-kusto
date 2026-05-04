import { Schema } from '@lib/validator';
import {
    OpenApiDocument,
    OpenApiOperation,
    OpenApiParameter,
    OpenApiRequestBody,
    OpenApiResponse,
    OpenApiSchema,
    OpenApiSchemaOrRef,
    ContentTypeMode,
} from './openApiTypes';
import { schemaToOpenApi, fieldToOpenApi } from './schemaConverter';
import { buildInfo } from './infoSource';
import { buildServers } from './serversSource';
import { toOpenApiPath } from './pathConverter';
import { mediaTypeFor } from './contentTypeRule';

const OPENAPI_VERSION = '3.1.0';
const DEFAULT_CONTENT_TYPE_MODE: ContentTypeMode = 'json';

export interface RouteDocumentationLike {
    method: string;
    path: string;
    summary?: string;
    description?: string;
    parameters?: {
        query?: Schema;
        params?: Schema;
        body?: Schema | OpenApiSchemaOrRef;
    };
    responses?: Record<string | number, Schema | OpenApiSchemaOrRef>;
    tags?: string[];
    contentType?: ContentTypeMode;
}

export interface BuildOpenApiInput {
    routes: RouteDocumentationLike[];
    schemas: Record<string, OpenApiSchemaOrRef>;
    env: NodeJS.ProcessEnv;
    packageJson: { name?: string; version?: string; description?: string };
}

/**
 * 입력이 이미 OpenAPI schema 형태인지 감지.
 * - $ref 가 있으면 ref 객체.
 * - 또는 type 이 OpenAPI primitive 문자열이면 schema.
 * - 또는 oneOf/allOf/anyOf 배열이 있으면 schema.
 * 반대로 validator Schema 는 top-level 키가 필드명이고 type 키 자체가 보통 없거나 객체.
 */
function isOpenApiSchemaShape(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    if (typeof v.$ref === 'string') return true;
    if (typeof v.type === 'string') {
        const t = v.type;
        if (t === 'object' || t === 'array' || t === 'string' || t === 'number' ||
            t === 'integer' || t === 'boolean' || t === 'null') {
            return true;
        }
    }
    if (Array.isArray(v.oneOf) || Array.isArray(v.allOf) || Array.isArray(v.anyOf)) return true;
    return false;
}

function buildParameters(route: RouteDocumentationLike): OpenApiParameter[] {
    const out: OpenApiParameter[] = [];
    if (route.parameters?.query) {
        for (const [name, field] of Object.entries(route.parameters.query)) {
            out.push({
                name,
                in: 'query',
                required: field.required ?? false,
                schema: fieldToOpenApi(field),
                ...(field.example !== undefined ? { example: field.example } : {}),
            });
        }
    }
    if (route.parameters?.params) {
        for (const [name, field] of Object.entries(route.parameters.params)) {
            out.push({
                name,
                in: 'path',
                required: true,
                schema: fieldToOpenApi(field),
            });
        }
    }
    return out;
}

function buildRequestBody(route: RouteDocumentationLike, mediaType: string): OpenApiRequestBody | undefined {
    if (!route.parameters?.body) return undefined;
    const body = route.parameters.body;
    const schema: OpenApiSchemaOrRef = isOpenApiSchemaShape(body)
        ? (body as OpenApiSchemaOrRef)
        : schemaToOpenApi(body as Schema);
    return {
        required: true,
        content: {
            [mediaType]: { schema },
        },
    };
}

function buildResponses(route: RouteDocumentationLike, mediaType: string): Record<string, OpenApiResponse> {
    const out: Record<string, OpenApiResponse> = {};
    if (route.responses) {
        for (const [code, schema] of Object.entries(route.responses)) {
            const resolved: OpenApiSchemaOrRef = isOpenApiSchemaShape(schema)
                ? (schema as OpenApiSchemaOrRef)
                : schemaToOpenApi(schema as Schema);
            out[code] = {
                description: `Response ${code}`,
                content: {
                    [mediaType]: { schema: resolved },
                },
            };
        }
    }
    if (Object.keys(out).length === 0) {
        out['200'] = {
            description: 'Success',
            content: {
                [mediaType]: {
                    schema: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean' },
                            data: { type: 'object' },
                            timestamp: { type: 'string', format: 'date-time' },
                        },
                    } as OpenApiSchema,
                },
            },
        };
    }
    return out;
}

function buildOperation(route: RouteDocumentationLike): OpenApiOperation {
    const mediaType = mediaTypeFor(route.contentType ?? DEFAULT_CONTENT_TYPE_MODE);
    const op: OpenApiOperation = {
        summary: route.summary ?? `${route.method.toUpperCase()} ${route.path}`,
        tags: route.tags ?? ['API'],
        responses: buildResponses(route, mediaType),
    };
    if (route.description !== undefined) op.description = route.description;
    const parameters = buildParameters(route);
    if (parameters.length > 0) op.parameters = parameters;
    const requestBody = buildRequestBody(route, mediaType);
    if (requestBody !== undefined) op.requestBody = requestBody;
    return op;
}

export function buildOpenApiDocument(input: BuildOpenApiInput): OpenApiDocument {
    const { routes, schemas, env, packageJson } = input;

    const paths: Record<string, Record<string, OpenApiOperation>> = {};
    for (const route of routes) {
        const { path: openApiPath } = toOpenApiPath(route.path);
        if (!paths[openApiPath]) paths[openApiPath] = {};
        paths[openApiPath][route.method.toLowerCase()] = buildOperation(route);
    }

    return {
        openapi: OPENAPI_VERSION,
        info: buildInfo(packageJson, env),
        servers: buildServers(env),
        paths: paths as OpenApiDocument['paths'],
        components: { schemas },
    };
}
