import { MonitorSnapshot } from '@lib/devtools/monitor/monitorTypes';
import {
    bold, dim, red, green, yellow, cyan,
    screen, truncate, padEnd, padStart, bar, meter, sparkline,
    boxLines, sideBySide, humanBytes, humanDuration, commafy,
} from './ansi';

/**
 * `kusto monitor` 프레임 렌더러(순수 함수). btop 풍 박스 레이아웃을 터미널 cols×rows 에 맞춰
 * 그린다. I/O 는 monitorTui 가 담당하고 여기서는 입력(snapshot/크기)→출력(문자열)만.
 */

export interface RenderOptions {
    cols: number;
    rows: number;
    url: string;
    intervalMs: number;
    lastError?: string;
}

const TWO_COL_MIN = 88; // 이 폭 이상이면 2단 레이아웃

function statusColor(status: number): (s: string) => string {
    if (status >= 500) return red;
    if (status >= 400) return yellow;
    if (status >= 300) return cyan;
    return green;
}

/** rows 줄·cols 폭으로 정규화한 최종 프레임. 각 줄은 EOL 까지 지운다. */
function frame(lines: string[], cols: number, rows: number): string {
    const out: string[] = [];
    for (let i = 0; i < rows; i++) {
        out.push(truncate(lines[i] ?? '', cols) + screen.clearLine);
    }
    return out.join('\n');
}

function waitingFrame(opts: RenderOptions): string {
    const w = Math.min(opts.cols - 2, 60);
    const box = boxLines('kusto monitor', [
        '',
        yellow(`Waiting for server …`),
        dim(opts.url),
        opts.lastError ? dim(opts.lastError) : '',
        '',
        dim('Start the dev server (metrics: dev + localhost only).'),
        dim('q quit · Ctrl-C exit'),
    ], w);
    const top = Math.max(0, Math.floor((opts.rows - box.length) / 2));
    const lines = [...Array(top).fill(''), ...box.map((l) => ' ' + l)];
    return frame(lines, opts.cols, opts.rows);
}

// ── 패널 내용(색 포함 문자열 배열) ──────────────────────────────────────────

function processContent(snap: MonitorSnapshot, innerW: number): string[] {
    const p = snap.process;
    const mw = Math.max(8, Math.min(24, innerW - 22));
    const cpuMeter = meter(p.cpuPercent, 100, Math.max(6, Math.min(14, innerW - 30)));
    return [
        `rss  ${meter(p.memory.rss, p.memory.heapTotal * 2, mw)} ${padStart(humanBytes(p.memory.rss), 9)}`,
        `heap ${meter(p.memory.heapUsed, p.memory.heapTotal, mw)} ${padStart(humanBytes(p.memory.heapUsed), 9)}`,
        `cpu  ${cpuMeter} ${padStart(p.cpuPercent + '%', 4)}`,
        `evloop ${p.eventLoopLag.meanMs}ms ${dim('max ' + p.eventLoopLag.maxMs)}   pid ${p.pid} ${dim(p.nodeVersion)}`,
    ];
}

function requestsContent(snap: MonitorSnapshot, innerW: number): string[] {
    const r = snap.requests;
    const spark = cyan(sparkline(r.perSecondSeries, Math.max(8, Math.min(28, innerW - 30))));
    const sc = r.statusClasses;
    return [
        `req/s ${bold(padStart(String(r.perSecond), 4))}  ${spark}`,
        `in-flight ${r.inFlight}   total ${commafy(r.total)}`,
        `${green('2xx ' + sc['2xx'])}  ${cyan('3xx ' + sc['3xx'])}  ${yellow('4xx ' + sc['4xx'])}  ${red('5xx ' + sc['5xx'])}`,
        `${dim('lat')} p50 ${r.latency.p50} p95 ${r.latency.p95} p99 ${r.latency.p99} ${dim('max ' + r.latency.max + ' avg ' + r.latency.avg)}`,
    ];
}

function databasesContent(snap: MonitorSnapshot): string[] {
    if (snap.databases.length === 0) return [dim('(none)')];
    return snap.databases.map((db) => {
        const dot = db.connected ? green('●') : red('●');
        return `${dot} ${padEnd(db.name, 14)} ${padEnd(dim(db.provider), 14)} ${dim('rc:' + db.reconnectAttempts)}`;
    });
}

