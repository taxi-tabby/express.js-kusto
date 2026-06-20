import { Request, Response, NextFunction } from 'express';
import '@lib/types/express-extensions';
import { kustoManager } from '@lib/data/di/kustoManager';
import { ErrorHandler, ErrorResponseFormat } from '@lib/http/errors/errorHandler';

/**
 * 프레임워크 필수 미들웨어(Core 소유).
 *
 * 이전에는 `src/app/routes/middleware.ts` 에 인라인으로 있어 사용자 워크스페이스에 새어
 * 있었고(수정 대상이 아닌데도), updater 가 src/app 을 제외하므로 프레임워크가 고쳐도
 * 소비자에게 전달되지 못했다. 이제 Core 가 직접 등록한다(요청마다 항상 실행).
 */

/** `req.kusto`(통합 리소스 접근 facade)를 주입한다. 모든 핸들러보다 먼저 실행. */
export function kustoInitMiddleware(req: Request, _res: Response, next: NextFunction): void {
    if (!req.kusto) {
        req.kusto = kustoManager;
    }
    next();
}

/**
 * 전역 에러 핸들러(4-arg). 라우트 등록 이후 맨 뒤에 마운트된다(Core 가 처리).
 *
 * 에러가 명시한 HTTP 상태를 존중하고, ErrorHandler 를 경유해 NODE_ENV 기준으로 민감정보를
 * redaction 한 뒤 JSON:API 형태로 응답한다.
 */
export function globalErrorMiddleware(err: Error, req: Request, res: Response, next: NextFunction): void {
    if (res.headersSent) {
        next(err);
        return;
    }
    const status = (err as { statusCode?: number; status?: number })?.statusCode
        ?? (err as { status?: number })?.status
        ?? 500;
    const body = ErrorHandler.handleError(err, {
        format: ErrorResponseFormat.JSON_API,
        context: { path: req.originalUrl, method: req.method, status },
        // security 생략 → applySecurity 가 NODE_ENV 기준으로 stack/connection-string 등 redaction
    });
    res.status(status).json(body);
}
