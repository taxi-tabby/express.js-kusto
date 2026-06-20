# 📊 실시간 모니터 (`kusto monitor`)

실행 중인 **개발 서버**를 htop 처럼 실시간으로 관찰하는 터미널 대시보드.
**별도 터미널**에서 띄워, 프로세스·요청량·DB·라우팅 상태를 한눈에 본다. 무의존(경량 ANSI).

```bash
# 터미널 1: 서버 실행
npm run dev

# 터미널 2: 모니터
npx kusto monitor          # 또는: npx kusto top
npm run kusto -- monitor   # npm 스크립트로도 동일
```

종료: `q` 또는 `Ctrl-C`.

## 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--port <n>` | `$PORT` 또는 `3000` | 서버 포트 |
| `--host <h>` | `localhost` | 서버 호스트 |
| `--url <url>` | (host/port 로 구성) | 메트릭 URL 직접 지정 |
| `--interval <ms>` | `1000` | 갱신 주기 |

## 표시 항목

- **PROCESS**: RSS/heap 메모리 막대, CPU%, event-loop 지연(평균/최대), PID, Node 버전, uptime
- **REQUESTS**: req/s(스파크라인), in-flight, 상태코드 분포(2xx/3xx/4xx/5xx), 지연 p50/p95/p99/max/avg, 총 요청 수
- **DATABASES**: DB별 연결 상태·프로바이더·재연결 시도 횟수
- **APP**: 라우트 수, 로드된 repo/injectable 수, readiness(ready/degraded), 기능 플래그(AUTO_DOCS/ENABLE_SCHEMA_API)
- **RECENT**: 최근 요청 목록(메서드·경로·상태·지연, 상태별 색)

터미널 크기를 인식해 동적으로 레이아웃을 맞추고(폭 초과 시 자르기, 높이에 맞춰 RECENT 목록 길이 조절), 창 크기를 바꾸면 즉시 다시 그린다.

## 동작 구조 / 보안

- 서버가 실행 중일 때만 동작한다. 서버가 없으면 "Waiting for server …" 대기 화면을 보여주며 계속 폴링한다.
- 서버는 **개발 모드(NODE_ENV ≠ production)에서만** 메트릭 엔드포인트 `GET /__kusto/metrics` 를 노출하고, 실제 TCP 피어 주소가 **루프백일 때만** 접근을 허용한다(비-로컬은 403). 프록시 헤더(X-Forwarded-For)가 아니라 raw 소켓 주소로 판정하므로 trust proxy 설정과 무관하게 우회되지 않는다. 별도 설정 없이 dev 에서 자동 활성된다.
- 메트릭 수집 미들웨어는 고정 크기 링버퍼만 사용해 메모리 상한이 있으며, 메트릭 엔드포인트 자신과 `express.static` 으로 처리되는 정적 자산은 집계에서 제외한다(라우팅되는 요청만 카운트).
- 구현: 서버측 `src/core/lib/devtools/monitor/`, CLI측 `src/core/cli/monitor/`.

---

## 📖 문서 네비게이션

**◀️ 이전**: [📋 CRUD 스키마 API](./08-crud-schema-api.md)
