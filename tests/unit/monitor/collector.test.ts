import { MetricsCollector } from '@core/lib/devtools/monitor/metricsCollector';
import { PER_SECOND_WINDOW } from '@core/lib/devtools/monitor/monitorTypes';

describe('monitor/MetricsCollector', () => {
    let c: MetricsCollector;

    beforeEach(() => {
        c = MetricsCollector.instance();
        c.reset();
    });

    it('onStart/onFinish 가 total·in-flight·status 분류를 정확히 집계한다', () => {
        c.onStart();
        c.onStart();
        expect(c.snapshot().inFlight).toBe(2);

        c.onFinish('GET', '/a', 200, 5);
        c.onFinish('POST', '/b', 404, 12);
        const s = c.snapshot();
        expect(s.total).toBe(2);
        expect(s.inFlight).toBe(0); // 둘 다 종료
        expect(s.statusClasses['2xx']).toBe(1);
        expect(s.statusClasses['4xx']).toBe(1);
    });

    it('지연 백분위와 최대/평균을 계산한다', () => {
        for (const d of [10, 20, 30, 40, 100]) c.onFinish('GET', '/x', 200, d);
        const lat = c.snapshot().latency;
        expect(lat.max).toBe(100);
        expect(lat.avg).toBe(40); // (10+20+30+40+100)/5
        expect(lat.p50).toBeGreaterThanOrEqual(20);
        expect(lat.p95).toBeGreaterThanOrEqual(40);
    });

    it('최근 요청은 최신 먼저, 상한 내에서 유지된다', () => {
        for (let i = 0; i < 60; i++) c.onFinish('GET', `/r${i}`, 200, i);
        const recent = c.snapshot().recent;
        expect(recent.length).toBeLessThanOrEqual(50);
        expect(recent[0].path).toBe('/r59'); // 최신 먼저
    });

    it('topRoutes 가 횟수 내림차순으로 집계된다', () => {
        for (let i = 0; i < 5; i++) c.onFinish('GET', '/hot', 200, 1);
        c.onFinish('GET', '/cold', 200, 1);
        const top = c.snapshot().topRoutes;
        expect(top[0].route).toBe('/hot');
        expect(top[0].count).toBe(5);
    });

    it('req/s 시계열 길이는 윈도우 크기와 같다', () => {
        c.onFinish('GET', '/a', 200, 1);
        expect(c.snapshot().perSecondSeries).toHaveLength(PER_SECOND_WINDOW);
    });

    it('reset 후 모든 카운터가 0', () => {
        c.onFinish('GET', '/a', 200, 1);
        c.reset();
        const s = c.snapshot();
        expect(s.total).toBe(0);
        expect(s.inFlight).toBe(0);
        expect(s.recent).toHaveLength(0);
        expect(s.topRoutes).toHaveLength(0);
    });
});
