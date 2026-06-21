import winston, { createLogger, transports, format, Logger } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { TransformableInfo } from 'logform';
import path from 'path';
import fs from 'fs';

// ── 로그 레벨 / 색상(ANSI) / 이모지 정의 ──────────────────────────
const LOG_SETTINGS = {
    error: { level: 0, color: '\x1b[31m', emoji: '❌' }, // 빨강
    Error: { level: 0, color: '\x1b[31m', emoji: '❌' }, // 빨강
    Warn: { level: 1, color: '\x1b[33m', emoji: '⚠️' }, // 노랑
    Info: { level: 2, color: '\x1b[36m', emoji: '💡' }, // 청록색
    Debug: { level: 3, color: '\x1b[35m', emoji: '🐛' }, // 자주색
    Silly: { level: 4, color: '\x1b[90m', emoji: '🔍' }, // 회색
    SQL: { level: 3, color: '\x1b[32m', emoji: '🗃️' }, // 녹색
    Route: { level: 2, color: '\x1b[34m', emoji: '🛣️' }, // 파랑
    SessionDeclaration: { level: 2, color: '\x1b[37m', emoji: '🔐' }, // 흰색
    Footwalk: { level: 2, color: '\x1b[90m', emoji: '👣' }, // 회색
    Email: { level: 2, color: '\x1b[34m', emoji: '📧' }, // 파랑
    Auth: { level: 2, color: '\x1b[34m', emoji: '🔑' }, // 파랑
} as const;

const RESET_COLOR = '\x1b[0m';

// ── 타입 ─────────────────────────────────────────────────────────
export type LogLevelName = keyof typeof LOG_SETTINGS;

type CustomLevels = {
    [K in LogLevelName]: winston.LeveledLogMethod;
} & Logger;

// 레벨/색상/이모지 매핑 (winston 설정 및 포맷터에서 사용)
const customLevels = Object.fromEntries(
    Object.entries(LOG_SETTINGS).map(([key, value]) => [key, value.level]),
);
const customColors = Object.fromEntries(
    Object.entries(LOG_SETTINGS).map(([key, value]) => [key, value.color]),
) as Record<string, string>;
const customEmojis = Object.fromEntries(
    Object.entries(LOG_SETTINGS).map(([key, value]) => [key, value.emoji]),
) as Record<string, string>;

const VALID_LEVELS = new Set<string>(Object.keys(LOG_SETTINGS));

// 소문자/별칭 → 정규 레벨명 (LOG_LEVEL 환경변수 정규화용)
const LEVEL_ALIASES: Record<string, LogLevelName> = {
    error: 'Error',
    warn: 'Warn',
    warning: 'Warn',
    info: 'Info',
    debug: 'Debug',
    silly: 'Silly',
    verbose: 'Silly',
    sql: 'SQL',
    route: 'Route',
    footwalk: 'Footwalk',
    email: 'Email',
    auth: 'Auth',
    sessiondeclaration: 'SessionDeclaration',
};

const SILENT_TOKENS = new Set(['silent', 'off', 'none']);

/**
 * LOG_LEVEL 같은 임의 입력을 정규 레벨명으로 해석한다.
 * - 정규 레벨명(대문자) 또는 소문자/별칭 → 정규 레벨명
 * - 'silent' / 'off' / 'none' → 'silent'
 * - 빈 값/미지정/알 수 없는 값 → null (호출측이 환경별 기본값 적용)
 */
export function normalizeLevel(raw: string | undefined): LogLevelName | 'silent' | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (SILENT_TOKENS.has(lower)) return 'silent';
    if (VALID_LEVELS.has(trimmed)) return trimmed as LogLevelName;
    return LEVEL_ALIASES[lower] ?? null;
}

/**
 * 콘솔 transport 의 레벨을 결정한다.
 * 우선순위: LOG_LEVEL > 환경별 기본값(production=Info, test=Error, 그 외=Debug).
 * 반환값 'silent' 은 콘솔 출력을 끈다는 의미.
 * 참고: dev 기본값은 Debug 이므로 Silly(per-item 트레이스)는 기본 숨김 —
 *       전부 보려면 LOG_LEVEL=Silly 로 실행한다.
 */
export function resolveConsoleLevel(env: NodeJS.ProcessEnv = process.env): LogLevelName | 'silent' {
    const explicit = normalizeLevel(env.LOG_LEVEL);
    if (explicit) return explicit;
    switch (env.NODE_ENV) {
        case 'production':
            return 'Info';
        case 'test':
            return 'Error';
        default:
            return 'Debug';
    }
}

