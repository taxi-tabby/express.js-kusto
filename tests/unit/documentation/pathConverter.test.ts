import { toOpenApiPath } from '@lib/devtools/documentation/pathConverter';

describe('pathConverter', () => {
    describe('toOpenApiPath', () => {
        it('파라미터가 없는 path 일 때 그대로 반환된다', () => {
            const result = toOpenApiPath('/users');
            expect(result).toEqual({ path: '/users', parameters: [] });
        });

        it(':id 형식의 단일 파라미터일 때 {id} 로 변환된다', () => {
            const result = toOpenApiPath('/users/:id');
            expect(result.path).toBe('/users/{id}');
            expect(result.parameters).toEqual([{ name: 'id' }]);
        });

        it('중첩된 :userId/:postId 일 때 둘 다 {} 로 변환된다', () => {
            const result = toOpenApiPath('/users/:userId/posts/:postId');
            expect(result.path).toBe('/users/{userId}/posts/{postId}');
            expect(result.parameters).toEqual([{ name: 'userId' }, { name: 'postId' }]);
        });

        it('루트 / 일 때 그대로 반환된다', () => {
            const result = toOpenApiPath('/');
            expect(result).toEqual({ path: '/', parameters: [] });
        });
    });
});
