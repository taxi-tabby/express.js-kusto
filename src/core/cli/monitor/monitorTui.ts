import * as http from 'http';
import { MonitorSnapshot, MONITOR_PATH } from '@lib/devtools/monitor/monitorTypes';
import { screen } from './ansi';
import { renderFrame } from './render';

/**
 * `kusto monitor` TUI 실행기(I/O). 실행 중인 서버의 /__kusto/metrics 를 폴링해
 * 경량 ANSI 화면을 그린다. 터미널 크기 변화·키 입력·종료 정리를 처리한다.
 */

export interface MonitorRunOptions {
    /** 전체 URL 직접 지정(우선). 없으면 host/port 로 구성. */
    url?: string;
    host?: string;
    port?: number;
    /** 폴링 주기(ms). 기본 1000. */
    interval?: number;
}

function resolveUrl(opts: MonitorRunOptions): string {
    if (opts.url) return opts.url;
    const host = opts.host || 'localhost';
    const port = opts.port || parseInt(process.env.PORT || '3000', 10);
    return `http://${host}:${port}${MONITOR_PATH}`;
}

function fetchSnapshot(url: string, timeoutMs: number): Promise<MonitorSnapshot> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(data) as MonitorSnapshot); }
                catch { reject(new Error('invalid metrics JSON')); }
            });
        });
        req.on('error', (e) => reject(e));
        req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')));
    });
}

export function runMonitor(opts: MonitorRunOptions = {}): void {
    const url = resolveUrl(opts);
    const intervalMs = Math.max(200, opts.interval || 1000);
    const out = process.stdout;

    let timer: NodeJS.Timeout | undefined;
    let polling = false;
    let lastSnapshot: MonitorSnapshot | null = null;
    let lastError: string | undefined;
    let stopped = false;

    const dims = () => ({ cols: out.columns || 80, rows: out.rows || 24 });

    const draw = (full = false) => {
        const { cols, rows } = dims();
        const buf = (full ? screen.clear : screen.home)
            + renderFrame(lastSnapshot, { cols, rows, url, intervalMs, lastError });
        out.write(buf);
    };

    const tick = async () => {
        if (polling || stopped) return;
        polling = true;
        try {
            lastSnapshot = await fetchSnapshot(url, Math.min(intervalMs, 2000));
            lastError = undefined;
        } catch (e) {
            lastSnapshot = null;
            lastError = e instanceof Error ? e.message : String(e);
        } finally {
            polling = false;
            if (!stopped) draw();
        }
    };

    const cleanup = (code = 0) => {
        if (stopped) return;
        stopped = true;
        if (timer) clearInterval(timer);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        out.write(screen.showCursor + screen.leaveAlt);
        process.exit(code);
    };

    // 입력: q / Ctrl-C / Ctrl-D 로 종료
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (key: string) => {
            if (key === 'q' || key === '\x03' || key === '\x04') cleanup(0);
        });
    }
    process.on('SIGINT', () => cleanup(0));
    process.on('SIGTERM', () => cleanup(0));

    // 터미널 크기 변화 → 전체 클리어 후 재렌더
    out.on('resize', () => { if (!stopped) draw(true); });

    // 시작: alt-screen + 커서 숨김 + 즉시 1회 폴링
    out.write(screen.enterAlt + screen.hideCursor);
    draw(true);
    void tick();
    timer = setInterval(() => { void tick(); }, intervalMs);
}