/**
 * ANSI 색상 사용 여부. 비-TTY(파이프/Docker/PM2)에서는 이스케이프 코드가
 * 로그를 오염시키므로 끈다. NO_COLOR 표준을 존중하고 FORCE_COLOR 로 강제할 수 있다.
 */
export function isColorEnabled(
    env: NodeJS.ProcessEnv = process.env,
    isTTY: boolean = Boolean(process.stdout && process.stdout.isTTY),
): boolean {
    if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
    if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0')
        return true;
    return isTTY;
}

// ── 민감정보 마스킹 + 안전 직렬화 ────────────────────────────────
const REDACTED = '[REDACTED]';

// 키 일부에 등장해도 마스킹할 토큰(오탐 위험 낮은 것만).
// 'token' → csrfToken/accessToken 등 포착(대신 tokenCount 도 마스킹되지만 안전 우선).
const SUBSTRING_TOKENS = [
    'password',
    'passwd',
    'secret',
    'token',
    'authorization',
    'apikey',
    'cookie',
    'bearer',
    'privatekey',
    'clientsecret',
    'accesstoken',
    'refreshtoken',
    'connectionstring',
    'databaseurl',
    'sessionid',
    'creditcard',
    'cardnumber',
];
// 너무 짧아 부분일치 시 오탐(className 의 'ssn' 등)이 큰 토큰은 전체-단어로만 매칭.
const WORD_TOKENS = new Set(['pwd', 'ssn', 'jwt']);

/** env 기반 민감키 매처 생성. LOG_REDACT=false 면 null(마스킹 비활성). */
function buildSensitiveMatcher(
    env: NodeJS.ProcessEnv = process.env,
): ((key: string) => boolean) | null {
    if (env.LOG_REDACT === 'false' || env.LOG_REDACT === '0') return null;
    const extra = new Set(
        (env.LOG_REDACT_KEYS || '')
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
    );
    return (key: string): boolean => {
        const lower = key.toLowerCase();
        if (extra.has(lower)) return true;
        const compact = lower.replace(/[^a-z0-9]/g, '');
        if (WORD_TOKENS.has(compact)) return true;
        for (const word of lower.split(/[^a-z0-9]+/)) {
            if (word && WORD_TOKENS.has(word)) return true;
        }
        for (const token of SUBSTRING_TOKENS) {
            if (compact.includes(token)) return true;
        }
        return false;
    };
}

interface SafeJsonOptions {
    /** 민감키 매처. 매칭되는 키의 값은 [REDACTED] 로 치환. */
    isSensitive?: ((key: string) => boolean) | null;
    /** 중첩 깊이 한계(초과 시 [Object]/[Array] 로 절단). 기본 8. */
    maxDepth?: number;
}

/**
 * 임의의 값을 JSON 안전한 구조로 변환한다. JSON.stringify 가 throw 할 수 있는
 * 모든 케이스를 방어한다:
 * - 순환 참조 → '[Circular]' (조상 경로만 추적 → 형제 공유참조 오탐 없음)
 * - BigInt → '<n>n', 함수 → '[Function name]', 심볼 → 문자열
 * - Error → { name, message, stack, ...열거 prop } (순환 보호 포함)
 * - Buffer → '[Buffer N bytes]', Date → ISO(잘못된 Date 는 '[Invalid Date]')
 * - Map → 객체, Set → 배열 (내용 보존 + 민감키 마스킹)
 * - throw 하는 getter → '[Getter threw: ...]'
 * - 깊이 초과 → '[Object]' / '[Array]'
 */
