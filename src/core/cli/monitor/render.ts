import { MonitorSnapshot } from '@lib/devtools/monitor/monitorTypes';
import {
    bold, dim, red, green, yellow, cyan, gray,
    screen, truncate, padEnd, padStart, bar, sparkline,
    humanBytes, humanDuration, commafy,
} from './ansi';

/**
 * `kusto monitor` 프레임 렌더러(순수 함수). 터미널 cols×rows 에 맞춰 한 화면 문자열을 만든다.
 * I/O 는 monitorTui 가 담당하고, 여기서는 입력(snapshot/크기)→출력(문자열)만.
 */

export interface RenderOptions {
    cols: number;
    rows: number;
    url: string;
    intervalMs: number;
    /** 마지막 폴링 오류 메시지(서버 다운 등). snapshot 이 null 일 때 표시. */
    lastError?: string;
}

/** 상태코드 색 */
function statusColor(status: number): (s: string) => string {
    if (status >= 500) return red;
    if (status >= 400) return yellow;
    if (status >= 300) return cyan;
    return green;
}

/** rows 줄·cols 폭으로 정규화한 최종 프레임 문자열. 각 줄은 EOL 까지 지운다. */
function frame(lines: string[], cols: number, rows: number): string {
    const out: string[] = [];
    for (let i = 0; i < rows; i++) {
        const line = lines[i] ?? '';
        out.push(truncate(line, cols) + screen.clearLine);
    }
    return out.join('\n');
}

function waitingFrame(opts: RenderOptions): string {
    const lines = [
        bold(' kusto monitor'),
        '',
        yellow(`  Waiting for server at ${opts.url} …`),
        dim('  Start the dev server — metrics are dev-mode + localhost only.'),
        opts.lastError ? dim(`  (${opts.lastError})`) : '',
        '',
        dim('  q quit · Ctrl-C exit'),
    ];
    return frame(lines, opts.cols, opts.rows);
}

export function renderFrame(snap: MonitorSnapshot | null, opts: RenderOptions): string {
    if (!snap) return waitingFrame(opts);

    const { cols, rows } = opts;
    const lines: string[] = [];
    const a = snap.app;
    const p = snap.process;
    const r = snap.requests;

    // ── Header ──────────────────────────────────────────────────────────
    const ready = a.ready ? green('● READY') : red(`● DEGRADED${a.degraded ? ' ' + a.degraded : ''}`);
    const head = [
        bold('kusto monitor'),
        gray('·'), `${a.env}`,
        gray('·'), `${a.host}:${a.port}`,
        gray('·'), `up ${humanDuration(p.uptimeSec)}`,
        gray('·'), ready,
    ].join(' ');
    lines.push(' ' + head);
    lines.push(dim('─'.repeat(cols)));

    // ── Process ─────────────────────────────────────────────────────────
    lines.push(bold(' PROCESS'));
    const barW = Math.max(6, Math.min(20, cols - 40));
    lines.push(`  rss   ${bar(p.memory.rss, p.memory.heapTotal * 2, barW)} ${padStart(humanBytes(p.memory.rss), 9)}`);
    lines.push(`  heap  ${bar(p.memory.heapUsed, p.memory.heapTotal, barW)} ${padStart(humanBytes(p.memory.heapUsed) + ' / ' + humanBytes(p.memory.heapTotal), 18)}`);
    lines.push(`  cpu ${padStart(p.cpuPercent + '%', 4)}   evloop ${p.eventLoopLag.meanMs}ms ${dim('(max ' + p.eventLoopLag.maxMs + ')')}   pid ${p.pid}  ${dim(p.nodeVersion)}`);

    // ── Requests ────────────────────────────────────────────────────────
    lines.push(bold(' REQUESTS'));
    const spark = sparkline(r.perSecondSeries, Math.max(8, Math.min(40, cols - 36)));
    lines.push(`  req/s ${padStart(String(r.perSecond), 4)}  ${cyan(spark)}   in-flight ${r.inFlight}   total ${commafy(r.total)}`);
    const sc = r.statusClasses;
    lines.push(`  ${green('2xx ' + sc['2xx'])}   ${cyan('3xx ' + sc['3xx'])}   ${yellow('4xx ' + sc['4xx'])}   ${red('5xx ' + sc['5xx'])}`);
    lines.push(`  lat   p50 ${r.latency.p50}ms  p95 ${r.latency.p95}ms  p99 ${r.latency.p99}ms  max ${r.latency.max}ms  avg ${r.latency.avg}ms`);

    // ── Databases + App ─────────────────────────────────────────────────
    lines.push(bold(' DATABASES'));
    if (snap.databases.length === 0) {
        lines.push(dim('  (none)'));
    } else {
        for (const db of snap.databases) {
            const dot = db.connected ? green('●') : red('●');
            lines.push(`  ${dot} ${padEnd(db.name, 16)} ${padEnd(db.provider, 12)} ${dim('reconnects:' + db.reconnectAttempts)}`);
        }
    }
    lines.push(bold(' APP'));
    const flags = `docs ${a.flags.autoDocs ? green('on') : dim('off')}  schema ${a.flags.schemaApi ? green('on') : dim('off')}`;
    lines.push(`  routes ${a.routeCount}   repos ${a.repositoryCount}   injectables ${a.injectableCount}   ${flags}`);

    // ── Recent (남은 높이만큼) ───────────────────────────────────────────
    lines.push(dim('─'.repeat(cols)));
    lines.push(bold(' RECENT'));
    const footerRows = 1;
    const avail = Math.max(0, rows - lines.length - footerRows);
    for (const req of r.recent.slice(0, avail)) {
        const col = statusColor(req.status);
        const line = `  ${padEnd(req.method, 6)} ${padEnd(req.path, Math.max(10, cols - 24))} ${col(padStart(String(req.status), 3))} ${padStart(req.durationMs.toFixed(0) + 'ms', 7)}`;
        lines.push(line);
    }

    // ── Footer ──────────────────────────────────────────────────────────
    while (lines.length < rows - footerRows) lines.push('');
    lines.push(dim(` q quit · refresh ${(opts.intervalMs / 1000).toFixed(1)}s · ${opts.url}`));

    return frame(lines, cols, rows);
}
