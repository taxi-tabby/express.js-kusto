# 자체 HTTP 리버스 프록시 구현 (http-proxy-middleware 의존성 제거)

- **날짜**: 2026-06-20
- **상태**: 승인됨 (설계)
- **관련 버전**: 0.1.47 (ver/0.1.47)

## 배경 / 동기

`http-proxy-middleware`는 보안 어드바이저리(GHSA-64mm-vxmg-q3vj, CVE-2026-55602,
`router` host+path 매칭 우회)로 인해 2.x → 3.0.6+ 또는 4.1.0+로 올려야 했다.
3.0.7로 임시 해결했으나, 이 프레임워크에서 해당 라이브러리는 `ExpressRouter`의
`MIDDLE_PROXY_ROUTE` / `MIDDLE_PROXY_ROUTE_SLUG` 두 메서드에서 `createProxyMiddleware(options)`를
**그대로 통과시키는 얇은 래퍼로만** 사용된다. 앱 코드(`src/app`)에는 실사용처가 0건이다.

이 정도 표면이라면 Node 표준 `http`/`https` 모듈로 직접 구현하여 외부 의존성과
보안 추적 부담을 제거하는 것이 합리적이다.

## 목표

- `http`/`https` 기반의 자체 리버스 프록시 Express 미들웨어 팩토리를 `src/core/`에 구현한다.
- `http-proxy-middleware`를 `package.json` 의존성에서 제거한다.
- `MIDDLE_PROXY_ROUTE` / `MIDDLE_PROXY_ROUTE_SLUG`의 동작을 유지한다(공개 API의 옵션 형태는
  새 `ProxyOptions`로 정리하되, 메서드 시그니처/이름은 유지).

## 비목표 (YAGNI)

- WebSocket(`ws`) 업그레이드 프록시 — 현재 수요 없음, 복잡도 큼. 추후 별도 스펙.
- `router`(동적 타깃 선택) 옵션 — 본 취약점의 원인이며 수요 없음.
- 다중 타깃 로드밸런싱, 리트라이, 서킷브레이커.

## 지원 기능 범위 (표준 HTTP 리버스 프록시)

`target`, `changeOrigin`, `pathRewrite`(객체/함수), `headers`, `secure`(TLS 검증),
`timeout`, 라이프사이클 훅(`onProxyReq`/`onProxyRes`/`onError`), 표준 `X-Forwarded-*` 헤더.

## 공개 API — `src/core/lib/proxyMiddleware.ts`

`expressRouter.ts`의 변경을 최소화하기 위해 export 이름은 `createProxyMiddleware`를 유지한다.

```ts
import type { Request, Response, RequestHandler } from 'express';
import type * as http from 'http';

export interface ProxyOptions {
  /** 업스트림 베이스 URL. 필수. 예: 'http://localhost:3001', 'https://api.example.com' */
  target: string;
  /** Host 헤더를 target 호스트로 교체. 기본 false. */
  changeOrigin?: boolean;
  /**
   * 포워딩 전 경로 재작성.
   * - 객체: { '^/api': '' } — 정규식(string 키)→치환, 정의 순서대로 적용
   * - 함수: (path, req) => newPath
   */
  pathRewrite?: Record<string, string> | ((path: string, req: Request) => string);
  /** 아웃바운드 요청에 set/override 할 헤더. */
  headers?: Record<string, string>;
  /** https 타깃의 TLS 인증서 검증 여부. 기본 true. */
  secure?: boolean;
  /** 업스트림 소켓/연결 타임아웃(ms). 미지정 시 무제한(Node 기본). */
  timeout?: number;
  /** 라이프사이클 훅 (모두 선택) */
  onProxyReq?: (proxyReq: http.ClientRequest, req: Request, res: Response) => void;
  onProxyRes?: (proxyRes: http.IncomingMessage, req: Request, res: Response) => void;
  onError?: (err: Error, req: Request, res: Response) => void;
}

export function createProxyMiddleware(options: ProxyOptions): RequestHandler;
```

## 동작 / 데이터 흐름

반환된 `RequestHandler (req, res, next)`는 다음을 수행한다:

1. **타깃 파싱**: `new URL(options.target)` → `protocol`로 `http`/`https` 모듈 선택,
   `hostname`/`port` 추출. 잘못된 target은 즉시 `onError`/502 경로.
