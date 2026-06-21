/**
 * package.json name/version/description 접근 단일 출처 (SSOT).
 *
 * 과거 crudHelpers / errorHandler / documentationGenerator 가 각자
 * require('.../package.json') 를 호출하고 서로 다른 fallback(kusto-server vs kusto-api)을
 * 들고 있었다. 로드 실패 시 JSON:API meta.implementation 과 OpenAPI info.title 이 앱 이름을
 * 두고 불일치할 수 있어 한 곳으로 모은다. (webpack 번들 시 inline, dev 는 ts-node require 해석)
 */

export interface PackageInfo {
    name: string;
    version: string;
    description?: string;
}

const FALLBACK: PackageInfo = { name: 'kusto-server', version: '0.0.0' };

/** package.json 의 name/version/description 을 반환(로드 실패 시 단일 fallback, 무로그). */
export function getPackageInfo(): PackageInfo {
    try {
         
        const pkg = require('../../../../package.json') as Partial<PackageInfo>;
        return {
            name: pkg.name ?? FALLBACK.name,
            version: pkg.version ?? FALLBACK.version,
            description: pkg.description,
        };
    } catch {
        return { ...FALLBACK };
    }
}

/** JSON:API meta.implementation 문자열 ("name v version"). */
export function getImplementationString(): string {
    const { name, version } = getPackageInfo();
    return `${name} v${version}`;
}
