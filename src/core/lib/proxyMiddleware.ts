import type { Request, Response, RequestHandler, NextFunction } from 'express';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import * as querystring from 'querystring';

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
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
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
  const extraHop = typeof connection === 'string'
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

  const prevXff = req.headers['x-forwarded-for'];
  const clientIp = req.ip || req.socket?.remoteAddress || '';
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
    res.setHeader(name, value as string | string[]);
  }
}

export function createProxyMiddleware(options: ProxyOptions): RequestHandler {
  const target = new URL(options.target);
  const isHttps = target.protocol === 'https:';
  const defaultPort = isHttps ? 443 : 80;

  return function proxyMiddleware(req: Request, res: Response, _next: NextFunction): void {
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
      res.statusCode = proxyRes.statusCode || 502;
      copyResponseHeaders(proxyRes, res);
      proxyRes.pipe(res);
    };

    const proxyReq = isHttps
      ? https.request(requestOptions, onResponse)
      : http.request(requestOptions, onResponse);

    // body-parser(전역 미들웨어)가 이미 본문 스트림을 소비했으면 req.body 를 재직렬화해
    // 전달한다(fixRequestBody). 파싱되지 않은 raw 요청은 스트림을 그대로 파이프한다.
    const parsedBody = req.body;
    const hasParsedBody =
      parsedBody !== undefined &&
      parsedBody !== null &&
      typeof parsedBody === 'object' &&
      Object.keys(parsedBody).length > 0;

    if (hasParsedBody) {
      const contentType = String(req.headers['content-type'] || '');
      const bodyData = contentType.includes('application/x-www-form-urlencoded')
        ? querystring.stringify(parsedBody as Record<string, any>)
        : JSON.stringify(parsedBody);
      const buffer = Buffer.from(bodyData, 'utf-8');
      proxyReq.setHeader('content-length', Buffer.byteLength(buffer));
      proxyReq.write(buffer);
      proxyReq.end();
    } else {
      req.pipe(proxyReq);
    }
  };
}
