/**
 * JSON:API v1.1 관련 상수 (단일 출처 / single source of truth).
 *
 * P2-17: 과거 'application/vnd.api+json' 문자열이 expressRouter / middleware.config /
 * documentation 곳곳에 하드코딩되어 있었다. 표기 변경 시 누락을 막기 위해 한 곳으로 모은다.
 */

/** JSON:API 표준 미디어 타입 */
export const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';

/** JSON:API Atomic Operations 확장 미디어 타입 */
export const JSON_API_ATOMIC_CONTENT_TYPE =
    'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"';
