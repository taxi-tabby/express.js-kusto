import { Request, Response, NextFunction, RequestHandler } from 'express';
import { DependencyInjector } from './dependencyInjector';
import { prismaManager } from './prismaManager';
import { repositoryManager } from './repositoryManager';
import { kustoManager } from './kustoManager';
import { Injectable } from './types/generated-injectable-types';
import { ValidatedRequest } from './requestHandler';

export type MiddlewareHandlerFunction = (
    req: Request, 
    res: Response, 
    next: NextFunction, 
    injected: Injectable, 
    repo: typeof repositoryManager, 
    db: typeof prismaManager
) => void;

export type ValidatedMiddlewareHandlerFunction = (
    req: ValidatedRequest, 
    res: Response, 
    next: NextFunction, 
    injected: Injectable, 
    repo: typeof repositoryManager, 
    db: typeof prismaManager
) => Promise<any> | any;

/**
 * MiddlewareHandlerFunction을 Express 호환 미들웨어로 래핑하는 헬퍼 함수
 *
 * 비동기 핸들러의 거부(rejection)도 next(error)로 전달하도록 async + await 로 래핑한다.
 * (ExpressRouter 의 private 래퍼가 이 함수에 위임하므로 단일 출처로 유지된다 — P1-10b)
 */
export function wrapMiddleware(handler: MiddlewareHandlerFunction): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            // Kusto 매니저를 Request 객체에 설정
            req.kusto = kustoManager;

            // Dependency injector에서 모든 injectable 모듈 가져오기
            const injected = DependencyInjector.getInstance().getInjectedModules();
            await handler(req, res, next, injected, repositoryManager, prismaManager);
        } catch (error) {
            next(error);
        }
    };
}

/**
 * ValidatedMiddlewareHandlerFunction을 Express 호환 미들웨어로 래핑하는 헬퍼 함수
 */
export function wrapValidatedMiddleware(handler: ValidatedMiddlewareHandlerFunction): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            // Kusto 매니저를 Request 객체에 설정
            req.kusto = kustoManager;
            
            // Dependency injector에서 모든 injectable 모듈 가져오기
            const injected = DependencyInjector.getInstance().getInjectedModules();
            const result = await handler(req as ValidatedRequest, res, next, injected, repositoryManager, prismaManager);
            return result;
        } catch (error) {
            next(error);
        }
    };
}

/**
 * 6-arg MiddlewareHandlerFunction 임을 명시적으로 표시하는 브랜딩 헬퍼 (P2-13).
 *
 * WITH() 의 디스패치는 `fn.length >= 6` arity 휴리스틱에 의존하는데,
 * 기본값/rest 파라미터가 있으면 Function.length 가 줄어들어 오분류된다.
 * (예: `(req,res,next,injected,repo,db = x) => {}` 의 length 는 5)
 * 이 헬퍼로 감싸면 arity 와 무관하게 항상 injected 미들웨어로 올바르게 래핑된다.
 *
 * @example router.WITH 'name' 으로 등록할 모듈에서: export default injectedMiddleware((req,res,next,injected,repo,db=...) => {...})
 */
export function injectedMiddleware(fn: MiddlewareHandlerFunction): MiddlewareHandlerFunction {
    (fn as any).__kustoInjected = true;
    return fn;
}

/**
 * 미들웨어 배열을 래핑하는 헬퍼 함수
 */
export function wrapMiddlewares(handlers: MiddlewareHandlerFunction[]): RequestHandler[] {
    return handlers.map(handler => wrapMiddleware(handler));
}

/**
 * 검증된 미들웨어 배열을 래핑하는 헬퍼 함수
 */
export function wrapValidatedMiddlewares(handlers: ValidatedMiddlewareHandlerFunction[]): RequestHandler[] {
    return handlers.map(handler => wrapValidatedMiddleware(handler));
}