2. **경로 산출**: `req.url`(미들웨어 마운트 이후의 경로 — http-proxy-middleware와 동일 기준)을
   시작점으로 `pathRewrite` 적용.
   - 객체형: 각 `[패턴, 치환]`을 `new RegExp(패턴)`으로 순서대로 `path.replace`.
   - 함수형: `pathRewrite(path, req)` 결과 사용.
3. **헤더 구성**:
   - `req.headers`를 복사한다.
   - **hop-by-hop 헤더 제거**(RFC 2616 13.5.1): `connection`, `keep-alive`,
     `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`,
     `transfer-encoding`, `upgrade`. 추가로 `connection` 값에 나열된 토큰도 제거.
   - `changeOrigin`이면 `host`를 타깃 `host[:port]`로 교체.
   - **`X-Forwarded-For`**(기존 값에 `req.ip` append), **`X-Forwarded-Proto`**(`req.protocol`),
     **`X-Forwarded-Host`**(원본 `req.headers.host`) 설정. (표준 프록시 동작, 기본 on)
   - 마지막으로 `options.headers`로 덮어쓴다.
4. **업스트림 요청 생성**: `http.request`/`https.request`에 `{ hostname, port, path, method: req.method, headers, timeout }`,
   https일 때 `rejectUnauthorized: options.secure !== false`.
5. **`onProxyReq(proxyReq, req, res)`** 호출(있으면).
6. **요청 body 전달** — 아래 "Body 처리" 참조.
7. 업스트림 **`response`(`proxyRes`)** 수신 시:
   - **`onProxyRes(proxyRes, req, res)`** 호출(있으면).
   - `res.statusCode = proxyRes.statusCode`, 응답 헤더를 hop-by-hop 제거 후 복사.
   - `proxyRes.pipe(res)` — 응답 본문 스트리밍.
8. 에러/타임아웃 — 아래 "에러 처리" 참조.
9. **정리**: 클라이언트 abort(`req`의 `close`/`aborted`) 시 `proxyReq.destroy()`.

## ⚠️ Body 처리 (가장 중요한 구현 포인트)

이 프레임워크는 **전역 미들웨어로 body-parser(JSON + urlencoded, 50mb,
`application/vnd.api+json` 포함)** 를 프록시보다 먼저 적용한다. 따라서 프록시 시점엔
`req` 스트림이 이미 소비되어 단순 `req.pipe(proxyReq)`로는 POST/PUT/PATCH **body가 비어버린다**.

http-proxy-middleware의 `fixRequestBody`와 동일하게 처리한다:

- `req.body`가 존재하고 비어있지 않으면(= body-parser가 소비함):
  - `Content-Type`이 JSON 계열이면 `JSON.stringify(req.body)`,
  - `application/x-www-form-urlencoded`면 `querystring.stringify(req.body)`,
  - 해당 직렬화 바이트로 `Content-Length`를 보정한 뒤 `proxyReq.write(bodyData); proxyReq.end();`
- `req.body`가 없으면(파싱되지 않은 raw 요청) `req.pipe(proxyReq)`로 스트리밍.

> 참고: 멀티파트(`multer`)는 라우트 단위로만 적용되며 프록시 라우트에는 적용되지 않으므로 범위 밖.

## 에러 처리 (프레임워크 컨벤션 따름)

업스트림 `proxyReq`의 `error`/`timeout` 이벤트:

- `options.onError`가 있으면 호출하고 위임한다(응답 책임을 훅에 넘김).
- 없으면:
  - winston으로 로깅: `log.Error(...)`(실패 상세) + 필요 시 `log.Route(...)`.
  - **응답 헤더가 아직 안 나갔으면** 프레임워크 일관 JSON 에러 응답을 보낸다:
    - 타임아웃(`timeout` 이벤트, `ETIMEDOUT`) → `GATEWAY_TIMEOUT` (504)
    - 연결거부/DNS/리셋(`ECONNREFUSED`/`ENOTFOUND`/`ECONNRESET`/`EHOSTUNREACH`) → `BAD_GATEWAY` (502)
    - 그 외 → `BAD_GATEWAY` (502)
  - 상태코드는 `getHttpStatusForErrorCode(code)`로 산출(아래 errorCodes 보강 필요).
  - 본문은 JSON:API 형식 `{ errors: [{ status, code, title, detail }] }`로 구성한다
    (기존 `ErrorHandler`/`crudHelpers` 패턴과 일관). detail은 개발 환경에서만 상세히.
  - **응답 헤더가 이미 나간 경우**(스트리밍 중간 실패)에는 본문을 더 쓸 수 없으므로
    `res.destroy()`/소켓 종료로 안전하게 끊는다(이중 전송 방지).
