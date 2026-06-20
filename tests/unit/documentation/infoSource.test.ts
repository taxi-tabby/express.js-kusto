import { buildInfo } from '@lib/documentation/infoSource';
import { snapshotEnv } from '@tests/_setup/env-fixture';

describe('infoSource', () => {
    let restoreEnv: () => void;

    beforeEach(() => {
        restoreEnv = snapshotEnv();
        delete process.env.OPENAPI_TITLE;
        delete process.env.OPENAPI_VERSION;
        delete process.env.OPENAPI_DESC;
    });
    afterEach(() => restoreEnv());

    describe('buildInfo', () => {
        it('env 가 모두 비어 있을 때 package.json 값을 사용한다', () => {
            const info = buildInfo(
                { name: 'my-api', version: '1.2.3', description: 'My API' },
                process.env
            );
            expect(info).toEqual({ title: 'my-api', version: '1.2.3', description: 'My API' });
        });

        it('OPENAPI_TITLE 가 설정되었을 때 package.json name 보다 우선한다', () => {
            process.env.OPENAPI_TITLE = 'Override Title';
            const info = buildInfo(
                { name: 'my-api', version: '1.2.3' },
                process.env
            );
            expect(info.title).toBe('Override Title');
        });

        it('OPENAPI_VERSION 이 빈 문자열일 때 package.json version 으로 fallback 된다', () => {
            process.env.OPENAPI_VERSION = '';
            const info = buildInfo({ name: 'my-api', version: '1.2.3' }, process.env);
            expect(info.version).toBe('1.2.3');
        });

        it('package.json 과 env 모두 비어 있을 때 하드코딩 fallback 을 사용한다', () => {
            const info = buildInfo({}, process.env);
            expect(info.title).toBe('kusto-api');
            expect(info.version).toBe('0.0.0');
        });

        it('description 이 어디에도 없을 때 description 키를 생략한다', () => {
            const info = buildInfo({ name: 'a', version: '1' }, process.env);
            expect(info.description).toBeUndefined();
        });
    });
});
