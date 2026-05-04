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
 * 본 phase (M1) 에서는 단순 :name 만 처리. regex param (:^name) 과
 * wildcard (..[^name]) 는 후속 phase 에서 확장.
 */
export function toOpenApiPath(expressPath: string): PathConversionResult {
    const parameters: PathConversionResult['parameters'] = [];

    const path = expressPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
        parameters.push({ name });
        return `{${name}}`;
    });

    return { path, parameters };
}
