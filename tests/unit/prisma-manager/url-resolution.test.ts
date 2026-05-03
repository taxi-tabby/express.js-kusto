import { folderNameToEnvVarName } from '@lib/prismaManager';

describe('folderNameToEnvVarName', () => {
    it('단순 폴더명 default 일 때 DEFAULT__KUSTO_RDB_URL 을 반환한다', () => {
        expect(folderNameToEnvVarName('default')).toBe('DEFAULT__KUSTO_RDB_URL');
    });

    it('camelCase 폴더명 myData 일 때 MY_DATA__KUSTO_RDB_URL 을 반환한다', () => {
        expect(folderNameToEnvVarName('myData')).toBe('MY_DATA__KUSTO_RDB_URL');
    });

    it('snake_case 폴더명 user_account 일 때 USER_ACCOUNT__KUSTO_RDB_URL 을 반환한다', () => {
        expect(folderNameToEnvVarName('user_account')).toBe('USER_ACCOUNT__KUSTO_RDB_URL');
    });

    it('연속된 대문자 폴더명 APIClient 일 때 변환 결과가 __KUSTO_RDB_URL 로 끝난다', () => {
        const result = folderNameToEnvVarName('APIClient');
        expect(result).toMatch(/__KUSTO_RDB_URL$/);
    });

    it('빈 문자열일 때 __KUSTO_RDB_URL 을 반환한다 (edge case)', () => {
        expect(folderNameToEnvVarName('')).toBe('__KUSTO_RDB_URL');
    });
});
