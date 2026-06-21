import type { Request, Response, RequestHandler, NextFunction } from 'express';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import qs from 'qs';
import { log } from '@ext/winston';
import { ERROR_CODES, getHttpStatusForErrorCode, getStatusText } from '@lib/http/errors/errorCodes';

export interface ProxyOptions {
    /** 업스트림 베이스 URL. 필수. 예: 'http://localhost:3001', 'https://api.example.com' */
    target: string;
    /** Host 헤더를 target 호스트로 교체. 기본 false. */
    changeOrigin?: boolean;
    /** 포워딩 전 경로 재작성. 객체(정규식→치환) 또는 함수. */
    pathRewrite?: Record<string, string> | ((path: string, req: Request) => string);
    /** 아웃바운드 요청에 set/override 할 헤더. */
    headers?: Record<string, string>;
    /** https 타깃 TLS 인증서 검증 여부. 기본 true. */
    secure?: boolean;
    /** 업스트림 소켓 타임아웃(ms). */
    timeout?: number;
    onProxyReq?: (proxyReq: http.ClientRequest, req: Request, res: Response) => void;
    onProxyRes?: (proxyRes: http.IncomingMessage, req: Request, res: Response) => void;
    onError?: (err: Error, req: Request, res: Response) => void;
}

// RFC 2616 13.5.1 hop-by-hop 헤더 (end-to-end 가 아닌, 단일 transport-level 헤더)
const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

function applyPathRewrite(
    path: string,
    rewrite: ProxyOptions['pathRewrite'],
    req: Request,
): string {
    if (!rewrite) return path;
    if (typeof rewrite === 'function') return rewrite(path, req);
    let result = path;
    for (const [pattern, replacement] of Object.entries(rewrite)) {
        result = result.replace(new RegExp(pattern), replacement);
    }
    return result;
}

function buildOutboundHeaders(
    req: Request,
    target: URL,
    options: ProxyOptions,
): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = { ...req.headers };

    // hop-by-hop 제거 (connection 헤더 값에 나열된 토큰도 함께 제거)
    const connection = req.headers['connection'];
    const extraHop =
        typeof connection === 'string'
            ? connection.split(',').map((s) => s.trim().toLowerCase())
            : [];
    for (const name of Object.keys(headers)) {
        const lower = name.toLowerCase();
        if (HOP_BY_HOP.has(lower) || extraHop.includes(lower)) {
            delete headers[name];
        }
    }

    if (options.changeOrigin) {
        headers['host'] = target.host;
    }

    // X-Forwarded-*: 마지막 홉은 위조 불가한 실제 TCP peer(req.socket.remoteAddress)를 사용한다.
    // (clientIpMiddleware 가 만든 req.ip 는 클라이언트 제어 헤더에서 파생되어 스푸핑 가능하므로 신뢰하지 않는다.)
    const prevXff = req.headers['x-forwarded-for'];
    const clientIp = req.socket?.remoteAddress || '';
    headers['x-forwarded-for'] = prevXff ? `${prevXff}, ${clientIp}` : clientIp;
    headers['x-forwarded-proto'] = req.protocol;
    if (req.headers['host']) headers['x-forwarded-host'] = req.headers['host'];

    if (options.headers) {
        for (const [k, v] of Object.entries(options.headers)) {
            headers[k] = v;
        }
    }

    return headers;
}

function copyResponseHeaders(proxyRes: http.IncomingMessage, res: Response): void {
    for (const [name, value] of Object.entries(proxyRes.headers)) {
        if (value === undefined) continue;
        if (HOP_BY_HOP.has(name.toLowerCase())) continue;
        // 다중 set-cookie 등 string[] 값을 그대로 보존한다.
        res.setHeader(name, value as string | string[]);
    }
}

/** 응답이 더 이상 쓰기 불가한 상태(이미 시작/종료/파괴)인지. */
function isResponseUnwritable(res: Response): boolean {
    return res.headersSent || res.writableEnded || res.destroyed;
}

/**
 * 업스트림 실패를 프레임워크 컨벤션(winston 로깅 + JSON:API 502/504)으로 응답한다.
 * 응답이 이미 시작/종료된 경우엔 본문을 더 쓸 수 없으므로 소켓을 끊는다.
 */
function sendProxyError(err: NodeJS.ErrnoException, req: Request, res: Response): void {
    const isTimeout =
        (err as { __timeout?: boolean }).__timeout === true || err.code === 'ETIMEDOUT';
    const code = isTimeout ? ERROR_CODES.GATEWAY_TIMEOUT : ERROR_CODES.BAD_GATEWAY;
    const status = getHttpStatusForErrorCode(code);

    log.Error(`Proxy upstream failure: ${err.code || err.message}`, {
        code,
        status,
        path: req.originalUrl,
        error: err.message,
    });

    if (isResponseUnwritable(res)) {
        if (!res.destroyed) res.destroy();
        return;
    }

    const isDev = process.env.NODE_ENV !== 'production';
    res.status(status).json({
        errors: [
            {
                status: String(status),
                code,
                title: getStatusText(status) ?? 'Bad Gateway',
                detail: isDev
                    ? `Upstream request failed: ${err.code || err.message}`
                    : 'Upstream request failed',
            },
        ],
    });
}

