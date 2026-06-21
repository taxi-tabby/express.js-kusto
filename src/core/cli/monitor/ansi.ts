/**
 * 경량 ANSI 헬퍼(무의존). `kusto monitor` TUI 렌더링 원시 도구.
 * 색/막대/스파크라인/폭 인식 자르기·패딩. 모두 순수 함수.
 */

const ESC = '\x1b[';
const RESET = `${ESC}0m`;

const sgr = (code: number, s: string): string => `${ESC}${code}m${s}${RESET}`;

export const bold = (s: string): string => sgr(1, s);
export const dim = (s: string): string => sgr(2, s);
export const red = (s: string): string => sgr(31, s);
export const green = (s: string): string => sgr(32, s);
export const yellow = (s: string): string => sgr(33, s);
export const blue = (s: string): string => sgr(34, s);
export const magenta = (s: string): string => sgr(35, s);
export const cyan = (s: string): string => sgr(36, s);
export const gray = (s: string): string => sgr(90, s);

/** 화면 제어 시퀀스 */
export const screen = {
    enterAlt: `${ESC}?1049h`,
    leaveAlt: `${ESC}?1049l`,
    hideCursor: `${ESC}?25l`,
    showCursor: `${ESC}?25h`,
    home: `${ESC}H`,
    clear: `${ESC}2J${ESC}H`,
    clearLine: `${ESC}K`,
};

// ANSI 이스케이프(CSI: 색 m, clearLine K, 커서이동 H/J 등 letter 로 끝나는 시퀀스)를 제거한
// "보이는" 길이. 폭 계산은 0폭 제어문자를 모두 무시해야 정확하다.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
export function visibleLength(s: string): number {
    return s.replace(ANSI_RE, '').length;
}

/** 보이는 폭 기준으로 자른다(넘치면 끝에 … 표시). 색 코드는 유지. */
export function truncate(s: string, width: number): string {
    if (width <= 0) return '';
    if (visibleLength(s) <= width) return s;
    // 단순화를 위해 색이 섞이면 코드까지 포함해 자르되, 끝에 reset 보장.
    let out = '';
    let vis = 0;
    let i = 0;
    while (i < s.length && vis < width - 1) {
        const m = s.slice(i).match(/^\x1b\[[0-9;]*m/);
        if (m) {
            out += m[0];
            i += m[0].length;
            continue;
        }
        out += s[i];
        i++;
        vis++;
    }
    return out + RESET + '…';
}

/** 보이는 폭 기준 오른쪽 공백 패딩(고정폭 칼럼용). */
export function padEnd(s: string, width: number): string {
    const pad = width - visibleLength(s);
    return pad > 0 ? s + ' '.repeat(pad) : truncate(s, width);
}

/** 보이는 폭 기준 왼쪽 공백 패딩(우측 정렬). */
export function padStart(s: string, width: number): string {
    const pad = width - visibleLength(s);
    return pad > 0 ? ' '.repeat(pad) + s : truncate(s, width);
}

/** 가로 막대 게이지. width 칸 안에서 value/max 비율을 채운다. */
export function bar(value: number, max: number, width: number): string {
    if (width <= 0) return '';
    const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    const filled = Math.round(ratio * width);
    return '█'.repeat(filled) + dim('░'.repeat(width - filled));
}

/** 둥근 박스 테두리 색(차분한 시안). 한 SGR 로 처리해 중첩 reset 회피. */
export const border = (s: string): string => `\x1b[38;5;30m${s}${RESET}`;

const GRAD = [32, 32, 32, 33, 33, 31]; // 채움 위치별 색(green→yellow→red)
/**
 * btop 풍 그라데이션 게이지 — 채워지는 칸을 위치 비율에 따라 green→yellow→red 로 칠한다.
 * (막대가 찰수록 노랑/빨강이 드러나 부하를 직관적으로 보여줌)
 */
export function meter(value: number, max: number, width: number): string {
    if (width <= 0) return '';
    const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    const filled = Math.round(ratio * width);
    let s = '';
    for (let i = 0; i < width; i++) {
        if (i < filled) {
            const t = width > 1 ? i / (width - 1) : 0;
            const code = GRAD[Math.min(GRAD.length - 1, Math.floor(t * GRAD.length))];
            s += `\x1b[${code}m█${RESET}`;
        } else {
            s += border('─');
        }
    }
    return s;
}

const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };

/**
 * 제목이 박힌 둥근 박스를 그린다. 반환 각 줄의 "보이는" 폭은 정확히 width.
 * @param content 내부 줄(이미 색 포함 가능). 폭이 넘치면 자르고 모자라면 패딩.
 */
export function boxLines(
    title: string,
    content: string[],
    width: number,
    innerHeight?: number,
): string[] {
    const w = Math.max(8, width);
    const innerW = w - 4; // "│ " + content + " │"
    // top: tl ─ ' TITLE ' ─*fill tr
    const t = ` ${title} `;
    const used = 2 + visibleLength(t); // tl + 첫 ─ + title
    const fill = Math.max(0, w - used - 1); // - tr
    const top =
        border(BOX.tl + BOX.h) +
        bold(cyan(title.length ? t : '')) +
        border(BOX.h.repeat(fill) + BOX.tr);

    const rows = innerHeight ?? content.length;
    const body: string[] = [];
    for (let i = 0; i < rows; i++) {
        const c = content[i] ?? '';
        body.push(border(BOX.v) + ' ' + padEnd(c, innerW) + ' ' + border(BOX.v));
    }
    const bottom = border(BOX.bl + BOX.h.repeat(w - 2) + BOX.br);
    return [top, ...body, bottom];
}

/** 두 박스(같은/다른 높이)를 좌우로 합친다. 각 박스 줄은 자기 폭으로 패딩돼 있어야 한다. */
export function sideBySide(
    left: string[],
    right: string[],
    leftW: number,
    rightW: number,
    gap = 1,
): string[] {
    const h = Math.max(left.length, right.length);
    const blankL = ' '.repeat(leftW);
    const blankR = ' '.repeat(rightW);
    const out: string[] = [];
    for (let i = 0; i < h; i++) {
        out.push((left[i] ?? blankL) + ' '.repeat(gap) + (right[i] ?? blankR));
    }
    return out;
}

const SPARK = '▁▂▃▄▅▆▇█';
/** 스파크라인. 시리즈의 마지막 width 개를 max 기준으로 8단계 막대로. */
export function sparkline(series: number[], width: number): string {
    if (width <= 0 || series.length === 0) return '';
    const slice = series.slice(-width);
    const max = Math.max(1, ...slice);
    return slice
        .map((v) => {
            if (v <= 0) return SPARK[0];
            const idx = Math.min(SPARK.length - 1, Math.floor((v / max) * (SPARK.length - 1)));
            return SPARK[idx];
        })
        .join('');
}

/** 바이트를 사람이 읽기 좋은 단위로. */
export function humanBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
        v /= 1024;
        u++;
    }
    return `${v.toFixed(1)} ${units[u]}`;
}

/** 초를 1h2m3s 형태로. */
export function humanDuration(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return `${h}h${m}m`;
    if (m > 0) return `${m}m${r}s`;
    return `${r}s`;
}

/** 정수 천단위 구분. */
export function commafy(n: number): string {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