function appContent(snap: MonitorSnapshot): string[] {
    const a = snap.app;
    const onoff = (b: boolean) => (b ? green('on') : dim('off'));
    return [
        `routes ${bold(String(a.routeCount))}  repos ${bold(String(a.repositoryCount))}  inject ${bold(String(a.injectableCount))}`,
        `docs ${onoff(a.flags.autoDocs)}  schema ${onoff(a.flags.schemaApi)}  env ${cyan(a.env)}`,
    ];
}

export function renderFrame(snap: MonitorSnapshot | null, opts: RenderOptions): string {
    if (!snap) return waitingFrame(opts);

    const { cols, rows } = opts;
    const a = snap.app;
    const p = snap.process;
    const lines: string[] = [];

    // ── Header box (full width) ─────────────────────────────────────────
    const ready = a.ready ? green('● READY') : red(`● DEGRADED${a.degraded ? ' ' + a.degraded : ''}`);
    const headInner = `${dim(a.env)}  ${cyan(a.host + ':' + a.port)}  ${dim('up ' + humanDuration(p.uptimeSec))}  ${ready}`;
    const hw = cols - 1;
    // 제목 옆에 우측 정렬 상태를 넣기 위해 직접 구성: 헤더는 1줄짜리 박스.
    const headBox = boxLines('kusto monitor', [headInner], hw);
    headBox.forEach((l) => lines.push(' ' + l));

    const twoCol = cols >= TWO_COL_MIN;

    if (twoCol) {
        const totalW = cols - 1;
        const leftW = Math.floor((totalW - 1) * 0.46);
        const rightW = totalW - 1 - leftW;
        const li = leftW - 4, ri = rightW - 4;

        const procBox = boxLines('PROCESS', processContent(snap, li), leftW, 4);
        const reqBox = boxLines('REQUESTS', requestsContent(snap, ri), rightW, 4);
        sideBySide(procBox, reqBox, leftW, rightW).forEach((l) => lines.push(' ' + l));

        const dbBox = boxLines('DATABASES', databasesContent(snap), leftW, 2);
        const appBox = boxLines('APP', appContent(snap), rightW, 2);
        sideBySide(dbBox, appBox, leftW, rightW).forEach((l) => lines.push(' ' + l));
    } else {
        const w = cols - 1, iw = w - 4;
        boxLines('PROCESS', processContent(snap, iw), w, 4).forEach((l) => lines.push(' ' + l));
        boxLines('REQUESTS', requestsContent(snap, iw), w, 4).forEach((l) => lines.push(' ' + l));
        boxLines('DATABASES', databasesContent(snap), w).forEach((l) => lines.push(' ' + l));
        boxLines('APP', appContent(snap), w, 2).forEach((l) => lines.push(' ' + l));
    }

    // ── RECENT box (남은 높이만큼) ──────────────────────────────────────
    const footerRows = 1;
    const recentInnerH = Math.max(1, rows - lines.length - footerRows - 2); // -2: 박스 테두리
    const w = cols - 1, iw = w - 4;
    // 6(method) +1 + PW(path) +1 + 3(status) +1 + 7(dur) = PW+19 ≤ innerW(iw)
    const pathW = Math.max(8, iw - 19);
    const recentLines = snap.requests.recent.slice(0, recentInnerH).map((req) => {
        const col = statusColor(req.status);
        return `${padEnd(bold(req.method), 6)} ${padEnd(req.path, pathW)} ${col(padStart(String(req.status), 3))} ${dim(padStart(req.durationMs.toFixed(0) + 'ms', 7))}`;
    });
    boxLines('RECENT', recentLines, w, recentInnerH).forEach((l) => lines.push(' ' + l));

    // ── Footer ──────────────────────────────────────────────────────────
    while (lines.length < rows - footerRows) lines.push('');
    lines.push(dim(` q quit · refresh ${(opts.intervalMs / 1000).toFixed(1)}s · ${opts.url}`));

    return frame(lines, cols, rows);
}
