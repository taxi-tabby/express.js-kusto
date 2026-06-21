import { ContentTypeMode } from '@lib/devtools/documentation/openApiTypes';
import { JSON_API_CONTENT_TYPE } from '@lib/crud/jsonApiConstants';

/**
 * OpenAPI requestBody/response.content 의 media type 키를 결정한다.
 * - 'json'    → 'application/json'         (일반 라우트)
 * - 'jsonapi' → 'application/vnd.api+json' (CRUD 가 등록한 JSON:API 라우트)
 * - 'html'    → 'text/html'                (확장이 등록한 HTML 페이지 라우트 — API 가 아님)
 */
export function mediaTypeFor(mode: ContentTypeMode): string {
    if (mode === 'jsonapi') return JSON_API_CONTENT_TYPE;
    if (mode === 'html') return 'text/html';
    return 'application/json';
}
