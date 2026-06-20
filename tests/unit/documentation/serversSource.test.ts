import { buildServers } from '@lib/documentation/serversSource';
import { snapshotEnv } from '@tests/_setup/env-fixture';

describe('serversSource', () => {
    let restoreEnv: () => void;

    beforeEach(() => {
        restoreEnv = snapshotEnv();
        delete process.env.OPENAPI_SERVERS;
        delete process.env.HOST;
        delete process.env.PORT;
    });
    afterEach(() => restoreEnv());

    describe('buildServers', () => {
        it('OPENAPI_SERVERS 가 없을 때 HOST/PORT 기반 단일 server 를 반환한다', () => {
            process.env.HOST = 'localhost';
            process.env.PORT = '4000';
            const servers = buildServers(process.env);
            expect(servers).toEqual([{ url: 'http://localhost:4000', description: 'Local' }]);
        });

        it('HOST/PORT 둘 다 없을 때 기본값 (localhost:3000) 을 사용한다', () => {
            const servers = buildServers(process.env);
            expect(servers[0].url).toBe('http://localhost:3000');
        });

        it('OPENAPI_SERVERS JSON 배열이 유효할 때 그것을 사용한다', () => {
            process.env.OPENAPI_SERVERS = JSON.stringify([
                { url: 'https://api.example.com', description: 'Prod' },
                { url: 'https://staging.example.com', description: 'Staging' },
            ]);
            const servers = buildServers(process.env);
            expect(servers).toHaveLength(2);
            expect(servers[0].url).toBe('https://api.example.com');
            expect(servers[1].description).toBe('Staging');
        });

        it('OPENAPI_SERVERS JSON 파싱 실패 시 fallback 을 사용한다', () => {
            process.env.OPENAPI_SERVERS = 'not-json';
            const servers = buildServers(process.env);
            expect(servers[0].url).toMatch(/^http:\/\/localhost/);
        });

        it('OPENAPI_SERVERS 가 배열이 아닌 JSON 일 때 fallback 을 사용한다', () => {
            process.env.OPENAPI_SERVERS = JSON.stringify({ url: 'foo' });
            const servers = buildServers(process.env);
            expect(servers[0].url).toMatch(/^http:\/\/localhost/);
        });

        it('항목에 url 키가 없을 때 그 항목만 무시하고 나머지는 사용한다', () => {
            process.env.OPENAPI_SERVERS = JSON.stringify([
                { description: 'no url' },
                { url: 'https://ok.example.com' },
            ]);
            const servers = buildServers(process.env);
            expect(servers).toHaveLength(1);
            expect(servers[0].url).toBe('https://ok.example.com');
        });
    });
});
