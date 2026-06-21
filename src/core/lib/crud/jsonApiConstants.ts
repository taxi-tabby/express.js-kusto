/**
 * JSON:API v1.1 관련 상수 (단일 출처 / single source of truth).
 *
 * P2-17: 과거 'application/vnd.api+json' 문자열이 expressRouter / middleware.config /
 * documentation 곳곳에 하드코딩되어 있었다. 표기 변경 시 누락을 막기 위해 한 곳으로 모은다.
 */

/** JSON:API 표준 미디어 타입 */
export const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';

/** JSON:API 스펙 버전 (응답의 `jsonapi.version` 멤버에 사용) */
export const JSON_API_VERSION = '1.1';

/** JSON:API Atomic Operations 확장 식별 URI (응답의 `jsonapi.ext[]` 에 사용) */
export const JSON_API_ATOMIC_EXT = 'https://jsonapi.org/ext/atomic';

/** JSON:API Atomic Operations 확장 미디어 타입 (확장 URI 에서 파생) */
export const JSON_API_ATOMIC_CONTENT_TYPE = `application/vnd.api+json; ext="${JSON_API_ATOMIC_EXT}"`;
