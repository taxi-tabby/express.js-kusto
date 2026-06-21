/**
 * DB 폴더명 → 환경변수명 변환 (단일 출처 / single source of truth).
 *
 * camelCase/PascalCase 경계에 `_` 를 삽입한 뒤 UPPER_SNAKE 로 바꾸고
 * `__KUSTO_RDB_URL` 접미사를 붙인다.
 *   - `'default'`      → `'DEFAULT__KUSTO_RDB_URL'`
 *   - `'myDatabase'`   → `'MY_DATABASE__KUSTO_RDB_URL'`
 *   - `'user_account'` → `'USER_ACCOUNT__KUSTO_RDB_URL'`
 *
 * NOTE: prismaManager.ts(런타임)와 kusto-db-cli.ts(CLI) 양쪽에서 import 한다.
 * prismaManager 는 모듈 로드 시 싱글톤을 생성하므로, CLI 가 prismaManager 를
 * 끌어오지 않도록 이 변환 로직만 의존성 없는 모듈로 분리했다.
 */
export function folderNameToEnvVarName(folderName: string): string {
    return folderName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase() + '__KUSTO_RDB_URL';
}
