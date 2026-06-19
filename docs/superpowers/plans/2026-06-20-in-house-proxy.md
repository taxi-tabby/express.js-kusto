# 자체 HTTP 리버스 프록시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `http-proxy-middleware` 의존성을 제거하고, Node 표준 `http`/`https` 기반 자체 리버스 프록시 미들웨어로 `MIDDLE_PROXY_ROUTE`(_SLUG)를 대체한다.

**Architecture:** `src/core/lib/proxyMiddleware.ts`에 `createProxyMiddleware(options: ProxyOptions): RequestHandler`를 구현한다. 들어온 요청을 `http(s).request`로 업스트림에 포워딩하고, 요청/응답 본문을 스트리밍 파이프한다. body-parser가 이미 소비한 본문은 `req.body`를 재직렬화해 전달한다(fixRequestBody). 실패 시 프레임워크 컨벤션(winston 로깅 + JSON:API 502/504)으로 응답한다.

**Tech Stack:** TypeScript(CommonJS), Express 4, Node `http`/`https`/`url`/`querystring`, winston(`@ext/winston`), Jest + ts-jest + supertest.

## Global Constraints

- 런타임 신규 외부 의존성 추가 금지 — Node 빌트인만 사용. (목표 자체가 의존성 제거)
- Node `>=18`, CommonJS 유지 (ESM 금지).
- 로깅은 `import { log } from '@ext/winston'` 사용 (`log.Error`, `log.Route` 등).
- 에러 코드/상태는 `import { ERROR_CODES, getHttpStatusForErrorCode } from './errorCodes'` 사용.
- 경로 별칭: 테스트는 `@lib/*`(= `src/core/lib/*`) 사용 (기존 테스트와 동일, jest moduleNameMapper로 해석됨).
- 커밋 메시지는 한국어, 트레일러 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 포함.
- 기존 전체 테스트 스위트(현재 276 passed / 49 suites) 무회귀.
- 현재 브랜치 `ver/0.1.47`에서 작업 (main 아님).

## File Structure

- **Create** `src/core/lib/proxyMiddleware.ts` — `ProxyOptions` 인터페이스 + `createProxyMiddleware` 팩토리. 단일 책임: HTTP 리버스 프록시 미들웨어 생성.
- **Create** `tests/integration/proxy/proxy.integration.test.ts` — 실제 업스트림 `http.createServer` + supertest 통합 테스트.
- **Modify** `src/core/lib/errorCodes.ts` — `ERROR_STATUS_MAP`에 게이트웨이 매핑 추가.
- **Modify** `src/core/lib/expressRouter.ts` — import/타입을 `proxyMiddleware`로 교체.
- **Modify** `package.json` — `http-proxy-middleware` 의존성 제거.
- **Modify** `docs/02-routing-system.md` — 프록시 설명 갱신.

---

### Task 1: errorCodes 게이트웨이 상태 매핑 보강

**Files:**
- Modify: `src/core/lib/errorCodes.ts` (`ERROR_STATUS_MAP`, 약 271-277행)
- Test: `tests/unit/error-codes/gateway-status.test.ts` (Create)

**Interfaces:**
- Consumes: `ERROR_CODES`, `getHttpStatusForErrorCode` (기존 export)
- Produces: `getHttpStatusForErrorCode('BAD_GATEWAY') === 502`, `'GATEWAY_TIMEOUT' === 504`, `'SERVICE_UNAVAILABLE' === 503`, `'CONNECTION_TIMEOUT' === 504`

- [ ] **Step 1: 실패 테스트 작성**

Create `tests/unit/error-codes/gateway-status.test.ts`:

```ts
import { ERROR_CODES, getHttpStatusForErrorCode } from '@lib/errorCodes';

describe('getHttpStatusForErrorCode — 게이트웨이 코드', () => {
  it('BAD_GATEWAY → 502', () => {
    expect(getHttpStatusForErrorCode(ERROR_CODES.BAD_GATEWAY)).toBe(502);
  });
  it('GATEWAY_TIMEOUT → 504', () => {
    expect(getHttpStatusForErrorCode(ERROR_CODES.GATEWAY_TIMEOUT)).toBe(504);
  });
  it('SERVICE_UNAVAILABLE → 503', () => {
    expect(getHttpStatusForErrorCode(ERROR_CODES.SERVICE_UNAVAILABLE)).toBe(503);
  });
  it('CONNECTION_TIMEOUT → 504', () => {
    expect(getHttpStatusForErrorCode(ERROR_CODES.CONNECTION_TIMEOUT)).toBe(504);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/unit/error-codes/gateway-status.test.ts`
