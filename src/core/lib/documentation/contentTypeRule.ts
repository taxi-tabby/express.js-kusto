import { ContentTypeMode } from './openApiTypes';

/**
 * OpenAPI requestBody/response.content 의 media type 키를 결정한다.
 * - 'json'    → 'application/json'         (일반 라우트)
 * - 'jsonapi' → 'application/vnd.api+json' (CRUD 가 등록한 JSON:API 라우트)
 */
export function mediaTypeFor(mode: ContentTypeMode): string {
    return mode === 'jsonapi' ? 'application/vnd.api+json' : 'application/json';
}
