import { Express, Request, Response, NextFunction } from 'express';
import { monitorEventLoopDelay, IntervalHistogram } from 'perf_hooks';
import { log } from '@ext/winston';
import { prismaManager } from '@lib/data/database/prismaManager';
import { RepositoryManager } from '@lib/data/database/repositoryManager';
import { DependencyInjector } from '@lib/data/di/dependencyInjector';
import { MetricsCollector } from './metricsCollector';
import { monitorMiddleware } from './monitorMiddleware';
import { MonitorSnapshot, DatabaseStatus, MONITOR_PATH } from './monitorTypes';

/**
 * `kusto monitor` 서버측 — 메트릭 수집 미들웨어 + 스냅샷 엔드포인트(/__kusto/metrics).
 *
 * dev 전용 + localhost 전용. NODE_ENV=production 이거나 비-로컬 접근이면 비활성/거부한다.
 * Core 가 초기화 시 registerMonitor 를 호출한다.
 */

/** Core 가 제공하는 컨텍스트(서버 바인딩/준비상태/라우트 수). */
export interface MonitorContext {
    host: string;
    port: number;
    /** Core.getReadiness 를 모니터 형태로 adapt 한 값(상세 타입 결합 회피). */
    getReadiness: () => { ready: boolean; degraded?: string };
    getRouteCount: () => number;
}

// CPU% / event-loop lag 계산용 모듈 상태(스냅샷 간 델타).
let elMonitor: IntervalHistogram | undefined;
let lastCpu: NodeJS.CpuUsage | undefined;
let lastCpuAt = 0;

/** dev(비-production)에서만 모니터 활성. */
export function isMonitorEnabled(): boolean {
    return process.env.NODE_ENV !== 'production';
}

/**
 * 요청이 루프백(로컬호스트)에서 온 것인지 — 신뢰할 수 없는 프록시 헤더(req.ip/X-Forwarded-For)가
 * 아니라 실제 TCP 피어 주소(req.socket.remoteAddress)만 본다.
 *
 * 주의: trust proxy 가 켜지면(기본값) req.ip 는 클라이언트가 보낸 XFF 에서 파생되므로,
 * req.ip 로 게이트를 걸면 원격 클라이언트가 `X-Forwarded-For: 127.0.0.1` 로 우회할 수 있다.
 * 따라서 raw 소켓 주소만 정확히(exact) 비교한다(substring/endsWith 금지).
 */
export function isLocalRequest(req: Pick<Request, 'socket'>): boolean {
    const ra = req.socket?.remoteAddress || '';
    return ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
}

function buildDatabases(): DatabaseStatus[] {
    try {
        const status = prismaManager.getStatus();
        return status.databases.map((d) => ({
            name: d.name,
            connected: d.connected,
            provider: safe(() => prismaManager.getProviderForDatabase(d.name), 'unknown'),
            reconnectAttempts: safe(() => prismaManager.getReconnectionAttempts(d.name), 0),
        }));
    } catch {
        return [];
    }
}

function safe<T>(fn: () => T, fallback: T): T {
    try { return fn(); } catch { return fallback; }
}

/** 전체 스냅샷 조립(producer). */
export function buildSnapshot(ctx: MonitorContext): MonitorSnapshot {
    const mem = process.memoryUsage();

    // CPU%: 직전 표본과의 델타를 wall-clock 대비로 환산(단일 코어 기준 %).
    const nowMs = Date.now();
    let cpuPercent = 0;
    if (lastCpu && lastCpuAt) {
        const diff = process.cpuUsage(lastCpu); // microseconds since lastCpu
        const elapsedMs = nowMs - lastCpuAt;
        if (elapsedMs > 0) {
            cpuPercent = Math.round(((diff.user + diff.system) / 1000 / elapsedMs) * 100);
        }
    }
    lastCpu = process.cpuUsage();
    lastCpuAt = nowMs;

    // event-loop lag: 활성화된 히스토그램에서 평균/최대(ns→ms) 후 리셋(인터벌 값).
    let meanMs = 0;
    let maxMs = 0;
    if (elMonitor) {
        meanMs = Number.isFinite(elMonitor.mean) ? elMonitor.mean / 1e6 : 0;
        maxMs = Number.isFinite(elMonitor.max) ? elMonitor.max / 1e6 : 0;
        elMonitor.reset();
    }

    const readiness = safe(() => ctx.getReadiness(), { ready: false } as { ready: boolean; degraded?: string });
    const repoCount = safe(() => RepositoryManager.getInstance().getStatus().repositoryCount, 0);
    const injCount = safe(() => Object.keys(DependencyInjector.getInstance().getInjectedModules() || {}).length, 0);

    return {
        ts: nowMs,
        app: {
            env: process.env.NODE_ENV || 'development',
            host: ctx.host,
            port: ctx.port,
            ready: readiness.ready,
            degraded: readiness.degraded,
            routeCount: safe(() => ctx.getRouteCount(), 0),
            repositoryCount: repoCount,
            injectableCount: injCount,
            flags: {
                autoDocs: process.env.AUTO_DOCS === 'true',
                schemaApi: process.env.ENABLE_SCHEMA_API === 'true',
            },
        },
        process: {
            pid: process.pid,
            nodeVersion: process.version,
            uptimeSec: Math.round(process.uptime()),
            memory: {
                rss: mem.rss,
                heapUsed: mem.heapUsed,
                heapTotal: mem.heapTotal,
                external: mem.external,
            },
            cpuPercent,
            eventLoopLag: { meanMs: round1(meanMs), maxMs: round1(maxMs) },
        },
        requests: MetricsCollector.instance().snapshot(),
        databases: buildDatabases(),
    };
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

/**
 * 모니터를 Express 앱에 등록한다(dev 전용).
 * - 메트릭 수집 미들웨어(모든 라우트보다 먼저)
 * - /__kusto/metrics 스냅샷 엔드포인트(localhost 전용)
 */
export function registerMonitor(app: Express, ctx: MonitorContext): void {
    if (!isMonitorEnabled()) return;

    // event-loop 지연 히스토그램 시작(1회).
    if (!elMonitor) {
        elMonitor = monitorEventLoopDelay({ resolution: 20 });
        elMonitor.enable();
    }
    // CPU 기준 표본 초기화.
    lastCpu = process.cpuUsage();
    lastCpuAt = Date.now();

    app.use(monitorMiddleware);

    app.get(MONITOR_PATH, (req: Request, res: Response, _next: NextFunction) => {
        if (!isLocalRequest(req)) {
            res.status(403).json({ error: 'monitor endpoint is localhost-only' });
            return;
        }
        res.json(buildSnapshot(ctx));
    });

    log.Debug(`Monitor endpoint enabled at ${MONITOR_PATH} (dev, localhost-only)`);
}

/** 테스트 정리용 — event-loop 히스토그램 비활성화 + 모듈 상태 리셋(열린 핸들 제거). */
export function stopMonitor(): void {
    if (elMonitor) {
        elMonitor.disable();
        elMonitor = undefined;
    }
    lastCpu = undefined;
    lastCpuAt = 0;
}
