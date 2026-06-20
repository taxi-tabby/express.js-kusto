import { OpenApiInfo } from '@lib/devtools/documentation/openApiTypes';

const FALLBACK_TITLE = 'kusto-api';
const FALLBACK_VERSION = '0.0.0';

interface PackageJsonLike {
    name?: string;
    version?: string;
    description?: string;
}

function pickNonEmpty(...candidates: Array<string | undefined>): string | undefined {
    for (const c of candidates) {
        if (typeof c === 'string' && c.length > 0) return c;
    }
    return undefined;
}

/**
 * OpenAPI info 객체를 빌드한다.
 * 우선순위: env (OPENAPI_TITLE/VERSION/DESC) > package.json > 하드코딩 fallback.
 */
export function buildInfo(packageJson: PackageJsonLike, env: NodeJS.ProcessEnv): OpenApiInfo {
    const title = pickNonEmpty(env.OPENAPI_TITLE, packageJson.name) ?? FALLBACK_TITLE;
    const version = pickNonEmpty(env.OPENAPI_VERSION, packageJson.version) ?? FALLBACK_VERSION;
    const description = pickNonEmpty(env.OPENAPI_DESC, packageJson.description);

    const info: OpenApiInfo = { title, version };
    if (description !== undefined) info.description = description;
    return info;
}
