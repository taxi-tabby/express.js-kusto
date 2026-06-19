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