export function toSafeJson(value: unknown, opts: SafeJsonOptions = {}): unknown {
    const isSensitive = opts.isSensitive ?? null;
    const maxDepth = opts.maxDepth ?? 8;

    const walk = (val: unknown, depth: number, ancestors: object[]): unknown => {
        // 원시값
        if (typeof val === 'bigint') return `${val.toString()}n`;
        if (typeof val === 'function')
            return `[Function ${(val as { name?: string }).name || 'anonymous'}]`;
        if (typeof val === 'symbol') return val.toString();
        if (val === null || typeof val !== 'object') return val; // string/number/boolean/undefined

        // 리프 요약(재귀 불필요 — 순환/깊이 무관)
        if (Buffer.isBuffer(val)) return `[Buffer ${val.length} bytes]`;
        if (val instanceof Date)
            return Number.isNaN(val.getTime()) ? '[Invalid Date]' : val.toISOString();

        // 모든 객체에 대한 순환/깊이 가드 (Error/Map/Set/Array/object 공통)
        if (ancestors.includes(val as object)) return '[Circular]';
        if (depth >= maxDepth) return Array.isArray(val) ? '[Array]' : '[Object]';

        // 배열을 펼치지 않도록 spread 로 추가(concat 은 배열 인자를 펼쳐 오탐을 유발).
        const nextAncestors = [...ancestors, val as object];

        if (val instanceof Error) {
            const result: Record<string, unknown> = {
                name: val.name,
                message: val.message,
                stack: val.stack,
            };
            const errorProps = val as unknown as Record<string, unknown>;
            for (const key of Object.keys(val)) {
                if (key in result) continue;
                if (isSensitive && isSensitive(key)) {
                    result[key] = REDACTED;
                    continue;
                }
                result[key] = walk(errorProps[key], depth + 1, nextAncestors);
            }
            return result;
        }

        if (val instanceof Map) {
            const obj: Record<string, unknown> = {};
            for (const [k, v] of val) {
                const keyStr = typeof k === 'string' ? k : String(k);
                if (isSensitive && isSensitive(keyStr)) {
                    obj[keyStr] = REDACTED;
                    continue;
                }
                obj[keyStr] = walk(v, depth + 1, nextAncestors);
            }
            return obj;
        }

        if (val instanceof Set) {
            return Array.from(val, (item) => walk(item, depth + 1, nextAncestors));
        }

        if (Array.isArray(val)) {
            return val.map((item) => walk(item, depth + 1, nextAncestors));
        }

        const out: Record<string, unknown> = {};
        for (const key of Object.keys(val as Record<string, unknown>)) {
            if (isSensitive && isSensitive(key)) {
                out[key] = REDACTED;
                continue;
            }
            let child: unknown;
            try {
                child = (val as Record<string, unknown>)[key]; // getter 가 throw 할 수 있음
            } catch (err) {
                out[key] = `[Getter threw: ${(err as Error)?.message ?? 'error'}]`;
                continue;
            }
            out[key] = walk(child, depth + 1, nextAncestors);
        }
        return out;
    };

    return walk(value, 0, []);
}

interface SafeStringifyOptions extends SafeJsonOptions {
    /** JSON.stringify 들여쓰기 폭. */
    space?: number;
    /** 민감키 매처를 만들 env. 기본 process.env. */
    env?: NodeJS.ProcessEnv;
}

/** toSafeJson 으로 정리한 뒤 직렬화. 어떤 입력에도 절대 throw 하지 않는다. */
export function safeStringify(value: unknown, opts: SafeStringifyOptions = {}): string {
    const isSensitive =
        opts.isSensitive !== undefined
            ? opts.isSensitive
            : buildSensitiveMatcher(opts.env ?? process.env);
    try {
        return (
            JSON.stringify(
                toSafeJson(value, { isSensitive, maxDepth: opts.maxDepth }),
                null,
                opts.space,
            ) ?? 'undefined'
        );
    } catch (err) {
        return `[Unserializable: ${(err as Error)?.message ?? 'error'}]`;
    }
}

// ── 포맷 ─────────────────────────────────────────────────────────
const COLOR_ENABLED = isColorEnabled();

function getLogFormat(): winston.Logform.Format {
    const isProduction = process.env.NODE_ENV === 'production';

    return format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        format.errors({ stack: true }),
        format.printf((info: TransformableInfo) => {
            const { timestamp, level, message, stack, ...meta } = info;
            const levelLabel = String(level).toUpperCase();

            if (isProduction) {
                // 프로덕션: JSON 한 줄 (안전 직렬화 + 민감정보 마스킹)
                return safeStringify({
                    timestamp,
                    level: levelLabel,
                    message,
                    ...(stack ? { stack } : {}),
                    ...meta,
                });
            }

            // 개발: 사람이 읽기 좋은 라인 (TTY 일 때만 색상)
            const color = COLOR_ENABLED ? customColors[level as string] || '' : '';
            const reset = COLOR_ENABLED ? RESET_COLOR : '';
            const emoji = customEmojis[level as string] || '';

            let logLine = `${timestamp} ${emoji} ${color}[${levelLabel}]${reset}: ${color}${message}${reset}`;
            if (stack) {
                logLine += `\n${color}${stack}${reset}`;
            }
            if (Object.keys(meta).length > 0) {
                logLine += `\n${color}${safeStringify(meta, { space: 2 })}${reset}`;
            }
            return logLine;
        }),
    );
}

// ── 트랜스포트 / 로거 인스턴스 ────────────────────────────────────
const LOG_DIR = path.resolve(process.env.LOG_DIR || './logs');
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '20m';
const LOG_MAX_FILES = process.env.LOG_MAX_FILES || '30d';
const FILE_LEVEL = ((): LogLevelName => {
    const lvl = normalizeLevel(process.env.LOG_FILE_LEVEL);
    return lvl && lvl !== 'silent' ? lvl : 'Info';
})();

