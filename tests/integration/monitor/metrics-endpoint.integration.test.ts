import request from 'supertest';
import express from 'express';
import {
    registerMonitor,
    stopMonitor,
    MonitorContext,
} from '@core/lib/devtools/monitor/monitorSetup';
import { MetricsCollector } from '@core/lib/devtools/monitor/metricsCollector';
import { MONITOR_PATH } from '@core/lib/devtools/monitor/monitorTypes';

/**
 * /__kusto/metrics 엔드포인트 통합 — 요청 카운트 + 스냅샷 형태 + dev 활성.
 * (NODE_ENV=test 는 production 이 아니므로 모니터 활성. supertest 요청은 127.0.0.1 → localhost 통과.)
 */
function buildApp() {
    const app = express();
    const ctx: MonitorContext = {
        host: '0.0.0.0',
        port: 3000,
        getReadiness: () => ({ ready: true }),
        getRouteCount: () => 7,
    };
    registerMonitor(app, ctx);
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    app.get('/boom', (_req, res) => res.status(500).json({ err: true }));
    return app;
}

describe('monitor /__kusto/metrics (통합)', () => {
    beforeEach(() => {
        MetricsCollector.instance().reset();
    });

    afterAll(() => {
        stopMonitor(); // event-loop 히스토그램 핸들 정리
    });

    it('스냅샷이 app/process/requests/databases 구조로 반환된다', async () => {
        const app = buildApp();
        const res = await request(app).get(MONITOR_PATH);
        expect(res.status).toBe(200);
        expect(res.body.app).toBeDefined();
        expect(res.body.process).toBeDefined();
        expect(res.body.requests).toBeDefined();
        expect(Array.isArray(res.body.databases)).toBe(true);
        expect(res.body.app.routeCount).toBe(7);
        expect(res.body.app.ready).toBe(true);
        expect(typeof res.body.process.pid).toBe('number');
    });

    it('일반 요청은 집계하되 메트릭 엔드포인트 자신은 집계에서 제외한다', async () => {
        const app = buildApp();
        await request(app).get('/ping');
        await request(app).get('/ping');
        await request(app).get('/boom');
        // 메트릭 엔드포인트를 여러 번 폴링해도 total 에 포함되지 않아야 한다
        await request(app).get(MONITOR_PATH);
        const res = await request(app).get(MONITOR_PATH);

        expect(res.body.requests.total).toBe(3); // ping x2 + boom x1, metrics 제외
        expect(res.body.requests.statusClasses['2xx']).toBe(2);
        expect(res.body.requests.statusClasses['5xx']).toBe(1);
        expect(res.body.requests.recent.length).toBeGreaterThan(0);
    });
});
