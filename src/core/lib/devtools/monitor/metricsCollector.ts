import {
    RequestMetrics,
    StatusClassCounts,
    RecentRequest,
    RouteStat,
    PER_SECOND_WINDOW,
} from './monitorTypes';

/**
 * 요청 메트릭 수집기(인메모리 싱글톤).
 *
 * monitorMiddleware 가 요청 시작/종료를 기록하면 여기서 누적·요약한다.
 * 모든 버퍼는 고정 크기 링이라 메모리는 상한이 있다(누수 없음).
 */

const RECENT_CAP = 50;        // 최근 요청 보관 수
const LATENCY_SAMPLE_CAP = 500; // 지연 백분위 표본 수
const TOP_ROUTES_CAP = 200;   // route→집계 맵 상한(폭주 방지)

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
}

export class MetricsCollector {
    private static _instance: MetricsCollector;

    private total = 0;
    private inFlight = 0;
    private statusClasses: StatusClassCounts = { '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };

    // req/s: 초 단위 버킷 링(인덱스 = 초 % WINDOW). lastSec 로 stale 버킷을 0 으로 회수.
    private buckets: number[] = new Array(PER_SECOND_WINDOW).fill(0);
    private bucketSec: number[] = new Array(PER_SECOND_WINDOW).fill(-1);

    private latencies: number[] = [];     // 최근 지연 표본(링)
    private latencyMax = 0;
    private latencySum = 0;
    private latencyCount = 0;

    private recent: RecentRequest[] = []; // 최근 요청(링)
    private routes = new Map<string, { count: number; totalMs: number }>();

    static instance(): MetricsCollector {
        if (!this._instance) this._instance = new MetricsCollector();
        return this._instance;
    }

    /** 요청 시작 — in-flight 증가 */
    onStart(): void {
        this.inFlight++;
    }

    /** 요청 종료 기록 */
    onFinish(method: string, route: string, status: number, durationMs: number): void {
        if (this.inFlight > 0) this.inFlight--;
        this.total++;

        // 상태 분류
        const cls = (`${Math.floor(status / 100)}xx`) as keyof StatusClassCounts;
        if (this.statusClasses[cls] !== undefined) this.statusClasses[cls]++;

        // 초 버킷
        const sec = nowSec();
        const i = sec % PER_SECOND_WINDOW;
        if (this.bucketSec[i] !== sec) {
            this.bucketSec[i] = sec;
            this.buckets[i] = 0;
        }
        this.buckets[i]++;

        // 지연 표본(링) + 합계/최대
        this.latencies.push(durationMs);
        if (this.latencies.length > LATENCY_SAMPLE_CAP) this.latencies.shift();
        this.latencyMax = Math.max(this.latencyMax, durationMs);
        this.latencySum += durationMs;
        this.latencyCount++;

        // 최근 요청(링)
        this.recent.push({ ts: Date.now(), method, path: route, status, durationMs });
        if (this.recent.length > RECENT_CAP) this.recent.shift();

        // route 집계(상한 내)
        const r = this.routes.get(route);
        if (r) {
            r.count++;
            r.totalMs += durationMs;
        } else if (this.routes.size < TOP_ROUTES_CAP) {
            this.routes.set(route, { count: 1, totalMs: durationMs });
        }
    }

    /** 현재 요약 스냅샷 */
    snapshot(): RequestMetrics {
        const sec = nowSec();

        // 오래된→최신 순으로 최근 WINDOW 초의 버킷값을 구성(stale 버킷은 0).
        const series: number[] = [];
        for (let age = PER_SECOND_WINDOW - 1; age >= 0; age--) {
            const s = sec - age;
            const i = ((s % PER_SECOND_WINDOW) + PER_SECOND_WINDOW) % PER_SECOND_WINDOW;
            series.push(this.bucketSec[i] === s ? this.buckets[i] : 0);
        }
        // perSecond = 직전 완료 초(현재 초는 아직 진행 중이라 과소집계)
        const perSecond = series[series.length - 2] ?? 0;

        const sorted = [...this.latencies].sort((a, b) => a - b);
        const topRoutes: RouteStat[] = [...this.routes.entries()]
            .map(([route, v]) => ({ route, count: v.count, avgMs: Math.round(v.totalMs / v.count) }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        return {
            total: this.total,
            inFlight: this.inFlight,
            perSecond,
            perSecondSeries: series,
            statusClasses: { ...this.statusClasses },
            latency: {
                p50: Math.round(percentile(sorted, 50)),
                p95: Math.round(percentile(sorted, 95)),
                p99: Math.round(percentile(sorted, 99)),
                max: Math.round(this.latencyMax),
                avg: this.latencyCount ? Math.round(this.latencySum / this.latencyCount) : 0,
            },
            recent: [...this.recent].reverse(), // 최신 먼저
            topRoutes,
        };
    }

    /** 테스트/재시작용 리셋 */
    reset(): void {
        this.total = 0;
        this.inFlight = 0;
        this.statusClasses = { '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
        this.buckets.fill(0);
        this.bucketSec.fill(-1);
        this.latencies = [];
        this.latencyMax = 0;
        this.latencySum = 0;
        this.latencyCount = 0;
        this.recent = [];
        this.routes.clear();
    }
}