/**
 * 요청 본문을 업스트림으로 전달한다.
 * - 전역 body-parser 가 스트림을 소비한 경우(`req._body === true`): `req.body`를 content-type 에 맞춰
 *   재직렬화하고 Content-Length 를 재계산한다. 빈 객체 `{}`·빈 배열 `[]`·중첩 폼도 정확히 보존된다.
 * - 파싱되지 않은 raw 요청: 스트림을 그대로 파이프한다(원본 Content-Length 유지).
 */
function forwardRequestBody(req: Request, proxyReq: http.ClientRequest): void {
    const consumed = (req as { _body?: boolean })._body === true;
    if (!consumed) {
        req.pipe(proxyReq);
        return;
    }

    const body = req.body;
    const contentType = String(req.headers['content-type'] || '');
    let bodyData: string;
    if (typeof body === 'string') {
        bodyData = body;
    } else if (Buffer.isBuffer(body)) {
        bodyData = body.toString('utf-8');
    } else if (body && contentType.includes('application/x-www-form-urlencoded')) {
        // body-parser 의 extended(qs) 파싱과 대칭이 되도록 qs 로 직렬화(중첩 객체/배열 보존).
        bodyData = qs.stringify(body);
    } else {
        // application/json 및 application/vnd.api+json 등 ({} -> '{}', [] -> '[]')
        bodyData = JSON.stringify(body ?? {});
    }

    const buffer = Buffer.from(bodyData, 'utf-8');
    proxyReq.setHeader('content-length', Buffer.byteLength(buffer));
    if (buffer.length) proxyReq.write(buffer);
    proxyReq.end();
}

export function createProxyMiddleware(options: ProxyOptions): RequestHandler {
    let target: URL;
    try {
        target = new URL(options.target);
    } catch {
        // 잘못된 target 은 라우트 등록(부트스트랩) 시점에 명확한 메시지로 fail-fast 한다.
        throw new Error(`[proxyMiddleware] Invalid target URL: ${JSON.stringify(options.target)}`);
    }
    const isHttps = target.protocol === 'https:';
    const defaultPort = isHttps ? 443 : 80;

    return function proxyMiddleware(req: Request, res: Response, _next: NextFunction): void {
        let settled = false;
        let proxyReq: http.ClientRequest | undefined;

        // 업스트림 실패/타임아웃/셋업 throw 를 단일 경로로 처리한다(한 번만 settle).
        const fail = (err: NodeJS.ErrnoException): void => {
            if (settled) return;
            settled = true;
            if (proxyReq && !proxyReq.destroyed) proxyReq.destroy();
            if (options.onError) {
                // 응답이 이미 시작된 뒤면 onError 가 res 에 쓰면 ERR_HTTP_HEADERS_SENT 가 나므로 소켓만 정리.
                if (isResponseUnwritable(res)) {
                    if (!res.destroyed) res.destroy();
                    return;
                }
                options.onError(err, req, res);
                return;
            }
            sendProxyError(err, req, res);
        };

        // 클라이언트가 (요청 업로드 중이든 응답 스트리밍 중이든) 연결을 끊으면 업스트림을 정리한다.
        // 'aborted' 는 Node 16+ deprecated 이며 응답 스트리밍 중 disconnect 를 놓치므로 'close' 를 사용.
        res.on('close', () => {
            if (res.writableEnded) return; // 정상 완료
            settled = true; // 이후 업스트림 에러로 인한 오해성 502 로그/응답 방지
            if (proxyReq && !proxyReq.destroyed) proxyReq.destroy();
        });

        try {
            const outboundPath = applyPathRewrite(req.url, options.pathRewrite, req);

            const requestOptions: https.RequestOptions = {
                protocol: target.protocol,
                hostname: target.hostname,
                port: target.port || defaultPort,
                method: req.method,
                path: outboundPath,
                headers: buildOutboundHeaders(req, target, options),
                timeout: options.timeout,
            };
            if (isHttps) {
                requestOptions.rejectUnauthorized = options.secure !== false;
            }

            const onResponse = (proxyRes: http.IncomingMessage): void => {
                if (options.onProxyRes) options.onProxyRes(proxyRes, req, res);
                // 스트리밍 중 업스트림 응답이 끊기면 로깅 후, 헤더 전이면 502, 시작됐으면 소켓 정리.
                proxyRes.on('error', (e: NodeJS.ErrnoException) => {
                    if (settled) return;
                    log.Error(`Proxy upstream response stream error: ${e.code || e.message}`, {
                        path: req.originalUrl,
                        error: e.message,
                    });
                    fail(e);
                });
                res.statusCode = proxyRes.statusCode || 502;
                copyResponseHeaders(proxyRes, res);
                proxyRes.pipe(res);
            };

            proxyReq = isHttps
                ? https.request(requestOptions, onResponse)
                : http.request(requestOptions, onResponse);

            proxyReq.on('error', fail);
            proxyReq.on('timeout', () => {
                const err: NodeJS.ErrnoException = new Error('Proxy request timed out');
                err.code = 'ETIMEDOUT';
                (err as { __timeout?: boolean }).__timeout = true;
                fail(err);
            });

            // onProxyReq 는 본문 전송 이전에 호출해야 헤더 변경이 반영된다.
            if (options.onProxyReq) options.onProxyReq(proxyReq, req, res);

            forwardRequestBody(req, proxyReq);
        } catch (err) {
            // 셋업 단계(경로/헤더 검증, request 생성)의 동기 throw 도 일관된 에러 경로로 위임한다.
            fail(err as NodeJS.ErrnoException);
        }
    };
}
