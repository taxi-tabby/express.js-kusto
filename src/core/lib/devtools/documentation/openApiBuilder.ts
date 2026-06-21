import { Schema } from '@lib/http/validation/validator';
import {
    OpenApiDocument,
    OpenApiOperation,
    OpenApiParameter,
    OpenApiRequestBody,
    OpenApiResponse,
    OpenApiSchema,
    OpenApiSchemaOrRef,
    ContentTypeMode,
} from '@lib/devtools/documentation/openApiTypes';
import { OpenApiTag } from '@lib/devtools/documentation/openApiTypes';
import { schemaToOpenApi, fieldToOpenApi } from '@lib/devtools/documentation/schemaConverter';
import { buildInfo } from '@lib/devtools/documentation/infoSource';
import { buildServers } from '@lib/devtools/documentation/serversSource';
import { toOpenApiPath, deriveResourceTag, deriveOperationId } from '@lib/devtools/documentation/pathConverter';
import { mediaTypeFor } from '@lib/devtools/documentation/contentTypeRule';
import { getStatusText } from '@lib/http/errors/errorCodes';
import { log } from '@ext/winston';

const OPENAPI_VERSION = '3.1.0';
const DEFAULT_CONTENT_TYPE_MODE: ContentTypeMode = 'json';

export interface RouteDocumentationLike {
    method: string;
    path: string;
    summary?: string;
    description?: string;
    operationId?: string;
    deprecated?: boolean;
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
    /** 태그명 → 설명. 문서 레벨 tags[] 의 description 으로 사용. */
    tagDescriptions?: Record<string, string>;
}

/** 라우트의 유효 태그를 결정한다: 명시 태그 우선, 없으면 경로에서 파생. */
function effectiveTags(route: RouteDocumentationLike): string[] {
    return route.tags && route.tags.length > 0 ? route.tags : [deriveResourceTag(route.path)];
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
                description: getStatusText(code) ?? `Response ${code}`,
                content: {
                    [mediaType]: { schema: resolved },
                },
            };
        }
    }
    if (Object.keys(out).length === 0) {
        // HTML page routes (e.g. extension-registered GET_REACT) return a document, not a JSON envelope.
        const defaultSchema: OpenApiSchema = mediaType === 'text/html'
            ? { type: 'string' }
            : {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    data: { type: 'object' },
                    timestamp: { type: 'string', format: 'date-time' },
                },
            };
        out['200'] = {
            description: mediaType === 'text/html' ? 'HTML page' : 'Success',
            content: { [mediaType]: { schema: defaultSchema } },
        };
    }
    return out;
}

function buildOperation(route: RouteDocumentationLike): OpenApiOperation {
    const mediaType = mediaTypeFor(route.contentType ?? DEFAULT_CONTENT_TYPE_MODE);
    const op: OpenApiOperation = {
        operationId: route.operationId ?? deriveOperationId(route.method, route.path),
        summary: route.summary ?? `${route.method.toUpperCase()} ${route.path}`,
        tags: effectiveTags(route),
        responses: buildResponses(route, mediaType),
    };
    if (route.description !== undefined) op.description = route.description;
    if (route.deprecated) op.deprecated = true;
    const parameters = buildParameters(route);
    if (parameters.length > 0) op.parameters = parameters;
    const requestBody = buildRequestBody(route, mediaType);
    if (requestBody !== undefined) op.requestBody = requestBody;
    return op;
}

/** 라우트들이 실제로 쓰는 태그를 모아 문서 레벨 tags[] 를 만든다(설명은 tagDescriptions 에서). */
function buildDocumentTags(
    routes: RouteDocumentationLike[],
    tagDescriptions: Record<string, string>,
): OpenApiTag[] {
    const names = new Set<string>();
    for (const route of routes) {
        for (const tag of effectiveTags(route)) names.add(tag);
    }
    return [...names].sort().map((name) => (
        tagDescriptions[name] ? { name, description: tagDescriptions[name] } : { name }
    ));
}

export function buildOpenApiDocument(input: BuildOpenApiInput): OpenApiDocument {
    const { routes, schemas, env, packageJson, tagDescriptions = {} } = input;

    const paths: Record<string, Record<string, OpenApiOperation>> = {};
    for (const route of routes) {
        // Resilient per route: a single malformed route doc (e.g. a response schema with a
        // typeless field) must not crash the whole spec — skip it with a warning and continue.
        try {
            // Build first (the throwable step) so a failure never leaves an empty path entry behind.
            const operation = buildOperation(route);
            const { path: openApiPath } = toOpenApiPath(route.path);
            if (!paths[openApiPath]) paths[openApiPath] = {};
            paths[openApiPath][route.method.toLowerCase()] = operation;
        } catch (error) {
            log.Warn(`Skipping route in OpenAPI spec — documentation conversion failed: ${route.method} ${route.path}`, { error });
        }
    }

    // operationId 는 문서 내에서 유일해야 한다(OpenAPI 요구). 중복 시 _2, _3 … 을 붙인다.
    const seenOperationIds = new Set<string>();
    for (const pathItem of Object.values(paths)) {
        for (const op of Object.values(pathItem)) {
            let id = op.operationId ?? '';
            if (seenOperationIds.has(id)) {
                let n = 2;
                while (seenOperationIds.has(`${id}_${n}`)) n++;
                id = `${id}_${n}`;
                op.operationId = id;
            }
            seenOperationIds.add(id);
        }
    }

    const documentTags = buildDocumentTags(routes, tagDescriptions);

    return {
        openapi: OPENAPI_VERSION,
        info: buildInfo(packageJson, env),
        servers: buildServers(env),
        ...(documentTags.length > 0 ? { tags: documentTags } : {}),
        paths: paths as OpenApiDocument['paths'],
        components: { schemas },
    };
}
