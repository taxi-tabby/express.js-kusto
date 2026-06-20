import { mediaTypeFor } from '@lib/devtools/documentation/contentTypeRule';

describe('contentTypeRule', () => {
    describe('mediaTypeFor', () => {
        it("'json' 일 때 application/json 을 반환한다", () => {
            expect(mediaTypeFor('json')).toBe('application/json');
        });

        it("'jsonapi' 일 때 application/vnd.api+json 을 반환한다", () => {
            expect(mediaTypeFor('jsonapi')).toBe('application/vnd.api+json');
        });
    });
});
