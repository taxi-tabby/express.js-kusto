import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import qs from 'qs';
import { createProxyMiddleware } from '@lib/http/routing/proxyMiddleware';

interface Upstream {
    server: http.Server;
    url: string;
}

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
    afterEach(async () => {
        if (upstream) await closeUpstream(upstream);
    });

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
    afterEach(async () => {
        if (upstream) await closeUpstream(upstream);
    });

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
        app.use(
            '/',
            createProxyMiddleware({
                target: upstream.url,
                headers: { 'x-custom': 'injected' },
            }),
        );

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

        const resp = await request(app)
            .get('/')
            .set('Connection', 'x-hop-token')
            .set('X-Hop-Token', 'should-be-removed');
        expect(resp.body.headers['x-hop-token']).toBeUndefined();
    });
});

describe('createProxyMiddleware — pathRewrite', () => {
    let upstream: Upstream;
    afterEach(async () => {
        if (upstream) await closeUpstream(upstream);
    });

    function echoUrlUpstream(): Promise<Upstream> {
        return startUpstream((req, res) => {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ url: req.url }));
        });
    }

    it('객체형: { "^/api": "" } 로 접두사를 제거한다', async () => {
        upstream = await echoUrlUpstream();
        const app = express();
        app.use(
            '/',
            createProxyMiddleware({
                target: upstream.url,
                pathRewrite: { '^/api': '' },
            }),
        );

        const resp = await request(app).get('/api/users?x=1');
        expect(resp.body.url).toBe('/users?x=1');
    });

    it('함수형: (path) => path 변환을 적용한다', async () => {
        upstream = await echoUrlUpstream();
        const app = express();
        app.use(
            '/',
            createProxyMiddleware({
                target: upstream.url,
                pathRewrite: (path) => '/prefixed' + path,
            }),
        );

        const resp = await request(app).get('/thing');
        expect(resp.body.url).toBe('/prefixed/thing');
    });
});

