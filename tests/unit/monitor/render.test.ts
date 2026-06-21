import { renderFrame } from '@core/cli/monitor/render';
import { visibleLength } from '@core/cli/monitor/ansi';
import { MonitorSnapshot } from '@core/lib/devtools/monitor/monitorTypes';

function fakeSnapshot(recentCount = 30): MonitorSnapshot {
    return {
        ts: Date.now(),
        app: {
            env: 'development',
            host: '0.0.0.0',
            port: 3000,
            ready: true,
            routeCount: 24,
            repositoryCount: 3,
            injectableCount: 5,
            flags: { autoDocs: true, schemaApi: false },
        },
        process: {
            pid: 12345,
            nodeVersion: 'v20.0.0',
            uptimeSec: 3725,
            memory: {
                rss: 120 * 1024 * 1024,
                heapUsed: 45 * 1024 * 1024,
                heapTotal: 90 * 1024 * 1024,
                external: 1024,
            },
            cpuPercent: 8,
            eventLoopLag: { meanMs: 0.4, maxMs: 2.1 },
        },
        requests: {
            total: 1234,
            inFlight: 2,
            perSecond: 12,
            perSecondSeries: Array.from({ length: 60 }, (_, i) => i % 10),
            statusClasses: { '1xx': 0, '2xx': 1100, '3xx': 30, '4xx': 80, '5xx': 5 },
            latency: { p50: 5, p95: 40, p99: 80, max: 120, avg: 9 },
            recent: Array.from({ length: recentCount }, (_, i) => ({
                ts: Date.now(),
                method: 'GET',
                path: `/users/${i}`,
                status: i % 7 === 0 ? 500 : 200,
                durationMs: i,
            })),
            topRoutes: [{ route: '/users', count: 100, avgMs: 5 }],
        },
        databases: [
            { name: 'default', connected: true, provider: 'postgresql', reconnectAttempts: 0 },
        ],
    };
}

const eachLine = (frame: string) => frame.split('\n');

describe('monitor/renderFrame — 터미널 크기 인식', () => {
    it('snapshot 이 null 이면 대기 화면을 그린다', () => {
        const f = renderFrame(null, {
            cols: 80,
            rows: 24,
            url: 'http://localhost:3000/__kusto/metrics',
            intervalMs: 1000,
            lastError: 'ECONNREFUSED',
        });
        expect(f).toContain('Waiting for server');
        expect(eachLine(f)).toHaveLength(24);
    });

    it('주요 패널 라벨과 박스 테두리를 포함한다', () => {
        const f = renderFrame(fakeSnapshot(), { cols: 100, rows: 30, url: 'u', intervalMs: 1000 });
        for (const label of [
            'kusto monitor',
            'PROCESS',
            'REQUESTS',
            'DATABASES',
            'APP',
            'RECENT',
        ]) {
            expect(f).toContain(label);
        }
        expect(f).toContain('default'); // db name
        expect(f).toContain('routes');
        // btop 풍 둥근 박스 테두리
        expect(f).toContain('╭');
        expect(f).toContain('│');
        expect(f).toContain('╰');
    });

    it('정확히 rows 줄을 출력하고, 각 줄의 보이는 폭이 cols 를 넘지 않는다', () => {
        for (const [cols, rows] of [
            [80, 24],
            [40, 16],
            [120, 50],
            [30, 10],
        ]) {
            const f = renderFrame(fakeSnapshot(40), { cols, rows, url: 'u', intervalMs: 1000 });
            const lines = eachLine(f);
            expect(lines).toHaveLength(rows);
            for (const ln of lines) {
                // clearLine 시퀀스를 제외한 보이는 폭이 cols 이하
                expect(visibleLength(ln)).toBeLessThanOrEqual(cols);
            }
        }
    });

    it('높이가 작으면 RECENT 목록이 화면을 넘지 않게 잘린다', () => {
        const small = renderFrame(fakeSnapshot(40), {
            cols: 80,
            rows: 18,
            url: 'u',
            intervalMs: 1000,
        });
        const big = renderFrame(fakeSnapshot(40), {
            cols: 80,
            rows: 40,
            url: 'u',
            intervalMs: 1000,
        });
        const countRecent = (f: string) => (f.match(/\/users\//g) || []).length;
        expect(countRecent(small)).toBeLessThan(countRecent(big));
        expect(eachLine(small)).toHaveLength(18);
    });
});