/** 로그 디렉토리 생성. 실패해도 throw 하지 않고 파일 로깅만 비활성화한다. */
function ensureLogDirectory(dir: string): boolean {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return true;
    } catch (err) {
        // 부트스트랩 단계라 winston 자신을 쓸 수 없으므로 console 로 한 번만 알린다.

        console.warn(
            `[winston] Failed to create log directory '${dir}': ${(err as Error)?.message}. File logging disabled.`,
        );
        return false;
    }
}

let fileLoggingEnabled = ensureLogDirectory(LOG_DIR);
const consoleLevel = resolveConsoleLevel();
const consoleSilent = consoleLevel === 'silent';

const activeTransports: winston.transport[] = [
    new transports.Console({
        level: consoleSilent ? 'Error' : consoleLevel,
        silent: consoleSilent,
        handleExceptions: true,
        handleRejections: true,
    }),
];

if (fileLoggingEnabled) {
    // ensureLogDirectory 이후의 TOCTOU(디렉토리 삭제/권한 변경) 도 graceful 하게 강등한다.
    try {
        activeTransports.push(
            new DailyRotateFile({
                level: FILE_LEVEL,
                dirname: LOG_DIR,
                filename: '%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                zippedArchive: true,
                maxSize: LOG_MAX_SIZE,
                maxFiles: LOG_MAX_FILES,
                handleExceptions: true,
                handleRejections: true,
            }),
            new DailyRotateFile({
                level: 'Error',
                dirname: LOG_DIR,
                filename: 'error-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                zippedArchive: true,
                maxSize: LOG_MAX_SIZE,
                maxFiles: LOG_MAX_FILES,
                handleExceptions: true,
                handleRejections: true,
            }),
        );
    } catch (err) {
        console.warn(
            `[winston] Failed to initialize file transports: ${(err as Error)?.message}. Console-only logging.`,
        );
        fileLoggingEnabled = false;
    }
}

const loggerOptions: winston.LoggerOptions = {
    levels: customLevels as unknown as winston.config.AbstractConfigSetLevels,
    // 가장 자세한 레벨로 두고 실제 필터링은 각 transport 의 level 에 위임한다.
    level: 'Silly',
    format: getLogFormat(),
    transports: activeTransports,
    exitOnError: false,
};

if (fileLoggingEnabled) {
    loggerOptions.exceptionHandlers = [
        new transports.File({ filename: path.join(LOG_DIR, 'exceptions.log') }),
    ];
    loggerOptions.rejectionHandlers = [
        new transports.File({ filename: path.join(LOG_DIR, 'rejections.log') }),
    ];
} else if (consoleSilent) {
    // 콘솔도 silent, 파일도 불가한 경우에도 크래시 로그가 완전히 사라지지 않도록
    // stderr 로 강제 출력하는 예외 핸들러를 둔다.
    const stderrHandler = new transports.Console({
        level: 'Error',
        stderrLevels: ['error', 'Error'],
    });
    loggerOptions.exceptionHandlers = [stderrHandler];
    loggerOptions.rejectionHandlers = [stderrHandler];
}

// 로거 생성
export const log: CustomLevels = createLogger(loggerOptions) as CustomLevels;

// 트랜스포트 쓰기 실패(디스크 풀 등)로 인한 unhandled 'error' 이벤트가
// 프로세스를 죽이지 않도록 방어한다.
log.on('error', (err: Error) => {
    process.stderr.write(`[winston] transport error: ${err?.message ?? String(err)}\n`);
});

// ── 로거 유틸리티 함수들 ─────────────────────────────────────────
export const logger = {
    /** 성능 측정을 위한 타이머 시작 */
    startTimer: (label: string) => {
        const start = process.hrtime.bigint();
        return {
            end: (): number => {
                const end = process.hrtime.bigint();
                const duration = Number(end - start) / 1_000_000; // ms 로 변환
                log.Debug(`${label} completed in ${duration.toFixed(2)}ms`);
                return duration;
            },
        };
    },

    /** HTTP 요청 로깅 */
    httpRequest: (method: string, url: string, statusCode: number, duration: number): void => {
        const level: LogLevelName =
            statusCode >= 400 ? 'Error' : statusCode >= 300 ? 'Warn' : 'Info';
        log[level](`${method} ${url} ${statusCode} - ${duration}ms`);
    },

    /** 데이터베이스 쿼리 로깅 */
    dbQuery: (query: string, duration?: number, params?: unknown): void => {
        const message = duration ? `${query} (${duration}ms)` : query;
        log.SQL(message, params ? { params } : undefined);
    },
};

export default log;
