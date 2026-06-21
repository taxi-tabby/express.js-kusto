/**
 * `kusto monitor` 스냅샷 계약(SSOT).
 *
 * 실행 중인 서버가 노출(producer: monitorSetup.buildSnapshot)하고, 별도 프로세스의
 * `kusto monitor` TUI 가 폴링·소비(consumer)하는 JSON 형태를 한 곳에서 정의한다.
 * 둘이 같은 타입을 import 하므로 형태가 어긋날 수 없다.
 */

/** 응답 상태 코드 분류 카운트 */
export interface StatusClassCounts {
    '1xx': number;
    '2xx': number;
    '3xx': number;
    '4xx': number;
    '5xx': number;
}

/** 최근 요청 1건 */
export interface RecentRequest {
    ts: number; // epoch ms
    method: string;
    path: string;
    status: number;
    durationMs: number;
}

/** 경로별 트래픽 집계 1건 */
export interface RouteStat {
    route: string;
    count: number;
    avgMs: number;
}

/** 요청 메트릭 */
export interface RequestMetrics {
    total: number;
    inFlight: number;
    /** 최근 1초 요청 수(가장 최근 완료 버킷 기준) */
    perSecond: number;
    /** 최근 N초 req/s 버킷(스파크라인용, 오래된→최신 순) */
    perSecondSeries: number[];
    statusClasses: StatusClassCounts;
    latency: { p50: number; p95: number; p99: number; max: number; avg: number };
    recent: RecentRequest[];
    topRoutes: RouteStat[];
}

/** 프로세스 메트릭 */
export interface ProcessMetrics {
    pid: number;
    nodeVersion: string;
    uptimeSec: number;
    memory: { rss: number; heapUsed: number; heapTotal: number; external: number };
    /** 최근 인터벌 CPU 사용률(%) — user+system */
    cpuPercent: number;
    /** event-loop 지연(ms): 평균/최대 */
    eventLoopLag: { meanMs: number; maxMs: number };
}

/** DB별 상태 */
export interface DatabaseStatus {
    name: string;
    connected: boolean;
    provider: string;
    reconnectAttempts: number;
}

/** 앱/라우팅 메트릭 */
export interface AppMetrics {
    env: string;
    host: string;
    port: number;
    ready: boolean;
    degraded?: string;
    routeCount: number;
    repositoryCount: number;
    injectableCount: number;
    flags: { autoDocs: boolean; schemaApi: boolean };
}

/** 전체 스냅샷 */
export interface MonitorSnapshot {
    /** 스냅샷 생성 시각(epoch ms) */
    ts: number;
    app: AppMetrics;
    process: ProcessMetrics;
    requests: RequestMetrics;
    databases: DatabaseStatus[];
}

/** 메트릭 엔드포인트 기본 경로 + req/s 시계열 길이(상수 SSOT) */
export const MONITOR_PATH = '/__kusto/metrics';
export const PER_SECOND_WINDOW = 60;
