# monitor/ - Live Dev Metrics (server side)

`kusto monitor` TUI 의 데이터 소스. 실행 중인 dev 서버에서 메트릭을 수집하고
`GET /__kusto/metrics` 로 노출한다. **DEV 전용 + localhost 전용**(NODE_ENV=production 비활성).

> CLI(소비자) 측 렌더러는 `src/core/cli/monitor/` 에 있다. 둘은 `monitorTypes` 의
> `MonitorSnapshot` 계약을 공유한다.

## Structure

```
monitor/
├── monitorTypes.ts      # MonitorSnapshot 계약 SSOT(producer↔consumer) + MONITOR_PATH 상수
├── metricsCollector.ts  # 요청 메트릭 싱글톤(고정크기 링 → 메모리 상한)
├── monitorMiddleware.ts # 요청 시작/종료 기록(res finish/close), 동적 세그먼트 :id 정규화
└── monitorSetup.ts      # buildSnapshot + registerMonitor(미들웨어+엔드포인트, dev/localhost 게이트)
```

## Files

### `monitorTypes.ts`
- **책임**: 서버가 노출하고 CLI 가 폴링하는 JSON 형태를 한 곳에서 정의(SSOT). 둘이 같은 타입을 import.
- **주요 export**: `MonitorSnapshot`(app/process/requests/databases), 하위 타입들, `MONITOR_PATH`(`/__kusto/metrics`), `PER_SECOND_WINDOW`.

### `metricsCollector.ts`
- **책임**: `onStart`/`onFinish` 로 요청을 누적·요약. 모든 버퍼가 고정 크기 링이라 메모리 상한 보장(누수 없음).
- **주요 export**: `class MetricsCollector`(`instance()` 싱글톤, `onStart`/`onFinish`/`snapshot`/`reset`). snapshot: total·in-flight·status분류·req/s 버킷+스파크라인·지연 p50/p95/p99/max/avg·최근요청·top routes.

### `monitorMiddleware.ts`
- **책임**: 라우트보다 먼저 등록되어 라우팅되는(정적이 아닌) 요청을 카운트. `res` finish/close 에서 지연·상태 기록. 메트릭 엔드포인트 자신과 `express.static` 으로 단락 처리되는 정적 자산은 집계에서 제외된다. 경로의 숫자/UUID/긴 hex/아주 긴 세그먼트를 `:id` 로 접어 카디널리티 억제(top routes 는 최저 count 축출).
- **주요 export**: `monitorMiddleware`.

### `monitorSetup.ts`
- **책임**: `buildSnapshot(ctx)` 로 collector + process(mem/cpu%/event-loop lag via perf_hooks/uptime) + prisma status + repo/DI 수 + readiness + env flags + route count 를 조립. `registerMonitor(app, ctx)` 로 미들웨어와 엔드포인트(localhost 게이트)를 등록.
- **주요 export**: `registerMonitor`, `buildSnapshot`, `isMonitorEnabled`, `stopMonitor`(테스트 정리), `MonitorContext`.
- **의존**: `@lib/data/database/prismaManager`(status·provider·reconnect), `@lib/data/database/repositoryManager`, `@lib/data/di/dependencyInjector`, `perf_hooks`, `@ext/winston`. Core(`setupMonitor`)가 host/port/readiness/routeCount 컨텍스트를 주입한다.

## 게이트 / 안전

- `isMonitorEnabled()` = `NODE_ENV !== 'production'`. 엔드포인트는 루프백 IP 만 허용(그 외 403).
- 메모리 상한(고정 링), 메트릭 폴링 자기집계 제외. event-loop 히스토그램은 `stopMonitor()` 로 정리 가능.
