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

const MAX_BODY_BYTES = 512 * 1024; // 스냅샷 JSON 은 작다 — 예상 밖 대용량 응답 방어

/** 파싱된 값이 최소한 스냅샷 형태인지 검증(버전 스큐/엉뚱한 200 응답 방어). */
function isSnapshotShape(v: unknown): v is MonitorSnapshot {
    if (!v || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    return !!o.app && !!o.process && !!o.requests && Array.isArray(o.databases);
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
            let aborted = false;
            res.on('data', (c) => {
                if (aborted) return;
                data += c;
                if (data.length > MAX_BODY_BYTES) {
                    aborted = true;
                    req.destroy();
                    reject(new Error('metrics response too large'));
                }
            });
            res.on('end', () => {
                if (aborted) return;
                let parsed: unknown;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    reject(new Error('invalid metrics JSON'));
                    return;
                }
                if (!isSnapshotShape(parsed)) {
                    reject(new Error('unexpected metrics shape (server/CLI version skew?)'));
                    return;
                }
                resolve(parsed);
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
        try {
            const buf =
                (full ? screen.clear : screen.home) +
                renderFrame(lastSnapshot, { cols, rows, url, intervalMs, lastError });
            out.write(buf);
        } catch (e) {
            // 렌더 자체가 실패하면(예: 예상 밖 스냅샷) 화면을 깨지 않고 대기 프레임으로 강등.
            lastSnapshot = null;
            lastError = `render error: ${e instanceof Error ? e.message : String(e)}`;
            try {
                out.write(
                    screen.clear + renderFrame(null, { cols, rows, url, intervalMs, lastError }),
                );
            } catch {
                /* 최후의 보루: 무시 */
            }
        }
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
    // 어떤 예외 경로에서도 터미널을 alt-screen/커서숨김/raw 상태로 남기지 않도록 최종 안전망.
    process.on('uncaughtException', (e) => {
        lastError = String(e);
        cleanup(1);
    });
    process.on('unhandledRejection', (e) => {
        lastError = String(e);
        cleanup(1);
    });

    // 터미널 크기 변화 → 전체 클리어 후 재렌더
    out.on('resize', () => {
        if (!stopped) draw(true);
    });

    // 시작: alt-screen + 커서 숨김 + 즉시 1회 폴링
    out.write(screen.enterAlt + screen.hideCursor);
    draw(true);
    void tick();
    timer = setInterval(() => {
        void tick();
    }, intervalMs);
}