- 타임아웃 시 `proxyReq.destroy()`로 소켓을 정리한다.

## 기존 파일 변경

### `src/core/lib/errorCodes.ts` (보강)
`ERROR_STATUS_MAP`에 누락된 게이트웨이 매핑 추가(현재는 500으로 폴백됨):

```ts
[ERROR_CODES.BAD_GATEWAY]: 502,
[ERROR_CODES.SERVICE_UNAVAILABLE]: 503,
[ERROR_CODES.GATEWAY_TIMEOUT]: 504,
[ERROR_CODES.CONNECTION_TIMEOUT]: 504,
```

### `src/core/lib/expressRouter.ts` (최소 변경)
- import 변경:
  `import { createProxyMiddleware, Options } from 'http-proxy-middleware';`
  → `import { createProxyMiddleware, ProxyOptions } from './proxyMiddleware';`
- `MIDDLE_PROXY_ROUTE(options: Options)` → `(options: ProxyOptions)`
- `MIDDLE_PROXY_ROUTE_SLUG(slug: string[], options: Options)` → `(slug, options: ProxyOptions)`
- 메서드 본문은 변경 없음.

### `package.json` (의존성 제거)
- `dependencies`에서 `"http-proxy-middleware"` 제거 → `npm install`로 `package-lock.json` 정리.

### `docs/02-routing-system.md` (문서 갱신)
- "http-proxy-middleware 라이브러리를 사용한 프록시 처리입니다." 설명을 자체 구현 + `ProxyOptions`
  표면 설명으로 갱신. 기존 예시(`{ target, changeOrigin }`)는 그대로 유효.

## 테스트 계획

`supertest` + 실제 업스트림 `http.createServer`(임시 포트)로 통합 테스트 작성.
위치: `tests/integration/proxy/proxy.integration.test.ts` (기존 통합 테스트 구조 따름).

- GET 프록시: 상태/헤더/본문 정확 전달.
- **POST JSON body 프록시**: body-parser 이후에도 본문이 업스트림에 정확 도달(`fixRequestBody` 검증).
- POST urlencoded body 프록시.
- `pathRewrite` 객체형(`{ '^/api': '' }`) 및 함수형.
- `changeOrigin: true`일 때 업스트림이 받은 Host가 타깃 호스트.
- `headers` 덮어쓰기 반영.
- `X-Forwarded-For/Proto/Host` 헤더 존재 및 값.
- 업스트림 다운(닫힌 포트) → 502 `BAD_GATEWAY` JSON.
- 업스트림 타임아웃(느린 서버 + 작은 `timeout`) → 504 `GATEWAY_TIMEOUT` JSON.
- `onProxyReq`/`onProxyRes`/`onError` 훅 호출 확인.
- `MIDDLE_PROXY_ROUTE_SLUG` 마운트 경로 정확성.

## 수용 기준 (Acceptance Criteria)

1. `npm audit` 결과 0 vulnerabilities 유지, `http-proxy-middleware`가 `package.json`/lock에서 제거됨.
2. 위 테스트 전부 통과, 기존 전체 테스트 스위트(현재 276 passed) 무회귀.
3. `npm run typecheck`에서 프록시 관련 타입 에러 0건(기존 db-client 생성 선행조건 제외).
4. `MIDDLE_PROXY_ROUTE`/`MIDDLE_PROXY_ROUTE_SLUG`가 `ProxyOptions`로 동작하며 문서가 갱신됨.

## 리스크 / 주의

- **Body 처리**가 가장 미묘함: body-parser와의 상호작용을 `fixRequestBody`로 정확히 처리하지 않으면
  POST 계열에서 조용한 실패(빈 body)가 난다. 테스트로 반드시 커버.
- 공개 API 옵션 형태가 `http-proxy-middleware`의 `Options`에서 `ProxyOptions`로 바뀌므로
  (이 프레임워크를 쓰는 다운스트림 앱 기준) breaking change. 0.1.x 버전 노트/CHANGELOG에 명시 권장.
- hop-by-hop 헤더 누락 시 일부 업스트림에서 응답 깨짐 → 제거 목록을 정확히 구현.
