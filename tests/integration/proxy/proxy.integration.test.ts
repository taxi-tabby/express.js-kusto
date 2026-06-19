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

  it('X-Forwarded-Proto/Host/For 헤더를 추가한다', async () => {
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

  it('Connection 에 나열된 hop-by-hop 토큰 헤더를 업스트림으로 전달하지 않는다', async () => {
    // 주의: `Connection` 헤더 자체는 Node http(s).request 가 에이전트 설정에 따라
    // 항상 자체 부여하므로 제거 여부를 검증할 수 없다. 대신 Connection 에 나열된
    // 토큰에 해당하는 헤더(여기선 x-hop-token)가 제거되는지로 hop-by-hop 처리를 검증한다.
    upstream = await echoHeadersUpstream();
    const app = express();
    app.use('/', createProxyMiddleware({ target: upstream.url }));

    const resp = await request(app).get('/')
      .set('Connection', 'x-hop-token')
      .set('X-Hop-Token', 'should-be-removed');
    expect(resp.body.headers['x-hop-token']).toBeUndefined();
  });
});

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