describe('createProxyMiddleware — 요청 본문 (body-parser 이후)', () => {
    let upstream: Upstream;
    afterEach(async () => {
        if (upstream) await closeUpstream(upstream);
    });

    function echoBodyUpstream(): Promise<Upstream> {
        return startUpstream((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', (c) => chunks.push(c as Buffer));
            req.on('end', () => {
                res.setHeader('content-type', 'application/json');
                res.end(
                    JSON.stringify({
                        received: Buffer.concat(chunks).toString('utf-8'),
                        contentLength: req.headers['content-length'],
                    }),
                );
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

        const resp = await request(app).post('/x').type('form').send({ a: '1', b: 'two' });
        expect(resp.body.received).toBe('a=1&b=two');
    });

    it('파싱되지 않은 raw 본문은 스트림으로 전달한다', async () => {
        upstream = await echoBodyUpstream();
        const app = express(); // body-parser 없음
        app.use('/', createProxyMiddleware({ target: upstream.url }));

        const resp = await request(app)
            .post('/x')
            .set('content-type', 'text/plain')
            .send('raw-payload');
        expect(resp.body.received).toBe('raw-payload');
    });
});

describe('createProxyMiddleware — 에러/훅', () => {
    let upstream: Upstream | undefined;
    afterEach(async () => {
        if (upstream) await closeUpstream(upstream);
        upstream = undefined;
    });

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

    it('업스트림 무응답 + timeout → 504 GATEWAY_TIMEOUT JSON', async () => {
        upstream = await startUpstream((_req, _res) => {
            /* 응답하지 않음 */
        });
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
        app.use(
            '/',
            createProxyMiddleware({
                target: deadUrl,
                onError: (_err, _req, res) => {
                    res.status(599).json({ custom: true });
                },
            }),
        );

        const resp = await request(app).get('/');
        expect(resp.status).toBe(599);
        expect(resp.body).toEqual({ custom: true });
    });

    it('onProxyReq / onProxyRes 훅이 호출된다', async () => {
        upstream = await startUpstream((_req, res) => res.end('ok'));
        let reqCalled = false;
        let resCalled = false;
        const app = express();
        app.use(
            '/',
            createProxyMiddleware({
                target: upstream.url,
                onProxyReq: () => {
                    reqCalled = true;
                },
                onProxyRes: () => {
                    resCalled = true;
                },
            }),
        );

        await request(app).get('/');
        expect(reqCalled).toBe(true);
        expect(resCalled).toBe(true);
    });
});

describe('createProxyMiddleware — 하드닝(리뷰 반영)', () => {
    let upstream: Upstream | undefined;
    afterEach(async () => {
        if (upstream) await closeUpstream(upstream);
        upstream = undefined;
    });

    function echoBodyUpstream(): Promise<Upstream> {
        return startUpstream((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', (c) => chunks.push(c as Buffer));
            req.on('end', () => {
                res.setHeader('content-type', 'application/json');
                res.end(
                    JSON.stringify({
                        received: Buffer.concat(chunks).toString('utf-8'),
                        method: req.method,
                    }),
                );
            });
        });
    }

    it('빈 객체 {} JSON 본문도 hang 없이 정확히 전달된다(Content-Length 일치)', async () => {
        upstream = await echoBodyUpstream();
        const app = express();
        app.use(express.json());
        app.use('/', createProxyMiddleware({ target: upstream.url }));

        const resp = await request(app)
            .post('/x')
            .set('content-type', 'application/json')
            .send('{}');
        expect(resp.status).toBe(200);
        expect(resp.body.received).toBe('{}');
    });

    it('빈 배열 [] JSON 본문도 hang 없이 정확히 전달된다', async () => {
        upstream = await echoBodyUpstream();
        const app = express();
        app.use(express.json());
        app.use('/', createProxyMiddleware({ target: upstream.url }));

        const resp = await request(app)
            .post('/x')
            .set('content-type', 'application/json')
            .send('[]');
        expect(resp.status).toBe(200);
        expect(resp.body.received).toBe('[]');
    });

    it('중첩 urlencoded(extended) 본문이 손실 없이 전달된다', async () => {
        upstream = await echoBodyUpstream();
        const app = express();
        app.use(express.urlencoded({ extended: true }));
        app.use('/', createProxyMiddleware({ target: upstream.url }));

        const resp = await request(app)
            .post('/x')
            .set('content-type', 'application/x-www-form-urlencoded')
            .send('user[name]=kim&user[age]=20&tags[0]=x&tags[1]=y');
        expect(qs.parse(resp.body.received)).toEqual({
            user: { name: 'kim', age: '20' },
            tags: ['x', 'y'],
        });
    });

    it.each(['put', 'patch'] as const)('%s JSON 본문을 업스트림에 전달한다', async (method) => {
        upstream = await echoBodyUpstream();
        const app = express();
        app.use(express.json());
        app.use('/', createProxyMiddleware({ target: upstream.url }));

        const resp = await (request(app) as any)[method]('/x').send({ a: 1 });
        expect(JSON.parse(resp.body.received)).toEqual({ a: 1 });
        expect(resp.body.method).toBe(method.toUpperCase());
    });

    it('DELETE를 본문 없이 메서드 보존하여 전달한다', async () => {
        upstream = await echoBodyUpstream();
        const app = express();
        app.use(express.json());
        app.use('/', createProxyMiddleware({ target: upstream.url }));

        const resp = await request(app).delete('/x');
        expect(resp.body.method).toBe('DELETE');
        expect(resp.body.received).toBe('');
    });

    it('HEAD 요청은 본문 없이 상태/헤더만 전달한다', async () => {
        upstream = await startUpstream((_req, res) => {
            res.setHeader('x-up', '1');
            res.statusCode = 204;
            res.end();
        });
        const app = express();
        app.use('/', createProxyMiddleware({ target: upstream.url }));

        const resp = await request(app).head('/x');
        expect(resp.status).toBe(204);
        expect(resp.headers['x-up']).toBe('1');
    });

    it('다중 set-cookie 응답 헤더를 모두 보존한다', async () => {
        upstream = await startUpstream((_req, res) => {
            res.setHeader('set-cookie', ['a=1; Path=/', 'b=2; Path=/']);
            res.end('ok');
        });
        const app = express();
        app.use('/', createProxyMiddleware({ target: upstream.url }));

        const resp = await request(app).get('/');
        expect(resp.headers['set-cookie']).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    });

    it('잘못된 target URL 은 생성 시점에 명확한 메시지로 throw 한다', () => {
        expect(() => createProxyMiddleware({ target: 'not a url' })).toThrow(/Invalid target URL/);
    });

    it('셋업 단계 동기 throw(잘못된 경로)는 onError 로 위임된다(500 누수 없음)', async () => {
        upstream = await startUpstream((_req, res) => res.end('ok'));
        let onErrorCalled = false;
        const app = express();
        app.use(
            '/',
            createProxyMiddleware({
                target: upstream.url,
                pathRewrite: () => '/bad\npath', // http.request 가 동기 throw
                onError: (_e, _req, res) => {
                    onErrorCalled = true;
                    res.status(502).json({ setupError: true });
                },
            }),
        );

        const resp = await request(app).get('/');
        expect(onErrorCalled).toBe(true);
        expect(resp.status).toBe(502);
        expect(resp.body).toEqual({ setupError: true });
    });

    it('응답 스트리밍 중 클라이언트가 끊으면 업스트림 요청을 정리한다', async () => {
        let upstreamReqClosed = false;
        upstream = await startUpstream((req, res) => {
            res.setHeader('content-type', 'text/plain');
            res.write('first-chunk-'); // 헤더 + 첫 청크만 보내고 응답을 유지
            req.on('close', () => {
                upstreamReqClosed = true;
            });
        });
        const app = express();
        app.use('/', createProxyMiddleware({ target: upstream.url }));

        const server = await new Promise<http.Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const port = (server.address() as AddressInfo).port;

        await new Promise<void>((resolve) => {
            const clientReq = http.get({ host: '127.0.0.1', port, path: '/' }, (clientRes) => {
                clientRes.once('data', () => {
                    clientReq.destroy();
                }); // 첫 청크 받자마자 클라이언트 중단
            });
            clientReq.on('error', () => {
                /* abort 로 인한 에러 무시 */
            });
            setTimeout(resolve, 400); // 정리 전파 대기
        });

        await new Promise<void>((resolve) => server.close(() => resolve()));
        expect(upstreamReqClosed).toBe(true);
    });
});