Expected: FAIL — 502 대신 500 반환(매핑 누락).

- [ ] **Step 3: 매핑 추가**

`src/core/lib/errorCodes.ts`의 `ERROR_STATUS_MAP` 객체에서 `OPERATION_FAILED: 500` 항목 바로 뒤(닫는 `}` 직전)에 추가:

```ts
  [ERROR_CODES.OPERATION_FAILED]: 500,

  // 502 / 503 / 504 게이트웨이 (자체 프록시)
  [ERROR_CODES.BAD_GATEWAY]: 502,
  [ERROR_CODES.SERVICE_UNAVAILABLE]: 503,
  [ERROR_CODES.GATEWAY_TIMEOUT]: 504,
  [ERROR_CODES.CONNECTION_TIMEOUT]: 504
```

(기존 `OPERATION_FAILED: 500` 줄의 끝 콤마 주의 — 위처럼 콤마를 붙이고 새 항목들을 잇는다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/unit/error-codes/gateway-status.test.ts`
Expected: PASS (4 passed)

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/errorCodes.ts tests/unit/error-codes/gateway-status.test.ts
git commit -m "feat(errors): ERROR_STATUS_MAP에 502/503/504 게이트웨이 매핑 추가

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 프록시 모듈 + GET 패스스루

**Files:**
- Create: `src/core/lib/proxyMiddleware.ts`
- Test: `tests/integration/proxy/proxy.integration.test.ts` (Create)

**Interfaces:**
- Produces:
  - `export interface ProxyOptions { target: string; changeOrigin?: boolean; pathRewrite?: Record<string,string> | ((path: string, req: Request) => string); headers?: Record<string,string>; secure?: boolean; timeout?: number; onProxyReq?: (proxyReq, req, res) => void; onProxyRes?: (proxyRes, req, res) => void; onError?: (err, req, res) => void; }`
  - `export function createProxyMiddleware(options: ProxyOptions): RequestHandler`

- [ ] **Step 1: 실패 테스트 작성 (테스트 헬퍼 포함)**

Create `tests/integration/proxy/proxy.integration.test.ts`:

```ts
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import { createProxyMiddleware } from '@lib/proxyMiddleware';

interface Upstream { server: http.Server; url: string; }

function startUpstream(handler: http.RequestListener): Promise<Upstream> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function closeUpstream(u: Upstream): Promise<void> {
  return new Promise((resolve) => u.server.close(() => resolve()));
}

describe('createProxyMiddleware — GET 패스스루', () => {
  let upstream: Upstream;
  afterEach(async () => { if (upstream) await closeUpstream(upstream); });

  it('업스트림의 상태/헤더/본문을 그대로 전달한다', async () => {
    upstream = await startUpstream((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-upstream', 'yes');
      res.statusCode = 201;
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });

    const app = express();
    app.use('/', createProxyMiddleware({ target: upstream.url }));

    const resp = await request(app).get('/hello?q=1');
    expect(resp.status).toBe(201);
    expect(resp.headers['x-upstream']).toBe('yes');
    expect(resp.body).toEqual({ ok: true, path: '/hello?q=1' });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/integration/proxy/proxy.integration.test.ts`
Expected: FAIL — `Cannot find module '@lib/proxyMiddleware'`.

- [ ] **Step 3: 모듈 구현 (GET 패스스루)**

Create `src/core/lib/proxyMiddleware.ts`:

```ts
import type { Request, Response, RequestHandler, NextFunction } from 'express';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface ProxyOptions {
  /** 업스트림 베이스 URL. 필수. */
  target: string;
  /** Host 헤더를 target 호스트로 교체. 기본 false. */
  changeOrigin?: boolean;
  /** 포워딩 전 경로 재작성. 객체(정규식→치환) 또는 함수. */
  pathRewrite?: Record<string, string> | ((path: string, req: Request) => string);
  /** 아웃바운드에 set/override 할 헤더. */
  headers?: Record<string, string>;
  /** https 타깃 TLS 인증서 검증. 기본 true. */
  secure?: boolean;
  /** 업스트림 소켓 타임아웃(ms). */
  timeout?: number;
  onProxyReq?: (proxyReq: http.ClientRequest, req: Request, res: Response) => void;
  onProxyRes?: (proxyRes: http.IncomingMessage, req: Request, res: Response) => void;
  onError?: (err: Error, req: Request, res: Response) => void;
}

// RFC 2616 13.5.1 hop-by-hop 헤더
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

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
  const transport = isHttps ? https : http;
  const defaultPort = isHttps ? 443 : 80;

  return function proxyMiddleware(req: Request, res: Response, _next: NextFunction): void {
    const requestOptions: https.RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || defaultPort,
      method: req.method,
      path: req.url,
      headers: { ...req.headers },
      timeout: options.timeout,
    };
    if (isHttps) {
      requestOptions.rejectUnauthorized = options.secure !== false;
    }

    const proxyReq = transport.request(requestOptions, (proxyRes) => {
      if (options.onProxyRes) options.onProxyRes(proxyRes, req, res);
      res.statusCode = proxyRes.statusCode || 502;
      copyResponseHeaders(proxyRes, res);
      proxyRes.pipe(res);
    });

    req.pipe(proxyReq);
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/integration/proxy/proxy.integration.test.ts`
Expected: PASS (1 passed)

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/proxyMiddleware.ts tests/integration/proxy/proxy.integration.test.ts
git commit -m "feat(proxy): 자체 리버스 프록시 모듈 + GET 패스스루

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 아웃바운드 헤더 처리 (hop-by-hop 제거, changeOrigin, X-Forwarded-*, headers 덮어쓰기)

**Files:**
- Modify: `src/core/lib/proxyMiddleware.ts`
- Test: `tests/integration/proxy/proxy.integration.test.ts` (describe 블록 추가)

**Interfaces:**
- Consumes: `ProxyOptions`, `createProxyMiddleware` (Task 2)
- Produces: 내부 `buildOutboundHeaders(req, target, options)` (모듈 내부, export 안 함)

- [ ] **Step 1: 실패 테스트 작성**

`proxy.integration.test.ts` 파일 끝에 describe 추가:

```ts
describe('createProxyMiddleware — 아웃바운드 헤더', () => {
  let upstream: Upstream;
  afterEach(async () => { if (upstream) await closeUpstream(upstream); });

  function echoHeadersUpstream(): Promise<Upstream> {
    return startUpstream((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ headers: req.headers }));
    });
  }

  it('changeOrigin=true 이면 Host를 타깃 호스트로 교체한다', async () => {
    upstream = await echoHeadersUpstream();
    const targetHost = new URL(upstream.url).host; // 127.0.0.1:<port>
    const app = express();
    app.use('/', createProxyMiddleware({ target: upstream.url, changeOrigin: true }));

    const resp = await request(app).get('/');
    expect(resp.body.headers.host).toBe(targetHost);
  });

  it('X-Forwarded-Proto/Host 헤더를 추가한다', async () => {
    upstream = await echoHeadersUpstream();
    const app = express();
    app.use('/', createProxyMiddleware({ target: upstream.url }));

    const resp = await request(app).get('/');
    expect(resp.body.headers['x-forwarded-proto']).toBe('http');
    expect(resp.body.headers['x-forwarded-host']).toBeDefined();
    expect(resp.body.headers['x-forwarded-for']).toBeDefined();
  });

  it('options.headers 로 헤더를 덮어쓴다', async () => {
    upstream = await echoHeadersUpstream();
    const app = express();
    app.use('/', createProxyMiddleware({
      target: upstream.url,
      headers: { 'x-custom': 'injected' },
    }));

    const resp = await request(app).get('/');
    expect(resp.body.headers['x-custom']).toBe('injected');
  });

  it('hop-by-hop 헤더(connection)는 업스트림으로 전달하지 않는다', async () => {
    upstream = await echoHeadersUpstream();
    const app = express();
    app.use('/', createProxyMiddleware({ target: upstream.url }));

    const resp = await request(app).get('/').set('Connection', 'keep-alive');
    expect(resp.body.headers.connection).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/integration/proxy/proxy.integration.test.ts -t "아웃바운드 헤더"`
Expected: FAIL — changeOrigin/X-Forwarded/headers 미구현.

- [ ] **Step 3: buildOutboundHeaders 구현 후 연결**

`proxyMiddleware.ts`에서 `copyResponseHeaders` 함수 위에 추가:

```ts
function buildOutboundHeaders(
  req: Request,
  target: URL,
  options: ProxyOptions,
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers };

  // hop-by-hop 제거 (connection 값에 나열된 토큰 포함)
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
```

이어서 `proxyMiddleware` 내부 `requestOptions.headers`를 교체:

```ts
      headers: buildOutboundHeaders(req, target, options),
```

(기존 `headers: { ...req.headers },` 줄을 위 줄로 대체.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/integration/proxy/proxy.integration.test.ts -t "아웃바운드 헤더"`
Expected: PASS (4 passed)

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/proxyMiddleware.ts tests/integration/proxy/proxy.integration.test.ts
git commit -m "feat(proxy): hop-by-hop 제거 + changeOrigin/X-Forwarded-*/headers 처리

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: pathRewrite (객체 + 함수)

**Files:**
- Modify: `src/core/lib/proxyMiddleware.ts`
- Test: `tests/integration/proxy/proxy.integration.test.ts` (describe 추가)

**Interfaces:**
- Produces: 내부 `applyPathRewrite(path, rewrite, req): string`

- [ ] **Step 1: 실패 테스트 작성**

파일 끝에 추가:

```ts
describe('createProxyMiddleware — pathRewrite', () => {
  let upstream: Upstream;
  afterEach(async () => { if (upstream) await closeUpstream(upstream); });

  function echoUrlUpstream(): Promise<Upstream> {
    return startUpstream((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ url: req.url }));
    });
  }

  it('객체형: { "^/api": "" } 로 접두사를 제거한다', async () => {
    upstream = await echoUrlUpstream();
    const app = express();
    app.use('/', createProxyMiddleware({
      target: upstream.url,
      pathRewrite: { '^/api': '' },
    }));

    const resp = await request(app).get('/api/users?x=1');
    expect(resp.body.url).toBe('/users?x=1');
  });

  it('함수형: (path) => path 변환을 적용한다', async () => {
    upstream = await echoUrlUpstream();
    const app = express();
    app.use('/', createProxyMiddleware({
      target: upstream.url,
      pathRewrite: (path) => '/prefixed' + path,
    }));

    const resp = await request(app).get('/thing');
    expect(resp.body.url).toBe('/prefixed/thing');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/integration/proxy/proxy.integration.test.ts -t "pathRewrite"`
Expected: FAIL — 경로가 그대로 전달됨.

- [ ] **Step 3: applyPathRewrite 구현 후 연결**

`proxyMiddleware.ts`에서 `buildOutboundHeaders` 위에 추가:

```ts
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
```

`proxyMiddleware` 내부에서 `requestOptions` 생성 직전에 경로를 계산하고, `path`를 교체:

```ts
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
```

(기존 `path: req.url,` → `path: outboundPath,`, 그리고 그 위에 `outboundPath` 선언 추가.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/integration/proxy/proxy.integration.test.ts -t "pathRewrite"`
Expected: PASS (2 passed)

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/proxyMiddleware.ts tests/integration/proxy/proxy.integration.test.ts
git commit -m "feat(proxy): pathRewrite 객체/함수 지원

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 요청 본문 전달 (body-parser 상호작용 / fixRequestBody)

**Files:**
- Modify: `src/core/lib/proxyMiddleware.ts`
- Test: `tests/integration/proxy/proxy.integration.test.ts` (describe 추가)

**Interfaces:**
- Consumes: 기존 `proxyMiddleware` 반환 함수
- Produces: `req.body`가 파싱돼 있으면 재직렬화 write, 아니면 stream pipe 하는 분기

- [ ] **Step 1: 실패 테스트 작성**

파일 끝에 추가:

```ts
describe('createProxyMiddleware — 요청 본문 (body-parser 이후)', () => {
  let upstream: Upstream;
  afterEach(async () => { if (upstream) await closeUpstream(upstream); });

  function echoBodyUpstream(): Promise<Upstream> {
    return startUpstream((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          received: Buffer.concat(chunks).toString('utf-8'),
          contentType: req.headers['content-type'],
        }));
      });
    });
  }

  it('JSON 본문이 body-parser 소비 후에도 업스트림에 그대로 도달한다', async () => {
    upstream = await echoBodyUpstream();
    const app = express();
    app.use(express.json());
    app.use('/', createProxyMiddleware({ target: upstream.url }));

    const payload = { name: 'kusto', n: 42 };
    const resp = await request(app).post('/x').send(payload);
    expect(JSON.parse(resp.body.received)).toEqual(payload);
  });

  it('urlencoded 본문도 그대로 도달한다', async () => {
    upstream = await echoBodyUpstream();
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use('/', createProxyMiddleware({ target: upstream.url }));

    const resp = await request(app).post('/x')
      .type('form').send({ a: '1', b: 'two' });
    expect(resp.body.received).toBe('a=1&b=two');
  });

  it('파싱되지 않은 raw 본문은 스트림으로 전달한다', async () => {
    upstream = await echoBodyUpstream();
    const app = express(); // body-parser 없음
    app.use('/', createProxyMiddleware({ target: upstream.url }));

    const resp = await request(app).post('/x')
      .set('content-type', 'text/plain').send('raw-payload');
    expect(resp.body.received).toBe('raw-payload');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/integration/proxy/proxy.integration.test.ts -t "요청 본문"`
Expected: FAIL — JSON/urlencoded 케이스에서 received가 빈 문자열(스트림 이미 소비됨).

- [ ] **Step 3: 본문 분기 구현**

`proxyMiddleware.ts` 상단 import에 `querystring` 추가:

```ts
import * as querystring from 'querystring';
```

`proxyMiddleware` 반환 함수의 마지막 줄 `req.pipe(proxyReq);` 를 다음으로 교체:

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/integration/proxy/proxy.integration.test.ts -t "요청 본문"`
Expected: PASS (3 passed)

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/proxyMiddleware.ts tests/integration/proxy/proxy.integration.test.ts
git commit -m "feat(proxy): body-parser 소비 본문 재직렬화 전달(fixRequestBody)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 에러 처리 + 라이프사이클 훅

**Files:**
- Modify: `src/core/lib/proxyMiddleware.ts`
- Test: `tests/integration/proxy/proxy.integration.test.ts` (describe 추가)

**Interfaces:**
- Consumes: `ERROR_CODES`, `getHttpStatusForErrorCode`, `log`
- Produces: 내부 `sendProxyError(err, req, res)`; `proxyReq` error/timeout 처리; `onError`/`onProxyReq`/`onProxyRes` 호출

- [ ] **Step 1: 실패 테스트 작성**

파일 끝에 추가:

```ts
describe('createProxyMiddleware — 에러/훅', () => {
  let upstream: Upstream;
  afterEach(async () => { if (upstream) await closeUpstream(upstream); upstream = undefined as any; });

  it('업스트림 다운(닫힌 포트) → 502 BAD_GATEWAY JSON', async () => {
    const tmp = await startUpstream((_req, res) => res.end());
    const deadUrl = tmp.url;
    await closeUpstream(tmp); // 포트 해제 → 연결거부

    const app = express();
    app.use('/', createProxyMiddleware({ target: deadUrl }));

    const resp = await request(app).get('/');
    expect(resp.status).toBe(502);
    expect(resp.body.errors[0].code).toBe('BAD_GATEWAY');
  });

  it('업스트림 지연 + timeout → 504 GATEWAY_TIMEOUT JSON', async () => {
    upstream = await startUpstream((_req, _res) => { /* 응답 안 함 */ });
    const app = express();
    app.use('/', createProxyMiddleware({ target: upstream.url, timeout: 80 }));

    const resp = await request(app).get('/');
    expect(resp.status).toBe(504);
    expect(resp.body.errors[0].code).toBe('GATEWAY_TIMEOUT');
  });

  it('onError 가 있으면 위임한다', async () => {
    const tmp = await startUpstream((_req, res) => res.end());
    const deadUrl = tmp.url;
    await closeUpstream(tmp);

    const app = express();
    app.use('/', createProxyMiddleware({
      target: deadUrl,
      onError: (_err, _req, res) => { res.status(599).json({ custom: true }); },
    }));

    const resp = await request(app).get('/');
    expect(resp.status).toBe(599);
    expect(resp.body).toEqual({ custom: true });
  });

  it('onProxyReq / onProxyRes 훅이 호출된다', async () => {
    upstream = await startUpstream((_req, res) => res.end('ok'));
    let reqCalled = false;
    let resCalled = false;
    const app = express();
    app.use('/', createProxyMiddleware({
      target: upstream.url,
      onProxyReq: () => { reqCalled = true; },
      onProxyRes: () => { resCalled = true; },
    }));

    await request(app).get('/');
    expect(reqCalled).toBe(true);
    expect(resCalled).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest tests/integration/proxy/proxy.integration.test.ts -t "에러/훅"`
Expected: FAIL — 502/504/onError/onProxyReq 미구현(현재 에러 시 hang 또는 미처리).

- [ ] **Step 3: 에러 처리 + 훅 구현**

`proxyMiddleware.ts` 상단 import에 추가:

```ts
import { log } from '@ext/winston';
import { ERROR_CODES, getHttpStatusForErrorCode } from './errorCodes';
```

`copyResponseHeaders` 아래에 `sendProxyError` 추가:

```ts
function sendProxyError(err: NodeJS.ErrnoException, req: Request, res: Response): void {
  const isTimeout = (err as any).__timeout === true || err.code === 'ETIMEDOUT';
  const code = isTimeout ? ERROR_CODES.GATEWAY_TIMEOUT : ERROR_CODES.BAD_GATEWAY;
  const status = getHttpStatusForErrorCode(code);

  log.Error(`Proxy upstream failure: ${err.code || err.message}`, {
    code, status, path: req.originalUrl, error: err.message,
  });

  if (res.headersSent) {
    res.destroy();
    return;
  }

  const isDev = process.env.NODE_ENV !== 'production';
  res.status(status).json({
    errors: [{
      status: String(status),
      code,
      title: isTimeout ? 'Gateway Timeout' : 'Bad Gateway',
      detail: isDev ? `Upstream request failed: ${err.code || err.message}` : 'Upstream request failed',
    }],
  });
}
```

`proxyMiddleware` 반환 함수에서 `transport.request(...)` 호출 직후, 본문 전달 분기 **이전**에 에러/훅 배선을 추가한다. 즉 `const proxyReq = transport.request(...)` 블록과 본문 분기 사이에 삽입:

```ts
    const handleError = (err: NodeJS.ErrnoException): void => {
      proxyReq.destroy();
      if (options.onError) { options.onError(err, req, res); return; }
      sendProxyError(err, req, res);
    };

    proxyReq.on('error', handleError);
    proxyReq.on('timeout', () => {
      const err: NodeJS.ErrnoException = new Error('Proxy request timed out');
      err.code = 'ETIMEDOUT';
      (err as any).__timeout = true;
      handleError(err);
    });
    req.on('aborted', () => proxyReq.destroy());

    if (options.onProxyReq) options.onProxyReq(proxyReq, req, res);
```

(주의: `if (options.onProxyReq) ...` 는 본문 write 이전에 위치해야 한다. 위 블록을 본문 분기 바로 위에 두면 순서가 보장된다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest tests/integration/proxy/proxy.integration.test.ts`
Expected: PASS — 모든 describe 통과 (12 passed 내외).

- [ ] **Step 5: 커밋**

```bash
git add src/core/lib/proxyMiddleware.ts tests/integration/proxy/proxy.integration.test.ts
git commit -m "feat(proxy): 502/504 에러 응답 + onProxyReq/onProxyRes/onError 훅

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: expressRouter 연결 + 의존성 제거 + 문서 + 전체 검증

**Files:**
- Modify: `src/core/lib/expressRouter.ts` (2행 import; 1312, 1325행 타입)
- Modify: `package.json` (dependencies에서 `http-proxy-middleware` 제거)
- Modify: `docs/02-routing-system.md` (921행 부근)

**Interfaces:**
- Consumes: `createProxyMiddleware`, `ProxyOptions` (Task 2~6)

- [ ] **Step 1: expressRouter import/타입 교체**

`src/core/lib/expressRouter.ts` 2행:

```ts
import { createProxyMiddleware, ProxyOptions } from './proxyMiddleware';
```

(기존 `import { createProxyMiddleware, Options } from 'http-proxy-middleware';` 대체.)

`MIDDLE_PROXY_ROUTE`(약 1312행) / `MIDDLE_PROXY_ROUTE_SLUG`(약 1325행)의 `options: Options` → `options: ProxyOptions`:

```ts
    public MIDDLE_PROXY_ROUTE(options: ProxyOptions) {
        this.router.use("/", createProxyMiddleware(options));
    }
```
```ts
    public MIDDLE_PROXY_ROUTE_SLUG(slug: string[], options: ProxyOptions) {
        this.router.use(this.convertSlugsToPath(slug), createProxyMiddleware(options));
    }
```

- [ ] **Step 2: 의존성 제거**

`package.json`의 `dependencies`에서 다음 줄 삭제:

```json
    "http-proxy-middleware": "^3.0.7",
```

이어서 lock 정리:

Run: `npm install`
Expected: `http-proxy-middleware` 제거됨, `found 0 vulnerabilities`.

- [ ] **Step 3: 문서 갱신**

`docs/02-routing-system.md` 921행:

```markdown
> Node http(s) 기반 자체 구현 리버스 프록시입니다(외부 의존성 없음). 옵션: target, changeOrigin, pathRewrite, headers, secure, timeout, onProxyReq/onProxyRes/onError.
```

(기존 "http-proxy-middleware 라이브러리를 사용한 프록시 처리입니다." 대체. 아래 예시 코드 블록은 그대로 유효.)

- [ ] **Step 4: 잔여 참조 확인**

Run: `npx grep -r "http-proxy-middleware" src docs 2>NUL || rg "http-proxy-middleware" src docs`
Expected: 코드/문서에 잔여 참조 없음 (package-lock 제외).

- [ ] **Step 5: 타입체크 (프록시 관련 에러 0건 확인)**

Run: `npm run typecheck`
Expected: `proxyMiddleware`/`expressRouter` 관련 타입 에러 0건. (기존 `@app/db/default/client` 미생성 에러는 .env/Prisma 생성 선행조건으로 무관 — 그 외 새 에러가 없어야 함.)

- [ ] **Step 6: 전체 테스트 + audit**

Run: `npm test`
Expected: 전체 PASS (기존 276 + 신규 프록시 테스트). 무회귀.

Run: `npm audit`
Expected: `found 0 vulnerabilities`.

- [ ] **Step 7: 커밋**

```bash
git add src/core/lib/expressRouter.ts package.json package-lock.json docs/02-routing-system.md
git commit -m "refactor(proxy): MIDDLE_PROXY_ROUTE를 자체 구현으로 전환 + http-proxy-middleware 의존성 제거

- expressRouter가 자체 proxyMiddleware 사용
- package.json에서 http-proxy-middleware 제거
- docs/02-routing-system.md 갱신

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- 공개 API `ProxyOptions`/`createProxyMiddleware` → Task 2 ✓
- changeOrigin/headers/X-Forwarded/hop-by-hop → Task 3 ✓
- pathRewrite(객체/함수) → Task 4 ✓
- secure/timeout → Task 2(secure, timeout 옵션 전달), Task 6(timeout→504) ✓
- body-parser 상호작용(fixRequestBody) → Task 5 ✓
- 에러 처리(502/504, winston, onError, headersSent 가드, abort) → Task 6 ✓
- 훅(onProxyReq/onProxyRes) → Task 6 ✓ (onProxyRes는 Task 2부터 호출 배선, 검증은 Task 6)
- errorCodes 매핑 → Task 1 ✓
- expressRouter 연결 → Task 7 ✓
- package.json 제거 → Task 7 ✓
- 문서 → Task 7 ✓
- 수용 기준(audit 0, 무회귀, typecheck) → Task 7 ✓

**2. Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. "적절히 처리" 류 문구 없음 ✓

**3. Type consistency:** `createProxyMiddleware`/`ProxyOptions`/`buildOutboundHeaders`/`applyPathRewrite`/`sendProxyError` 명칭이 전 Task에서 일관 ✓. `onProxyRes`는 Task 2에서 호출 배선, Task 6에서 검증 — 시그니처 동일 ✓.

> 참고(실행 시 주의): `onProxyRes` 호출은 Task 2의 `transport.request` 콜백에 이미 포함돼 있다. Task 6의 훅 테스트는 이를 검증한다.
