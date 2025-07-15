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
 */
export function wrapMiddleware(handler: MiddlewareHandlerFunction): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            // Kusto 매니저를 Request 객체에 설정
            req.kusto = kustoManager;
            
            // Dependency injector에서 모든 injectable 모듈 가져오기
            const injected = DependencyInjector.getInstance().getInjectedModules();
            handler(req, res, next, injected, repositoryManager, prismaManager);
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
