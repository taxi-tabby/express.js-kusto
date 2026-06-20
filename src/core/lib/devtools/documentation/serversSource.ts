import { OpenApiServer } from '@lib/devtools/documentation/openApiTypes';
import { log } from '@ext/winston';

function fallback(env: NodeJS.ProcessEnv): OpenApiServer[] {
    const host = env.HOST || 'localhost';
    const port = env.PORT || '3000';
    return [{ url: `http://${host}:${port}`, description: 'Local' }];
}

/**
 * OpenAPI servers 배열을 빌드한다.
 * - OPENAPI_SERVERS (JSON 배열) 가 유효하면 그것을 사용.
 * - 없거나 무효하면 HOST/PORT 기반 단일 서버 fallback.
 */
export function buildServers(env: NodeJS.ProcessEnv): OpenApiServer[] {
    const raw = env.OPENAPI_SERVERS;
    if (!raw) return fallback(env);

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        log.Warn('OPENAPI_SERVERS invalid JSON, using fallback', { reason: String(error) });
        return fallback(env);
    }

    if (!Array.isArray(parsed)) {
        log.Warn('OPENAPI_SERVERS is not an array, using fallback');
        return fallback(env);
    }

    const valid: OpenApiServer[] = [];
    for (const item of parsed) {
        if (item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string') {
            const entry = item as OpenApiServer;
            valid.push({
                url: entry.url,
                ...(entry.description !== undefined ? { description: entry.description } : {}),
                ...(entry.variables !== undefined ? { variables: entry.variables } : {}),
            });
        } else {
            log.Warn('OPENAPI_SERVERS entry missing url, skipped', { entry: item });
        }
    }

    if (valid.length === 0) {
        log.Warn('OPENAPI_SERVERS contained no valid entries, using fallback');
        return fallback(env);
    }
    return valid;
}
