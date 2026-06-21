import { Request, Response, NextFunction } from 'express';
import { MetricsCollector } from './metricsCollector';
import { MONITOR_PATH } from './monitorTypes';

/**
 * 요청 라벨링 — top-routes 카디널리티 폭주 방지를 위해 동적 세그먼트를 정규화한다.
 * 매칭된 라우트 패턴(req.route.path)이 있으면 그것을 우선 사용한다.
 */
function labelRoute(req: Request): string {
    const matched = (req as any).route?.path;
    if (matched && typeof matched === 'string') {
        const base = req.baseUrl || '';
        return base + matched || '/';
    }
    // 패턴이 없으면(주로 404/미매칭) 동적으로 보이는 세그먼트를 :id 로 접어 카디널리티를 줄인다.
    // 숫자 / UUID / 긴 hex 토큰 / 아주 긴 세그먼트를 모두 접어 fuzzing 잡음을 억제.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isDynamic = (seg: string): boolean =>
        /^\d+$/.test(seg) || uuid.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) || seg.length > 24;
    return (
        req.path
            .split('/')
            .map((seg) => (isDynamic(seg) ? ':id' : seg))
            .join('/') || '/'
    );
}

/**
 * 요청 메트릭 수집 미들웨어. 라우트보다 먼저 등록되어 모든 요청을 카운트한다.
 * 메트릭 엔드포인트 자신은 폴링으로 인한 자기 집계 왜곡을 막기 위해 제외한다.
 */
export function monitorMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (req.path === MONITOR_PATH || req.path.startsWith(MONITOR_PATH + '/')) {
        return next();
    }
    const collector = MetricsCollector.instance();
    collector.onStart();
    const start = process.hrtime.bigint();
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        collector.onFinish(req.method, labelRoute(req), res.statusCode, durationMs);
    };
    res.on('finish', finish); // 정상 완료
    res.on('close', finish); // 클라이언트가 중간에 끊은 경우
    next();
}
