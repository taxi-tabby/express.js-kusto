import { convertFolderToUrlSegment } from '@lib/http/routing/loadRoutes_V6_Clean';

describe('convertFolderToUrlSegment', () => {
    it('일반 폴더명일 때 그대로 반환한다', () => {
        expect(convertFolderToUrlSegment('users')).toBe('users');
    });

    it('[paramName] 패턴일 때 :paramName 으로 변환된다', () => {
        expect(convertFolderToUrlSegment('[userId]')).toBe(':userId');
    });

    it('[^paramName] 패턴일 때 정규식 제약이 있는 :paramName([^/]+) 으로 변환된다', () => {
        expect(convertFolderToUrlSegment('[^slug]')).toBe(':slug([^/]+)');
    });

    it('..[^paramName] 패턴일 때 wildcard :paramName* 으로 변환된다', () => {
        expect(convertFolderToUrlSegment('..[^path]')).toBe(':path*');
    });

    it('빈 문자열이 들어올 때 빈 문자열을 반환한다', () => {
        expect(convertFolderToUrlSegment('')).toBe('');
    });

    it('대시/언더스코어 포함 폴더명일 때 그대로 반환한다', () => {
        expect(convertFolderToUrlSegment('user-profile')).toBe('user-profile');
        expect(convertFolderToUrlSegment('user_profile')).toBe('user_profile');
    });

    it('대괄호가 있지만 alphabetic 시작이 아닌 잘못된 패턴 [123] 일 때 :123 으로 변환된다', () => {
        expect(convertFolderToUrlSegment('[123]')).toBe(':123');
    });
});
