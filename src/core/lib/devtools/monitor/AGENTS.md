# monitor/ - Live Dev Metrics (server side)

The data source for the `kusto monitor` TUI. Collects metrics from the running dev server and
exposes them at `GET /__kusto/metrics`. **DEV-only + localhost-only** (disabled when NODE_ENV=production).

> The CLI (consumer) side renderer lives in `src/core/cli/monitor/`. Both share the
> `MonitorSnapshot` contract from `monitorTypes`.

## Structure

```
monitor/
├── monitorTypes.ts      # MonitorSnapshot contract SSOT (producer↔consumer) + MONITOR_PATH constant
├── metricsCollector.ts  # request-metrics singleton (fixed-size ring → memory upper bound)
├── monitorMiddleware.ts # records request start/end (res finish/close), normalizes dynamic segments to :id
└── monitorSetup.ts      # buildSnapshot + registerMonitor (middleware + endpoint, dev/localhost gate)
```

## Files

### `monitorTypes.ts`
- **Responsibility**: Defines the JSON shape the server exposes and the CLI polls, in one place (SSOT). Both import the same type.
- **Key exports**: `MonitorSnapshot` (app/process/requests/databases), its sub-types, `MONITOR_PATH` (`/__kusto/metrics`), `PER_SECOND_WINDOW`.

### `metricsCollector.ts`
- **Responsibility**: Accumulates and summarizes requests via `onStart`/`onFinish`. Every buffer is a fixed-size ring, guaranteeing a memory upper bound (no leaks).
- **Key exports**: `class MetricsCollector` (`instance()` singleton, `onStart`/`onFinish`/`snapshot`/`reset`). snapshot: total, in-flight, status classification, req/s buckets + sparkline, latency p50/p95/p99/max/avg, recent requests, top routes.

### `monitorMiddleware.ts`
- **Responsibility**: Registered before routes so it counts requests that are routed (not static). Records latency and status on `res` finish/close. The metrics endpoint itself and static assets short-circuited by `express.static` are excluded from aggregation. Folds numeric/UUID/long-hex/very-long path segments into `:id` to suppress cardinality (top routes evict the lowest count).
- **Key exports**: `monitorMiddleware`.

### `monitorSetup.ts`
- **Responsibility**: `buildSnapshot(ctx)` assembles collector + process (mem/cpu%/event-loop lag via perf_hooks/uptime) + prisma status + repo/DI counts + readiness + env flags + route count. `registerMonitor(app, ctx)` registers the middleware and the endpoint (localhost gate).
- **Key exports**: `registerMonitor`, `buildSnapshot`, `isMonitorEnabled`, `stopMonitor` (test cleanup), `MonitorContext`.
- **Depends on**: `@lib/data/database/prismaManager` (status/provider/reconnect), `@lib/data/database/repositoryManager`, `@lib/data/di/dependencyInjector`, `perf_hooks`, `@ext/winston`. Core (`setupMonitor`) injects the host/port/readiness/routeCount context.

## Gate / Safety

- `isMonitorEnabled()` = `NODE_ENV !== 'production'`. The endpoint allows loopback IPs only (otherwise 403).
- Memory upper bound (fixed ring), metrics polling excluded from its own aggregation. The event-loop histogram can be cleaned up via `stopMonitor()`.
