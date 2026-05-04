import { Schema, FieldSchema } from '@lib/validator';
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

/**
 * 본 phase (M1) 에서는 path/content-type/openapi 버전 변경 없음 — 기존 동작 보존.
 * M2 에서 toOpenApiPath, mediaTypeFor, '3.1.0' 활성화.
 */
const OPENAPI_VERSION = '3.0.0';
const DEFAULT_CONTENT_TYPE = 'application/json';

export interface RouteDocumentationLike {
    method: string;
    path: string;
    summary?: string;
    description?: string;
    parameters?: {
        query?: Schema;
        params?: Schema;
        body?: Schema;
    };
    responses?: Record<string | number, Schema>;
    tags?: string[];
    contentType?: ContentTypeMode;
}

export interface BuildOpenApiInput {
    routes: RouteDocumentationLike[];
    schemas: Record<string, OpenApiSchemaOrRef>;
    env: NodeJS.ProcessEnv;
    packageJson: { name?: string; version?: string; description?: string };
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

function buildRequestBody(route: RouteDocumentationLike): OpenApiRequestBody | undefined {
    if (!route.parameters?.body) return undefined;
    return {
        required: true,
        content: {
            [DEFAULT_CONTENT_TYPE]: {
                schema: schemaToOpenApi(route.parameters.body),
            },
        },
    };
}

function buildResponses(route: RouteDocumentationLike): Record<string, OpenApiResponse> {
    const out: Record<string, OpenApiResponse> = {};
    if (route.responses) {
        for (const [code, schema] of Object.entries(route.responses)) {
            out[code] = {
                description: `Response ${code}`,
                content: {
                    [DEFAULT_CONTENT_TYPE]: {
                        schema: schemaToOpenApi(schema),
                    },
                },
            };
        }
    }
    if (Object.keys(out).length === 0) {
        // 기존 generateOpenAPISpec 의 fallback 보존
        out['200'] = {
            description: 'Success',
            content: {
                [DEFAULT_CONTENT_TYPE]: {
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
    const op: OpenApiOperation = {
        summary: route.summary ?? `${route.method.toUpperCase()} ${route.path}`,
        tags: route.tags ?? ['API'],
        responses: buildResponses(route),
    };
    if (route.description !== undefined) op.description = route.description;
    const parameters = buildParameters(route);
    if (parameters.length > 0) op.parameters = parameters;
    const requestBody = buildRequestBody(route);
    if (requestBody !== undefined) op.requestBody = requestBody;
    return op;
}

/**
 * routes/schemas/env/packageJson 을 입력받아 최종 OpenAPI document 빌드.
 * 본 phase 에서는 기존 generateOpenAPISpec 동작과 byte-for-byte 동등.
 */
export function buildOpenApiDocument(input: BuildOpenApiInput): OpenApiDocument {
    const { routes, schemas, env, packageJson } = input;

    const paths: Record<string, Record<string, OpenApiOperation>> = {};
    for (const route of routes) {
        if (!paths[route.path]) paths[route.path] = {};
        paths[route.path][route.method.toLowerCase()] = buildOperation(route);
    }

    return {
        openapi: OPENAPI_VERSION,
        info: buildInfo(packageJson, env),
        servers: buildServers(env),
        paths: paths as OpenApiDocument['paths'],
        components: { schemas },
    };
}
