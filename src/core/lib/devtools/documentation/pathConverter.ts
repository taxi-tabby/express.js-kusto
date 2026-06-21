export interface PathConversionResult {
    path: string;
    parameters: Array<{
        name: string;
        pattern?: string;
        isWildcard?: boolean;
    }>;
}

/**
 * Express 라우터 경로 표기를 OpenAPI 3.1 경로 표기로 변환한다.
 * - `:foo` → `{foo}`
 * - 추출된 파라미터들의 메타데이터도 함께 반환.
 *
 * OpenAPI 경로 변환은 단순 `:name` 만 처리한다. regex param/wildcard 의
 * 식별자 추출은 태그·operationId 파생(normalizePathForDerivation 등)에서 다룬다.
 */
export function toOpenApiPath(expressPath: string): PathConversionResult {
    const parameters: PathConversionResult['parameters'] = [];

    const path = expressPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
        parameters.push({ name });
        return `{${name}}`;
    });

    return { path, parameters };
}

const titleCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * 파생 전에 경로를 정규화한다. Express 정규식 파라미터의 캡처그룹을 제거해
 * (`:id([^/]+)` → `:id`) split('/') 가 세그먼트를 잘못 쪼개는 것을 방지한다.
 */
function normalizePathForDerivation(path: string): string {
    return path.replace(/\([^)]*\)/g, '');
}

/** 경로 세그먼트가 파라미터/와일드카드인지(정적 리소스가 아닌지) 판별. */
function isDynamicSegment(seg: string): boolean {
    return (
        seg.startsWith(':') ||
        seg.startsWith('{') ||
        seg.startsWith('[') ||
        seg.startsWith('..') ||
        seg.includes('*')
    );
}

/** 동적 세그먼트에서 파라미터 식별자만 추출(정규식/괄호/별표/대괄호 장식 제거). */
function paramNameOf(seg: string): string {
    const m = seg.match(/[A-Za-z_][A-Za-z0-9_]*/);
    return m ? m[0] : '';
}

/**
 * 경로에서 Swagger 그룹화용 리소스 태그를 파생한다.
 * 파라미터/와일드카드를 제외한 "마지막 정적 세그먼트"를 Title Case 로.
 * 예) `/users` → `Users`, `/users/:id` → `Users`, `/users/:id/posts` → `Posts`,
 *     `/order-items` → `Order Items`, `/api/:v([^/]+)/things` → `Things`, `/` → `Default`.
 */
export function deriveResourceTag(path: string): string {
    const statics = normalizePathForDerivation(path)
        .split('/')
        .filter(Boolean)
        .filter((seg) => !isDynamicSegment(seg));
    const last = statics[statics.length - 1];
    if (!last) return 'Default';
    return last.split(/[-_]/).filter(Boolean).map(titleCase).join(' ');
}

/**
 * 경로+메서드에서 operationId 를 파생한다(클라이언트 코드젠/Swagger 안정 링크용).
 * 예) `GET /users` → `getUsers`, `GET /users/:id` → `getUsersById`,
 *     `POST /users/:id/posts` → `postUsersByIdPosts`, `GET /` → `getRoot`.
 * 정규식 파라미터의 캡처그룹은 무시한다(`/api/:v([^/]+)` → `getApiByV`).
 */
export function deriveOperationId(method: string, path: string): string {
    const parts = normalizePathForDerivation(path)
        .split('/')
        .filter(Boolean)
        .map((seg) => {
            if (isDynamicSegment(seg)) {
                const name = paramNameOf(seg);
                return name ? `By${titleCase(name)}` : '';
            }
            return seg.split(/[-_]/).filter(Boolean).map(titleCase).join('');
        });
    const tail = parts.join('');
    return `${method.toLowerCase()}${tail || 'Root'}`;
}
