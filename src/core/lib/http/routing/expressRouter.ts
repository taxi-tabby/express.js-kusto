import { Router, Request, Response, RequestHandler, NextFunction, static as static_ } from 'express';
import { createProxyMiddleware, ProxyOptions } from '@lib/http/routing/proxyMiddleware';
import multer from 'multer';
import { DocumentationGenerator } from '@lib/devtools/documentation/documentationGenerator';
import { RequestHandler as CustomRequestHandler, RequestConfig, ResponseConfig, ValidatedRequest } from '@lib/http/validation/requestHandler';
import { Injectable, MiddlewareName, MiddlewareParams, MIDDLEWARE_PARAM_MAPPING } from '@lib/types/generated-injectable-types';
import { DatabaseNamesUnion, DatabaseClientMap } from '@lib/types/generated-db-types';
import { DependencyInjector } from '@lib/data/di/dependencyInjector';
import { prismaManager } from '@lib/data/database/prismaManager'
import { repositoryManager } from '@lib/data/database/repositoryManager'
import { kustoManager } from '@lib/data/di/kustoManager'
import { CrudQueryParser, PrismaQueryBuilder, CrudResponseFormatter, JsonApiTransformer, JsonApiResponse, JsonApiResource, JsonApiRelationship, JsonApiErrorResponse } from '@lib/crud/crudHelpers';
import { ErrorFormatter } from '@lib/http/errors/errorFormatter';
import { serializeBigInt, serialize, ResponseSerializer, applyResponseSerializer } from '@lib/http/serialization/serializer';
import {
    parseUuid as parseUuidImpl,
    parseString as parseStringImpl,
    parseInt_ as parseIntImpl,
    parseIdSmart as parseIdSmartImpl,
    getSmartPrimaryKeyParser as getSmartPrimaryKeyParserImpl,
} from '@lib/crud/primaryKeyParsers';
import { ERROR_CODES, getHttpStatusForErrorCode } from '@lib/http/errors/errorCodes';
import { CrudSchemaRegistry } from '@lib/devtools/schema-api/crudSchemaRegistry';
import { PrismaSchemaAnalyzer } from '@lib/devtools/schema-api/prismaSchemaAnalyzer';
import {
    syncSchemasFromAnalyzer,
    registerJsonApiErrorSchema,
    jsonApiCollectionResponse,
    jsonApiResponse,
    jsonApiBody,
    jsonApiErrorResponse,
} from '@lib/devtools/documentation';
import { log } from '@ext/winston';
import '@lib/types/express-extensions';


export type HandlerFunction = (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => void;
export type ValidatedHandlerFunction<TConfig extends RequestConfig = RequestConfig, R = any> = (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => Promise<R> | R;
export type MiddlewareHandlerFunction = (req: Request, res: Response, next: NextFunction, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => void;
export type ValidatedMiddlewareHandlerFunction<TConfig extends RequestConfig = RequestConfig> = (req: ValidatedRequest<TConfig>, res: Response, next: NextFunction, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => Promise<any> | any;

/**
 * Stable capability surface that a router-driving builder/extension receives.
 * An `ExpressRouter` instance structurally satisfies this; both `CRUD()` and
 * extension-registered router methods are driven through it. Single source of
 * truth for the router context (the CRUD engine aliases this as `CrudBuilderContext`).
 */
export interface RouterContext {
    /** Express Router that routes are registered on. */
    router: Router;
    /** Current router base path (used for docs/schema registration). */
    basePath: string;
    /** CRUD schema registry (dev-mode schema registration). */
    schemaRegistry: CrudSchemaRegistry;
    /** Prisma schema analyzer (Json fields / include policy, etc.). */
    schemaAnalyzer: PrismaSchemaAnalyzer | null;
    /** Wrap a HandlerFunction into an Express-compatible handler. */
    wrapHandler(handler: HandlerFunction, serialize?: ResponseSerializer<any>): RequestHandler;
    /** Wrap a MiddlewareHandlerFunction into Express-compatible middleware. */
    wrapMiddleware(handler: MiddlewareHandlerFunction): RequestHandler;
    /** OpenAPI documentation registration helper. */
    registerDocumentation(method: string, path: string, config: any): void;
}

/**
 * Implementation of an extension-registered router method. Receives the router
 * context plus the call-site arguments; the chaining wrapper added to the
 * prototype returns the router instance so calls remain fluent.
 */
export type RouterMethodImpl = (ctx: RouterContext, ...args: any[]) => void;

/**
 * Extract model names from a Prisma client type
 * (prisma client에서 사전에 정의된 것들)
 */
type ExtractModelNames<T> = T extends { [K in keyof T]: any }
  ? Exclude<keyof T, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends' | '$executeRaw' | '$executeRawUnsafe' | '$queryRaw' | '$queryRawUnsafe'> & string
  : never;

/**
 * Extract model type from Prisma client
 * 특정 데이터베이스와 모델명에 대한 실제 모델 타입을 추출
 */
type ExtractModelType<
  TDatabase extends DatabaseNamesUnion,
  TModel extends string
> = TDatabase extends keyof DatabaseClientMap
  ? DatabaseClientMap[TDatabase] extends { [K in TModel]: { create: (args: { data: infer TCreate }) => any } }
    ? TCreate
    : any
  : any;

/**
 * Extract model result type from Prisma client
 * 생성/수정 후 반환되는 모델 타입을 추출
 */
type ExtractModelResultType<
  TDatabase extends DatabaseNamesUnion,
  TModel extends string
> = TDatabase extends keyof DatabaseClientMap
  ? DatabaseClientMap[TDatabase] extends { [K in TModel]: { create: (...args: any[]) => Promise<infer TResult> } }
    ? TResult
    : any
  : any;

/**
 * Extract findMany args type from Prisma client
 * INDEX 훅에서 사용할 쿼리 옵션 타입을 추출
 */
type ExtractFindManyArgsType<
  TDatabase extends DatabaseNamesUnion,
  TModel extends string
> = TDatabase extends keyof DatabaseClientMap
  ? DatabaseClientMap[TDatabase] extends { [K in TModel]: { findMany: (args?: infer TArgs) => any } }
    ? TArgs
    : any
  : any;

/**
 * Extract findUnique args type from Prisma client
 * SHOW 훅에서 사용할 쿼리 옵션 타입을 추출
 */
type ExtractFindUniqueArgsType<
  TDatabase extends DatabaseNamesUnion,
  TModel extends string
> = TDatabase extends keyof DatabaseClientMap
  ? DatabaseClientMap[TDatabase] extends { [K in TModel]: { findUnique: (args: infer TArgs) => any } }
    ? TArgs
    : any
  : any;
  
/**
 * Get available model names for a specific database
 * (Prisma에서 정적으로 모델명만 추출하기 위한 타입)
 */
type ModelNamesFor<T extends DatabaseNamesUnion> = T extends keyof DatabaseClientMap
  ? ExtractModelNames<DatabaseClientMap[T]>
  : never;

// Re-export from middlewareHelpers for convenience
export {
    MiddlewareHandlerFunction as MiddlewareHandler,
    ValidatedMiddlewareHandlerFunction as ValidatedMiddlewareHandler,
    wrapMiddleware,
    wrapValidatedMiddleware,
    wrapMiddlewares,
    wrapValidatedMiddlewares,
    injectedMiddleware
} from '@lib/http/routing/middlewareHelpers';

// 내부 위임용 value import (P1-10b: private wrapMiddleware 가 단일 출처에 위임)
import { wrapMiddleware } from '@lib/http/routing/middlewareHelpers';
import { JSON_API_CONTENT_TYPE, JSON_API_ATOMIC_CONTENT_TYPE } from '@lib/crud/jsonApiConstants';




import { ErrorHandler, ErrorResponseFormat } from '@lib/http/errors/errorHandler';
import { CrudRouteBuilder } from '@lib/crud/crudRouteBuilder';

/** 라우트에 선택적으로 붙이는 OpenAPI 문서 메타데이터(verb 옵션 인자로 전달). */
export interface RouteDocOptions {
    /** Swagger operation summary(한 줄 요약). 미지정 시 "<METHOD> <path>". */
    summary?: string;
    /** 상세 설명(Markdown 가능). */
    description?: string;
    /** Swagger 그룹 태그. 미지정 시 생성자 기본 태그 > 경로 자동 파생 순으로 적용. */
    tags?: string[];
    /** operationId 직접 지정. 미지정 시 메서드+경로에서 자동 생성. */
    operationId?: string;
    /** deprecated 표시. */
    deprecated?: boolean;
}

export class ExpressRouter {
    public router = Router();
    // CrudRouteBuilder(CRUD 엔진)가 컨텍스트로 접근하므로 public.
    public basePath: string = '';
    /** 생성자에서 지정한 파일 기본 태그(라우트가 tags 를 안 주면 적용). */
    private defaultTag?: string;
    private pendingDocumentation: Array<{
        method: string;
        path: string;
        requestConfig?: RequestConfig;
        responseConfig?: ResponseConfig;
        contentType?: 'json' | 'jsonapi';
        summary?: string;
        description?: string;
        tags?: string[];
        operationId?: string;
        deprecated?: boolean;
    }> = [];

    // 스키마 API 관련 인스턴스들 (개발 모드에서만 사용)
    // CrudRouteBuilder(CRUD 엔진)가 컨텍스트로 접근하므로 public.
    public schemaRegistry: CrudSchemaRegistry;
    public schemaAnalyzer: PrismaSchemaAnalyzer | null = null;

    // 데이터베이스별 초기화 상태 추적 (정적 변수)
    private static initializedDatabases: Set<string> = new Set();

    /**
     * @param options.tag 이 라우터(파일)의 모든 라우트에 적용할 기본 Swagger 그룹 태그.
     *                    개별 라우트가 tags 를 지정하면 그쪽이 우선한다.
     * @param options.description 위 태그의 설명(Swagger 그룹 헤더에 표시).
     */
    constructor(options?: { tag?: string; description?: string }) {
        this.defaultTag = options?.tag;
        if (options?.tag && options?.description) {
            DocumentationGenerator.registerTag(options.tag, options.description);
        }
        this.schemaRegistry = CrudSchemaRegistry.getInstance();
        // 비동기 초기화는 별도로 처리
        this.initializeSchemaAnalyzer().catch(error => {
            log.Error('Failed to initialize schema analyzer:', error);
        });
    }

    /**
     * 스키마 분석기를 초기화합니다 (개발 모드에서만)
     * 각 데이터베이스별로 1번씩만 실행됩니다.
     */
    private async initializeSchemaAnalyzer(): Promise<void> {
        if (!this.schemaRegistry.isSchemaApiEnabled()) {
            return; // 개발 모드가 아니면 초기화하지 않음
        }

        try {
            // 사용 가능한 모든 데이터베이스를 확인
            const availableDatabases = prismaManager.getAvailableDatabases();
            
            if (availableDatabases.length === 0) {
                log.Warn('No available Prisma clients. Cannot initialize schema analyzer.');
                return;
            }

            // 각 데이터베이스별로 한 번씩만 초기화
            for (const databaseName of availableDatabases) {
                // 이미 초기화된 데이터베이스는 건너뛰기
                if (ExpressRouter.initializedDatabases.has(databaseName)) {
                    continue;
                }

                const prismaClient = await prismaManager.getClient(databaseName);
                if (prismaClient) {
                    // 각 데이터베이스별로 분석기 생성 (싱글톤이므로 중복 생성되지 않음)
                    const analyzer = PrismaSchemaAnalyzer.getInstance(prismaClient, databaseName);
                    
                    // 모든 모델을 자동으로 등록
                    this.schemaRegistry.autoRegisterAllModels(analyzer, databaseName);

                    // Documentation 시스템에도 sync (NEW)
                    syncSchemasFromAnalyzer(analyzer, databaseName);

                    // 초기화 완료 표시
                    ExpressRouter.initializedDatabases.add(databaseName);
                }
            }

            // JsonApiError 는 DB 와 무관 — 루프 밖에서 한 번 (NEW)
            registerJsonApiErrorSchema();

            // 첫 번째 사용 가능한 데이터베이스를 기본 분석기로 설정
            const firstDatabase = availableDatabases[0];
            const firstClient = await prismaManager.getClient(firstDatabase);
            if (firstClient && !this.schemaAnalyzer) {
                this.schemaAnalyzer = PrismaSchemaAnalyzer.getInstance(firstClient, firstDatabase);
            }
        } catch (error) {
            log.Warn('Failed to initialize schema analyzer:', error instanceof Error ? error.message : String(error));
        }
    }
    

    /**
     * MiddlewareHandlerFunction을 Express 호환 미들웨어로 래핑하는 헬퍼 메서드.
     * P1-10b: 중복 제거 — 로직은 단일 출처(middlewareHelpers.wrapMiddleware)에 위임한다.
     */
    // CrudRouteBuilder(CRUD 엔진)가 컨텍스트로 접근하므로 public.
    public wrapMiddleware(handler: MiddlewareHandlerFunction): RequestHandler {
        return wrapMiddleware(handler);
    }

    /**
     * HandlerFunction을 Express 호환 핸들러로 래핑하는 헬퍼 메서드
     */    
    // CrudRouteBuilder(CRUD 엔진)가 컨텍스트로 접근하므로 public.
    public wrapHandler(
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => any,
        serialize?: ResponseSerializer<any>
    ): RequestHandler {
        return async (req: Request, res: Response, next: NextFunction) => {
            try {
                // Dependency injector에서 모든 injectable 모듈 가져오기
                const injected = DependencyInjector.getInstance().getInjectedModules();
                const result = await handler(req, res, injected, repositoryManager, prismaManager);
                // serialize 지정 시에만 반환값을 정제해 전송(미지정 시 기존 동작 유지).
                if (serialize && !res.headersSent && result !== undefined) {
                    res.json(await applyResponseSerializer(result, serialize, req));
                }
            } catch (error) {
                next(error);
            }
        };
    }

    /** 정확 경로 매칭용 미들웨어: 세그먼트 수가 slug 길이와 정확히 일치할 때만 통과. */
    private makeExactMatchMiddleware(slug: string[]): RequestHandler {
        return (req: Request, res: Response, next: NextFunction) => {
            const pathParts = req.path.split('/').filter(Boolean);
            if (pathParts.length === slug.length) { next(); } else { next('route'); }
        };
    }

    /**
     * 스택 트레이스를 이용하여 호출자의 파일 위치 정보를 추출하는 헬퍼 메서드
     * @returns 파일 경로와 라인 번호 정보가 포함된 객체
     */
    private getCallerSourceInfo(): { filePath: string; lineNumber?: number } {
        const stack = new Error().stack;
        let filePath = 'Unknown';
        let lineNumber: number | undefined;

        // 스택 추적에서 호출자 파일 경로 추출
        if (stack) {
            const stackLines = stack.split('\n');
            // 첫 번째 줄은 현재 함수, 두 번째 줄은 이 함수를 호출한 메서드, 세 번째 줄이 실제 사용자 코드의 호출자
            const callerLine = stackLines[3] || '';

            // Windows 경로(드라이브 문자 포함)와 일반 경로 모두 처리할 수 있는 정규식
            const fileMatch = callerLine.match(/\(([a-zA-Z]:\\[^:]+|\/?[^:]+):(\d+):(\d+)\)/) ||
                callerLine.match(/at\s+([a-zA-Z]:\\[^:]+|\/?[^:]+):(\d+):(\d+)/);

            if (fileMatch) {
                filePath = fileMatch[1];
                lineNumber = parseInt(fileMatch[2], 10);
            }
        }

        return { filePath, lineNumber };
    }

    /**
     * Set the base path context for documentation
     */
    public setBasePath(path: string): ExpressRouter {
        this.basePath = path.endsWith('/') ? path.slice(0, -1) : path;

        // 지연된 문서들을 올바른 경로로 등록
        this.registerPendingDocumentation();

        return this;
    }


    /**
     * Register all pending documentation with correct base path
     */
    private registerPendingDocumentation(): void {
        for (const doc of this.pendingDocumentation) {
            const fullPath = this.getFullPath(doc.path);
            DocumentationGenerator.registerRoute({
                method: doc.method,
                path: fullPath,
                contentType: doc.contentType,
                ...(doc.summary !== undefined ? { summary: doc.summary } : {}),
                ...(doc.description !== undefined ? { description: doc.description } : {}),
                ...(doc.operationId !== undefined ? { operationId: doc.operationId } : {}),
                ...(doc.deprecated !== undefined ? { deprecated: doc.deprecated } : {}),
                ...(doc.tags !== undefined ? { tags: doc.tags } : {}),
                parameters: {
                    query: doc.requestConfig?.query,
                    params: doc.requestConfig?.params,
                    body: doc.requestConfig?.body
                },
                responses: doc.responseConfig
            });
        }
        // 등록 완료 후 임시 저장소 비우기
        this.pendingDocumentation = [];
    }

    /**
     * 라우트 문서 등록 일원화. basePath 설정 여부에 따라 즉시/지연 등록을 한 곳에서 처리하고,
     * 옵션의 doc 메타(summary/description/tags/operationId/deprecated)를 양쪽 경로 모두에 반영한다.
     * (이전엔 ~30개 메서드가 if(basePath)/else 블록을 복제했고, 지연 경로는 doc 메타를 흘렸다.)
     * tags 우선순위: 라우트 옵션 tags > 생성자 기본 태그 > (미지정 시 빌드 단계에서 경로 자동 파생).
     */
    private registerRouteDoc(
        method: string,
        localPath: string,
        base: {
            requestConfig?: RequestConfig;
            responseConfig?: ResponseConfig;
            contentType?: 'json' | 'jsonapi';
            defaultSummary?: string;
        },
        options?: RouteDocOptions
    ): void {
        const summary = options?.summary ?? base.defaultSummary;
        const tags = options?.tags ?? (this.defaultTag ? [this.defaultTag] : undefined);
        const doc = {
            ...(summary !== undefined ? { summary } : {}),
            ...(options?.description !== undefined ? { description: options.description } : {}),
            ...(options?.operationId !== undefined ? { operationId: options.operationId } : {}),
            ...(options?.deprecated !== undefined ? { deprecated: options.deprecated } : {}),
            ...(tags !== undefined ? { tags } : {}),
        };

        if (this.basePath) {
            DocumentationGenerator.registerRoute({
                method,
                path: this.getFullPath(localPath),
                ...(base.contentType !== undefined ? { contentType: base.contentType } : {}),
                ...doc,
                parameters: {
                    query: base.requestConfig?.query,
                    params: base.requestConfig?.params,
                    body: base.requestConfig?.body,
                },
                responses: base.responseConfig,
            });
        } else {
            this.pendingDocumentation.push({
                method,
                path: localPath,
                requestConfig: base.requestConfig,
                responseConfig: base.responseConfig,
                contentType: base.contentType,
                ...doc,
            });
        }
    }

    /**
     * Get the full path by combining base path with local path
     */
    private getFullPath(localPath: string): string {
        if (!this.basePath) return localPath;
        if (localPath === '/') return this.basePath || '/';
        const fullPath = `${this.basePath}${localPath}`;
        return fullPath;
    }

    /**
     * # convertSlugsToPath - 슬러그를 경로로 변환하는 헬퍼
     * 슬러그 배열을 Express 경로 형식으로 변환
     * @param slugs - 슬러그 배열
     * @returns 변환된 경로 문자열
     */
    private convertSlugsToPath(slugs: string[]): string {
        const pathSegments = slugs.map(slug => slug === "*" ? "*" : `/:${slug}`);
        const path = pathSegments.join('');
        return path;
    }


    /**
   * # GET
   * @param handler 
   * @param options 
   * @returns 
   */
    public GET<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public GET(handler: HandlerFunction, options?: { serialize?: never } & RouteDocOptions): ExpressRouter;
    public GET(handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        this.router.get('/', this.wrapHandler(handler, serialize));

        this.registerRouteDoc('GET', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } }
        }, options);

        return this; // 메소드 체인을 위해 인스턴스 반환
    }

    /**
     * # GET_SLUG
     * @param slug 
     * @param handler 
     * @param options 
     * @returns
     * @description
     * - 라우터로 선언된 slug 직접 주워 받아야 합니다 
     * @example
     * ```typescript
     * router.GET_SLUG(["slug1", "slug2"],(req, res) => {
     *     res.send(`${req.params.slug1}`);
     * });
     * ```
     */
    public GET_SLUG<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public GET_SLUG(slug: string[], handler: HandlerFunction, options?: { serialize?: never } & RouteDocOptions): ExpressRouter;
    public GET_SLUG(slug: string[], handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        const slugPath = this.convertSlugsToPath(slug);
        this.router.get(slugPath, this.wrapHandler(handler, serialize));

        this.registerRouteDoc('GET', slugPath, {
            responseConfig: { 200: { data: { type: 'object', required: false } } }
        }, options);

        return this; // 메소드 체이닝을 위해 인스턴스 반환
    }


    /**
     * # POST
     * @param handler 
     * @param options 
     * @returns 
     */
    public POST<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public POST(handler: HandlerFunction, options?: { serialize?: never } & RouteDocOptions): ExpressRouter;
    public POST(handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        this.router.post('/', this.wrapHandler(handler, serialize));

        this.registerRouteDoc('POST', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } }
        }, options);

        return this; // 메소드 체이닝을 위해 인스턴스 반환
    }


    /**
     * # POST_SLUG
     * @param slug 
     * @param handler 
     * @param options 
     * @returns 
     * @description
     * - 라우터로 선언된 slug 직접 주워 받아야 합니다 
     */
    public POST_SLUG<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public POST_SLUG(slug: string[], handler: HandlerFunction, options?: { serialize?: never } & RouteDocOptions): ExpressRouter;
    public POST_SLUG(slug: string[], handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        const slugPath = this.convertSlugsToPath(slug);
        this.router.post(slugPath, this.wrapHandler(handler, serialize));

        this.registerRouteDoc('POST', slugPath, {
            responseConfig: { 200: { data: { type: 'object', required: false } } }
        }, options);

        return this; // 메소드 체이닝을 위해 인스턴스 반환
    }



    /**
     * ```
     * - multer 라이브러리
     * 파일 업로드를 위한 라우터 기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public POST_SINGLE_FILE(multerStorageEngine: multer.StorageEngine, keyName: string, handler: HandlerFunction, options?: {
        fileSize?: number
    } & RouteDocOptions): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize }, });
        const accpetFileType = upload.single(keyName);
        this.router.post('/', accpetFileType, this.wrapHandler(handler));

        this.registerRouteDoc('POST', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } },
            defaultSummary: `File upload: ${keyName}`
        }, options);

        return this;
    }



    /**
     * ```
     * - multer 라이브러리
     * 파일 업로드를 위한 라우터 기능
     * ```
     * @param multerStorageEngine
     * @param keyName
     * @param handler
     * @param options
     * @returns
     */
    public POST_ARRAY_FILE(multerStorageEngine: multer.StorageEngine, keyName: string, handler: HandlerFunction, maxFileCount?: number, options?: {
        fileSize?: number
    } & RouteDocOptions): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined; const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.array(keyName, maxFileCount);
        this.router.post('/', accpetFileType, this.wrapHandler(handler));

        this.registerRouteDoc('POST', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } },
            defaultSummary: `Multiple file upload: ${keyName}${maxFileCount ? ` (max: ${maxFileCount})` : ''}`
        }, options);

        return this;
    }


    /**
     * ```
     * - multer 라이브러리
     * 파일 업로드를 위한 라우터 기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public POST_FIELD_FILE(multerStorageEngine: multer.StorageEngine, fields: readonly multer.Field[], handler: HandlerFunction, options?: {
        fileSize?: number
    } & RouteDocOptions): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } }); const accpetFileType = upload.fields(fields);
        this.router.post('/', accpetFileType, this.wrapHandler(handler));

        this.registerRouteDoc('POST', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } },
            defaultSummary: `Multiple fields file upload`
        }, options);

        return this;
    }


    /**
     * ```
     * - multer 라이브러리
     * 파일 업로드를 위한 라우터 기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public POST_ANY_FILE(multerStorageEngine: multer.StorageEngine, handler: HandlerFunction, options?: {
        fileSize?: number
    } & RouteDocOptions): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.any();
        this.router.post('/', accpetFileType, this.wrapHandler(handler));

        this.registerRouteDoc('POST', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } },
            defaultSummary: `Any file upload`
        }, options);

        return this;
    }



    /**
     * # PUT
     * @param handler 
     * @param options 
     * @returns 
     */
    public PUT<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public PUT(handler: HandlerFunction, options?: { serialize?: never } & RouteDocOptions): ExpressRouter;
    public PUT(handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        this.router.put('/', this.wrapHandler(handler, serialize));

        this.registerRouteDoc('PUT', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } }
        }, options);

        return this;
    }


    /**
     * ```
     * - multer 라이브러리
     * 파일 업로드를 위한 라우터 기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public PUT_SINGLE_FILE(multerStorageEngine: multer.StorageEngine, keyName: string, handler: HandlerFunction, options?: {
        fileSize?: number
    } & RouteDocOptions): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize }, });
        const accpetFileType = upload.single(keyName);
        this.router.put('/', accpetFileType, this.wrapHandler(handler));

        this.registerRouteDoc('PUT', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } },
            defaultSummary: `File upload: ${keyName}`
        }, options);

        return this;
    }


    /**
     * ```
     * - multer 라이브러리
     * 파일 업로드를 위한 라우터 기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public PUT_ARRAY_FILE(multerStorageEngine: multer.StorageEngine, keyName: string, handler: HandlerFunction, maxFileCount?: number, options?: {
        fileSize?: number
    } & RouteDocOptions): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.array(keyName, maxFileCount);
        this.router.put('/', accpetFileType, this.wrapHandler(handler));

        this.registerRouteDoc('PUT', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } },
            defaultSummary: `Multiple file upload: ${keyName}${maxFileCount ? ` (max: ${maxFileCount})` : ''}`
        }, options);

        return this;
    }



    /**
     * ```
     * - multer 라이브러리
     * 파일 업로드를 위한 라우터 기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public PUT_FIELD_FILE(multerStorageEngine: multer.StorageEngine, fields: readonly multer.Field[], handler: HandlerFunction, options?: {
        fileSize?: number
    } & RouteDocOptions): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.fields(fields);
        this.router.put('/', accpetFileType, this.wrapHandler(handler));

        this.registerRouteDoc('PUT', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } },
            defaultSummary: `Multiple fields file upload`
        }, options);

        return this;
    }





    /**
     * ```
     * - multer 라이브러리
     * 파일 업로드를 위한 라우터 기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public PUT_ANY_FILE(multerStorageEngine: multer.StorageEngine, handler: HandlerFunction, options?: {
        fileSize?: number
    } & RouteDocOptions): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.any();
        this.router.put('/', accpetFileType, this.wrapHandler(handler));

        this.registerRouteDoc('PUT', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } },
            defaultSummary: `Any file upload`
        }, options);

        return this;
    }




    /**
     * # PUT_SLUG
     * @param slug 
     * @param handler 
     * @param options 
     * @returns 
     * @description
     * - 라우터로 선언된 slug 직접 주워 받아야 합니다 
     */
    public PUT_SLUG<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public PUT_SLUG(slug: string[], handler: HandlerFunction, options?: { serialize?: never } & RouteDocOptions): ExpressRouter;
    public PUT_SLUG(slug: string[], handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        const slugPath = this.convertSlugsToPath(slug);
        this.router.put(slugPath, this.wrapHandler(handler, serialize));

        this.registerRouteDoc('PUT', slugPath, {
            responseConfig: { 200: { data: { type: 'object', required: false } } }
        }, options);

        return this;
    }




    /**
     * # DELETE
     * @param handler 
     * @param options 
     * @returns
     * - http delete 요청을 처리하는 메서드입니다. 
     */
    public DELETE<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public DELETE(handler: HandlerFunction, options?: { serialize?: never } & RouteDocOptions): ExpressRouter;
    public DELETE(handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        this.router.delete('/', this.wrapHandler(handler, serialize));

        this.registerRouteDoc('DELETE', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } }
        }, options);

        return this;
    }




    /**
     * # DELETE_SLUG
     * @param slug 
     * @param handler 
     * @param options 
     * @returns 
     * @description
     * - 라우터로 선언된 slug 직접 주워 받아야 합니다 
     */
    public DELETE_SLUG<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public DELETE_SLUG(slug: string[], handler: HandlerFunction, options?: { serialize?: never } & RouteDocOptions): ExpressRouter;
    public DELETE_SLUG(slug: string[], handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        const slugPath = this.convertSlugsToPath(slug);
        this.router.delete(slugPath, this.wrapHandler(handler, serialize));

        this.registerRouteDoc('DELETE', slugPath, {
            responseConfig: { 200: { data: { type: 'object', required: false } } }
        }, options);

        return this;
    }





    /**
     * # PATCH
     * @param handler 
     * @param options 
     * @returns 
     */
    public PATCH<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public PATCH(handler: HandlerFunction, options?: { serialize?: never } & RouteDocOptions): ExpressRouter;
    public PATCH(handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        this.router.patch('/', this.wrapHandler(handler, serialize));

        this.registerRouteDoc('PATCH', '/', {
            responseConfig: { 200: { data: { type: 'object', required: false } } }
        }, options);

        return this;
    }





    /**
     * # PATCH_SLUG
     * @param slug 
     * @param handler 
     * @param options 
     * @returns 
     * @description
     * - 라우터로 선언된 slug 직접 주워 받아야 합니다 
     */
    public PATCH_SLUG<R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        handler: (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public PATCH_SLUG(slug: string[], handler: HandlerFunction, options?: { serialize?: never } & RouteDocOptions): ExpressRouter;
    public PATCH_SLUG(slug: string[], handler: any, options?: any): ExpressRouter {
        const serialize = (options as { serialize?: ResponseSerializer<any> } | undefined)?.serialize;
        const slugPath = this.convertSlugsToPath(slug);
        this.router.patch(slugPath, this.wrapHandler(handler, serialize));

        this.registerRouteDoc('PATCH', slugPath, {
            responseConfig: { 200: { data: { type: 'object', required: false } } }
        }, options);

        return this;
    }




    /**
     * # NOTFOUND
     * @param handler 
     * @param options 
     * @returns 
     */
    public NOTFOUND(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.all('*', this.wrapHandler(handler));
        return this;
    }





    /**
     * 미들웨어를 적용하는 메서드
     * @param middleware 미들웨어 함수 또는 미들웨어 함수의 배열
     * @returns ExpressRouter 인스턴스
     */
    public USE(middleware: RequestHandler | RequestHandler[]): ExpressRouter {
        if (Array.isArray(middleware)) {
            middleware.forEach((mw) => this.router.use(mw));
        } else {
            this.router.use(middleware);
        }
        return this; // 메소드 체인을 위해 인스턴스 반환
    }    
    



    
    /**
     * HandlerFunction 타입의 미들웨어를 적용하는 메서드
     * @param middleware HandlerFunction 타입의 미들웨어 함수 또는 배열
     * @returns ExpressRouter 인스턴스
     * @deprecated 보통의 경우 `MIDDLEWARE` 또는 `USE` 를 사용한다. 이 메서드는 거의 쓸 일이 없다 (미들웨어에서는 next 함수가 없으므로 다음으로 넘어가지 못한다).
     */
    public USE_HANDLER(middleware: HandlerFunction | HandlerFunction[]): ExpressRouter {
        if (Array.isArray(middleware)) {
            middleware.forEach((mw) => this.router.use(this.wrapHandler(mw)));
        } else {
            this.router.use(this.wrapHandler(middleware));
        }
        return this; // 메소드 체인을 위해 인스턴스 반환
    }
    


    
    /**
     * MiddlewareHandlerFunction 타입의 미들웨어를 적용하는 메서드
     * @param middleware MiddlewareHandlerFunction 타입의 미들웨어 함수 또는 배열
     * @returns ExpressRouter 인스턴스
     * 
     * @example
     * ```typescript
     * // 일반 함수 (호이스트 지원)
     * router.MIDDLEWARE(function(req, res, next, injected, repo, db) {
     *     // 미들웨어 로직
     * });
     * 
     * // 화살표 함수 (호이스트 미지원)
     * router.MIDDLEWARE((req, res, next, injected, repo, db) => {
     *     // 미들웨어 로직
     * } as MiddlewareHandlerFunction);
     * 
     * // 배열로 여러 개의 미들웨어를 적용할 수도 있습니다. 이 경우는 화살표 함수든 호이스트든 지원합니다.
     * router.MIDDLEWARE([
     *  (req, res, next, injected, repo, db) => {
     *  
     *  }
     * ])
     * 
     * 
     * ```
     */
    public MIDDLEWARE(middleware: MiddlewareHandlerFunction): ExpressRouter;
    public MIDDLEWARE(middleware: MiddlewareHandlerFunction[]): ExpressRouter;
    public MIDDLEWARE(middleware: MiddlewareHandlerFunction | MiddlewareHandlerFunction[]): ExpressRouter {
        if (Array.isArray(middleware)) {
            middleware.forEach((mw) => this.router.use(this.wrapMiddleware(mw)));
        } else {
            this.router.use(this.wrapMiddleware(middleware));
        }
        return this; // 메소드 체인을 위해 인스턴스 반환
    }    
    


    /**
     * Injectable 미들웨어를 적용하는 메서드
     * 
     * 사용 예시:
     * - 파라미터 없이: router.WITH('authNoLoginOnly')
     * - 파라미터와 함께: router.WITH('rateLimiterDefault', { repositoryName: 'test', maxRequests: 10, windowMs: 60000 })
     * 
     * @param middlewareName 미들웨어 이름
     * @param params 미들웨어에 전달할 파라미터 (미들웨어에 따라 자동 결정)
     * @returns ExpressRouter 인스턴스
     */

    public WITH<T extends MiddlewareName>(
        middlewareName: T
    ): ExpressRouter;

    public WITH<T extends MiddlewareName>(
        middlewareName: T,
        ...args: T extends keyof typeof MIDDLEWARE_PARAM_MAPPING 
            ? [params: MiddlewareParams[typeof MIDDLEWARE_PARAM_MAPPING[T]]]
            : [params?: never]
    ): ExpressRouter;

    public WITH<T extends MiddlewareName>(
        middlewareName: T,
        params?: T extends keyof typeof MIDDLEWARE_PARAM_MAPPING 
            ? MiddlewareParams[typeof MIDDLEWARE_PARAM_MAPPING[T]]
            : never
    ): ExpressRouter {

        try {
            const injector = DependencyInjector.getInstance();
            const middlewareInstance = injector.getMiddleware(middlewareName);
            

            if (!middlewareInstance) {
                throw new Error(`Middleware '${middlewareName}' not found in dependency injector`);
            }            
            
            // 미들웨어 이름을 파라미터 키로 변환하는 헬퍼 함수 (정적 매핑 적용)
            const getParameterKey = (middlewareName: string): string => {
                // 정적 매핑에서 파라미터 키 조회
                return MIDDLEWARE_PARAM_MAPPING[middlewareName as keyof typeof MIDDLEWARE_PARAM_MAPPING] || middlewareName;
            };

            // 미들웨어 인스턴스의 모든 메서드를 Express 미들웨어로 변환하여 적용
            if (typeof middlewareInstance === 'object' && middlewareInstance !== null) {
                
                // 미들웨어 객체의 메서드들을 순회하고 Express 미들웨어로 래핑
                Object.keys(middlewareInstance).forEach(methodName => {
                    const method = (middlewareInstance as any)[methodName];
                    if (typeof method === 'function') {
                        // 각 메서드를 미들웨어로 래핑하여 라우터에 적용
                        // 명시적 마커(injectedMiddleware)가 우선, 없으면 arity 휴리스틱 fallback (P2-13)
                        if ((method as any).__kustoInjected === true || method.length >= 6) {
                            // MiddlewareHandlerFunction 타입으로 판단되면 wrapMiddleware 적용
                            this.router.use(this.wrapMiddleware(method));
                        } else {
                            // 일반 Express 미들웨어
                            this.router.use((req: Request, res: Response, next: NextFunction) => {
                                try {
                                    // Kusto 매니저를 Request 객체에 설정
                                    req.kusto = kustoManager;
                                    
                                    // 파라미터가 있다면 req 객체에 추가
                                    if (params) {
                                        const parameterKey = getParameterKey(middlewareName);
                                        (req as any).with = { 
                                            ...(req as any).with, 
                                            [parameterKey]: params 
                                        };
                                    }
                                    method(req, res, next);
                                } catch (error) {
                                    next(error);
                                }
                            });
                        }
                    }
                });            
            
            } else if (typeof middlewareInstance === 'function') {
               
                // 미들웨어가 직접 함수인 경우
                // 명시적 마커(injectedMiddleware)가 우선, 없으면 arity 휴리스틱 fallback (P2-13)
                if ((middlewareInstance as any).__kustoInjected === true || (middlewareInstance as Function).length >= 6) {
                    // MiddlewareHandlerFunction 타입으로 판단되면 wrapMiddleware 적용
                    this.router.use(this.wrapMiddleware(middlewareInstance as MiddlewareHandlerFunction));
                } else {
                    // 일반 Express 미들웨어
                    this.router.use((req: Request, res: Response, next: NextFunction) => {
                        try {
                            // Kusto 매니저를 Request 객체에 설정
                            req.kusto = kustoManager;
                            
                            // 파라미터가 있다면 req 객체에 추가
                            if (params) {
                                const parameterKey = getParameterKey(middlewareName);
                                (req as any).with = { 
                                    ...(req as any).with, 
                                    [parameterKey]: params 
                                };
                            }
                            (middlewareInstance as any)(req, res, next);
                        } catch (error) {
                            next(error);
                        }
                    });
                }
            }

            return this;
            
        } catch (error) {
            log.Error(`Error applying middleware '${middlewareName}':`, error);
            throw error;
        }
    }


    /**
     * # MIDDLE_PROXY_ROUTE
     * @param options - 자체 프록시 옵션(`ProxyOptions`: target, changeOrigin, pathRewrite, headers, secure, timeout, onProxyReq/onProxyRes/onError)
     * @description
     * - Express 라우터에 등록할 미들웨어를 추가합니다
     */
    public MIDDLE_PROXY_ROUTE(options: ProxyOptions) {
        this.router.use("/", createProxyMiddleware(options));
    }



    /**
     * # MIDDLE_PROXY_ROUTE_SLUG
     * @param slug - 슬러그 배열
     * @param options - 자체 프록시 옵션(`ProxyOptions`: target, changeOrigin, pathRewrite, headers, secure, timeout, onProxyReq/onProxyRes/onError)
     * @description
     * - Express 라우터에 등록할 미들웨어를 추가합니다
     */
    public MIDDLE_PROXY_ROUTE_SLUG(slug: string[], options: ProxyOptions) {
        this.router.use(this.convertSlugsToPath(slug), createProxyMiddleware(options));
    }

    /**
     * # STATIC
     * @param staticPath - 정적 파일을 서비스할 물리적 경로
     * @param options - express.static 옵션
     * @description
     * - Express의 정적 파일 서비스 미들웨어를 라우트 루트(/)에 추가합니다
     */
    public STATIC(staticPath: string, options?: any): ExpressRouter {
        this.router.use('/', static_(staticPath, options));
        return this;
    }

    /**
     * # STATIC_SLUG
     * @param slug - 슬러그 배열 (URL 경로)
     * @param staticPath - 정적 파일을 서비스할 물리적 경로
     * @param options - express.static 옵션
     * @description
     * - Express의 정적 파일 서비스 미들웨어를 지정 경로에 추가합니다
     */
    public STATIC_SLUG(slug: string[], staticPath: string, options?: any): ExpressRouter {
        const slugPath = this.convertSlugsToPath(slug);
        this.router.use(slugPath, static_(staticPath, options));
        return this;
    }


    /**
     * # GET_VALIDATED
     * 검증된 GET 요청 처리
     * @param requestConfig 요청 검증 설정
     * @param responseConfig 응답 검증 설정
     * @param handler 핸들러 함수
     * @returns ExpressRouter
     */

    /**
     * # GET_VALIDATED
     * 검증된 GET 요청 처리
     */
    public GET_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public GET_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: never } & RouteDocOptions
    ): ExpressRouter;
    public GET_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: ResponseSerializer<any> } & RouteDocOptions
    ): ExpressRouter {
        // 현재 위치 정보를 얻기 위해 Error 스택 추적
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                serialize: options?.serialize,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );
        this.router.get('/', ...middlewares);

        this.registerRouteDoc('GET', '/', {
            requestConfig,
            responseConfig
        }, options);

        return this;
    }






    /**
     * # GET_SLUG_VALIDATED
     * 검증된 GET 슬러그 요청 처리
     * @param exact true이면 하위 경로 매칭 방지 (기본값 false)
     */
    public GET_SLUG_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { exact?: boolean; serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public GET_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean } & RouteDocOptions
    ): ExpressRouter;
    public GET_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean; serialize?: ResponseSerializer<any> } & RouteDocOptions
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                serialize: options?.serialize,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );
        const slugPath = this.convertSlugsToPath(slug);

        this.registerRouteDoc('GET', slugPath, {
            requestConfig,
            responseConfig
        }, options);

        if (options?.exact) {
            // 정확한 매칭: 하위 경로에 영향을 주지 않음
            this.router.get(slugPath, this.makeExactMatchMiddleware(slug), ...middlewares);
        } else {
            // 기본 동작: 하위 경로도 매칭
            this.router.get(slugPath, ...middlewares);
        }

        return this;
    }






    /**
     * # POST_VALIDATED
     * 검증된 POST 요청 처리
     */
    public POST_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public POST_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: never } & RouteDocOptions
    ): ExpressRouter;
    public POST_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: ResponseSerializer<any> } & RouteDocOptions
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                serialize: options?.serialize,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        ); this.router.post('/', ...middlewares);

        this.registerRouteDoc('POST', '/', {
            requestConfig,
            responseConfig
        }, options);

        return this;
    }






    /**
     * # POST_SLUG_VALIDATED
     * 검증된 POST 슬러그 요청 처리
     * @param exact true이면 하위 경로 매칭 방지 (기본값 false)
     */    
    public POST_SLUG_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { exact?: boolean; serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public POST_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean } & RouteDocOptions
    ): ExpressRouter;
    public POST_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean; serialize?: ResponseSerializer<any> } & RouteDocOptions
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                serialize: options?.serialize,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );


        const slugPath = this.convertSlugsToPath(slug);

        this.registerRouteDoc('POST', slugPath, {
            requestConfig,
            responseConfig
        }, options);

        if (options?.exact) {
            this.router.post(slugPath, this.makeExactMatchMiddleware(slug), ...middlewares);
        } else {
            this.router.post(slugPath, ...middlewares);
        }

        return this;
    }






    /**
     * # PUT_VALIDATED
     * 검증된 PUT 요청 처리
     */    
    public PUT_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public PUT_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: never } & RouteDocOptions
    ): ExpressRouter;
    public PUT_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: ResponseSerializer<any> } & RouteDocOptions
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                serialize: options?.serialize,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );

        this.router.put('/', ...middlewares);

        this.registerRouteDoc('PUT', '/', {
            requestConfig,
            responseConfig
        }, options);

        return this;
    }






    /**
     * # DELETE_VALIDATED
     * 검증된 DELETE 요청 처리
     */    
    public DELETE_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public DELETE_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: never } & RouteDocOptions
    ): ExpressRouter;
    public DELETE_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: ResponseSerializer<any> } & RouteDocOptions
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                serialize: options?.serialize,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        ); this.router.delete('/', ...middlewares);

        this.registerRouteDoc('DELETE', '/', {
            requestConfig,
            responseConfig
        }, options);

        return this;
    }






    /**
     * # PATCH_VALIDATED
     * 검증된 PATCH 요청 처리
     */    
    public PATCH_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public PATCH_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: never } & RouteDocOptions
    ): ExpressRouter;
    public PATCH_VALIDATED<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { serialize?: ResponseSerializer<any> } & RouteDocOptions
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                serialize: options?.serialize,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );


        this.router.patch('/', ...middlewares);

        this.registerRouteDoc('PATCH', '/', {
            requestConfig,
            responseConfig
        }, options);

        return this;
    }

    /**
     * # PATCH_SLUG_VALIDATED
     * 검증된 PATCH 슬러그 요청 처리
     * @param exact true이면 하위 경로 매칭 방지 (기본값 false)
     */
    public PATCH_SLUG_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { exact?: boolean; serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public PATCH_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean } & RouteDocOptions
    ): ExpressRouter;
    public PATCH_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean; serialize?: ResponseSerializer<any> } & RouteDocOptions
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                serialize: options?.serialize,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );
        const slugPath = this.convertSlugsToPath(slug);

        this.registerRouteDoc('PATCH', slugPath, {
            requestConfig,
            responseConfig
        }, options);

        if (options?.exact) {
            // 정확한 매칭: 하위 경로에 영향을 주지 않음
            this.router.patch(slugPath, this.makeExactMatchMiddleware(slug), ...middlewares);
        } else {
            // 기본 동작: 하위 경로도 매칭
            this.router.patch(slugPath, ...middlewares);
        }

        return this;
    }

    /**
     * # PATCH_SLUG_VALIDATED_EXACT
     * 검증된 PATCH 슬러그 요청 처리 (정확한 경로 매칭)
     */
    public PATCH_SLUG_VALIDATED_EXACT<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter {
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );

        const exactPath = this.convertSlugsToPath(slug);
        this.router.patch(new RegExp(`^${exactPath.replace(/:\w+/g, '([^/]+)')}$`), ...middlewares);

        this.registerRouteDoc('PATCH', exactPath, {
            requestConfig,
            responseConfig
        });

        return this;
    }



    /**
     * # GET_WITH_VALIDATION
     * 요청 검증만 있는 GET
     */
    public GET_WITH_VALIDATION<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter {
        const middlewares = CustomRequestHandler.withValidation(requestConfig, handler);

        this.router.get('/', ...middlewares);

        this.registerRouteDoc('GET', '/', {
            requestConfig,
            responseConfig: { 200: { data: { type: 'object', required: false } } }
        });

        return this;
    }



    /**
     * # POST_WITH_VALIDATION
     * 요청 검증만 있는 POST
     */
    public POST_WITH_VALIDATION<TConfig extends RequestConfig>(
        requestConfig: TConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter {

        const middlewares = CustomRequestHandler.withValidation(requestConfig, handler);
        this.router.post('/', ...middlewares);

        this.registerRouteDoc('POST', '/', {
            requestConfig,
            responseConfig: { 200: { data: { type: 'object', required: false } } }
        });

        return this;
    }


    /**
     * # GET_SLUG_VALIDATED_EXACT
     * 검증된 GET 슬러그 요청 처리 (정확한 경로 매칭)
     * 하위 라우터에 영향을 주지 않음
     */
    public GET_SLUG_VALIDATED_EXACT<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter {

        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );

        // 정확한 경로 매칭을 위해 '$' 앵커 사용하는 대신 정규식 패턴으로 처리
        const exactPath = this.convertSlugsToPath(slug);
        this.router.get(new RegExp(`^${exactPath.replace(/:\w+/g, '([^/]+)')}$`), ...middlewares);

        this.registerRouteDoc('GET', exactPath, {
            requestConfig,
            responseConfig
        });

        return this;
    }







    /**
     * # POST_SLUG_VALIDATED_EXACT
     * 검증된 POST 슬러그 요청 처리 (정확한 경로 매칭만)
     */
    public POST_SLUG_VALIDATED_EXACT<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter {
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );

        const exactPath = this.convertSlugsToPath(slug);

        this.router.post(new RegExp(`^${exactPath.replace(/:\w+/g, '([^/]+)')}$`), ...middlewares);

        this.registerRouteDoc('POST', exactPath, {
            requestConfig,
            responseConfig
        });

        return this;
    }

    /**
     * # PUT_SLUG_VALIDATED
     * 검증된 PUT 슬러그 요청 처리
     * @param exact true이면 하위 경로 매칭 방지 (기본값 false)
     */
    public PUT_SLUG_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { exact?: boolean; serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public PUT_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean } & RouteDocOptions
    ): ExpressRouter;
    public PUT_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean; serialize?: ResponseSerializer<any> } & RouteDocOptions
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                serialize: options?.serialize,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );
        const slugPath = this.convertSlugsToPath(slug);

        this.registerRouteDoc('PUT', slugPath, {
            requestConfig,
            responseConfig
        }, options);

        if (options?.exact) {
            // 정확한 매칭: 하위 경로에 영향을 주지 않음
            this.router.put(slugPath, this.makeExactMatchMiddleware(slug), ...middlewares);
        } else {
            // 기본 동작: 하위 경로도 매칭
            this.router.put(slugPath, ...middlewares);
        }

        return this;
    }

    /**
     * # PUT_SLUG_VALIDATED_EXACT
     * 검증된 PUT 슬러그 요청 처리 (정확한 경로 매칭)
     */
    public PUT_SLUG_VALIDATED_EXACT<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter {
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );


        const exactPath = this.convertSlugsToPath(slug);
        this.router.put(new RegExp(`^${exactPath.replace(/:\w+/g, '([^/]+)')}$`), ...middlewares);

        this.registerRouteDoc('PUT', exactPath, {
            requestConfig,
            responseConfig
        });

        return this;
    }

    /**
     * # DELETE_SLUG_VALIDATED
     * 검증된 DELETE 슬러그 요청 처리
     * @param exact true이면 하위 경로 매칭 방지 (기본값 false)
     */
    public DELETE_SLUG_VALIDATED<TConfig extends RequestConfig, R, const Sz extends ResponseSerializer<Awaited<R>>>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: (req: ValidatedRequest<TConfig>, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => R | Promise<R>,
        options: { exact?: boolean; serialize: Sz } & RouteDocOptions
    ): ExpressRouter;
    public DELETE_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean } & RouteDocOptions
    ): ExpressRouter;
    public DELETE_SLUG_VALIDATED<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>,
        options?: { exact?: boolean; serialize?: ResponseSerializer<any> } & RouteDocOptions
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                serialize: options?.serialize,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );
        const slugPath = this.convertSlugsToPath(slug);

        this.registerRouteDoc('DELETE', slugPath, {
            requestConfig,
            responseConfig
        }, options);

        if (options?.exact) {
            // 정확한 매칭: 하위 경로에 영향을 주지 않음
            this.router.delete(slugPath, this.makeExactMatchMiddleware(slug), ...middlewares);
        } else {
            // 기본 동작: 하위 경로도 매칭
            this.router.delete(slugPath, ...middlewares);
        }

        return this;
    }

    /**
     * # DELETE_SLUG_VALIDATED_EXACT
     * 검증된 DELETE 슬러그 요청 처리 (정확한 경로 매칭)
     */
    public DELETE_SLUG_VALIDATED_EXACT<TConfig extends RequestConfig>(
        slug: string[],
        requestConfig: TConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction<TConfig>
    ): ExpressRouter {
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );

        const exactPath = this.convertSlugsToPath(slug);
        this.router.delete(new RegExp(`^${exactPath.replace(/:\w+/g, '([^/]+)')}$`), ...middlewares);

        this.registerRouteDoc('DELETE', exactPath, {
            requestConfig,
            responseConfig
        });

        return this;
    }


    /**
     * CRUD 자동 생성 메서드
     * 완전한 REST API CRUD 엔드포인트를 자동으로 생성합니다
     * 
     * 생성되는 라우트:
     * - GET / (index) - 리스트 조회 with 필터링, 정렬, 페이지네이션
     * - GET /:identifier (show) - 단일 데이터 조회
     * - POST / (create) - 새로운 데이터 생성
     * - PUT /:identifier (update) - 데이터 전체 수정
     * - PATCH /:identifier (update) - 데이터 부분 수정  
     * - DELETE /:identifier (destroy) - 데이터 삭제
     * 
     * @param databaseName 사용할 데이터베이스 이름
     * @param modelName 대상 모델 이름 (복수형 변환을 위해 단수형 사용)
     * @param options CRUD 옵션 설정
     */
    public CRUD<
        T extends DatabaseNamesUnion,
        M extends ModelNamesFor<T> = ModelNamesFor<T>
    >(
        databaseName: T, 
        modelName: M,
        options?: {

            /** CRUD 액션 생성 및 설정 */
            only?: ('index' | 'show' | 'create' | 'update' | 'destroy' | 'recover')[];
            except?: ('index' | 'show' | 'create' | 'update' | 'destroy' | 'recover')[];


            /** Primary key 필드명 지정(기본값: 'id') */
            primaryKey?: string;


            /** Primary key 값 변환 파서 */
            primaryKeyParser?: (value: string) => any;


            /**
             * JSON:API 리소스 타입.
             * 기본값: 라우트 baseUrl 의 마지막 세그먼트 (없으면 `modelName.toLowerCase()`).
             */
            resourceType?: string;


            /**
             * includeMerge: true시 included 배열 attributes가 관계명으로 병합 (기본값: false)
             */
            includeMerge?: boolean;


            /**
             * 클라이언트 ?include= 의 최대 개수 (DoS 방지).
             * 미지정 시 무제한.
             */
            maxIncludeCount?: number;


            /**
             * 클라이언트 ?include= 한 항목의 최대 점 깊이 (예: a.b.c → 3).
             * 미지정 시 무제한.
             */
            maxIncludeDepth?: number;


            /**
             * 허용된 include 경로 화이트리스트.
             * 미지정 시 모든 관계 허용. 지정 시 목록에 없는 경로는 400 으로 거부.
             * 정확 일치 또는 허용 경로의 얕은 부분 경로(prefix)가 허용된다.
             */
            allowedIncludes?: string[];


            /**
             * 서버에서 항상 함께 로드할 관계 (eager-load).
             * 클라이언트 요청과 병합되며 정책 검증을 우회한다.
             *
             * NOTE: 클라이언트가 ?select= 를 보내면 Prisma 쿼리는 select 우선 정책으로
             *       include 가 무시된다 (PrismaQueryBuilder.buildFindManyOptions 참고).
             *       즉 select 사용 시 defaultIncludes 의 eager-load 효과는 보장되지 않는다.
             */
            defaultIncludes?: string[];


            /** Soft Delete 설정 */
            softDelete?: {
                enabled: boolean;
                field: string;
            };

            /** 미들웨어 */
            middleware?: {
                index?: MiddlewareHandlerFunction[];
                show?: MiddlewareHandlerFunction[];
                create?: MiddlewareHandlerFunction[];
                update?: MiddlewareHandlerFunction[];
                destroy?: MiddlewareHandlerFunction[];
                recover?: MiddlewareHandlerFunction[];
            };

            /** 요청 검증 설정 */
            validation?: {
                create?: RequestConfig;
                update?: RequestConfig;
                recover?: RequestConfig;
            };

            /** 훅 설정 */
            hooks?: {
                // 조회용 훅 (쿼리 조건 가공용)
                beforeIndex?: (queryOptions: ExtractFindManyArgsType<T, M>, req: Request) => Promise<ExtractFindManyArgsType<T, M>> | ExtractFindManyArgsType<T, M>;
                
                beforeShow?: (findOptions: ExtractFindUniqueArgsType<T, M>, req: Request) => Promise<ExtractFindUniqueArgsType<T, M>> | ExtractFindUniqueArgsType<T, M>;

                // 생성용 훅
                beforeCreate?: (data: ExtractModelType<T, M>, req: Request) => Promise<ExtractModelType<T, M>> | ExtractModelType<T, M>;
                afterCreate?: (result: ExtractModelResultType<T, M>, req: Request) => Promise<ExtractModelResultType<T, M>> | ExtractModelResultType<T, M>;

                // 수정용 훅
                beforeUpdate?: (data: Partial<ExtractModelType<T, M>>, req: Request) => Promise<Partial<ExtractModelType<T, M>>> | Partial<ExtractModelType<T, M>>;
                afterUpdate?: (result: ExtractModelResultType<T, M>, req: Request) => Promise<ExtractModelResultType<T, M>> | ExtractModelResultType<T, M>;

                // 삭제용 훅
                beforeDestroy?: (id: any, req: Request) => Promise<void> | void;
                afterDestroy?: (id: any, req: Request) => Promise<void> | void;

                // 복구용 훅
                beforeRecover?: (id: any, req: Request) => Promise<void> | void;
                afterRecover?: (result: ExtractModelResultType<T, M>, req: Request) => Promise<ExtractModelResultType<T, M>> | ExtractModelResultType<T, M>;
            };
        }
    ): ExpressRouter {
        // CRUD 엔진은 CrudRouteBuilder 로 분리됨(Step 3). ExpressRouter 는 컨텍스트로 위임만 한다.
        // `this` 가 CrudBuilderContext 를 구조적으로 만족한다.
        new CrudRouteBuilder(this as RouterContext).build(databaseName, modelName as string, options);

        return this;
    }

    /**
     * UUID 전용 파서 (검증 포함)
     * 순수 구현은 ./primaryKeyParsers 로 추출; 문서화된 public API 보존을 위해 정적 별칭 유지
     */
    public static parseUuid = parseUuidImpl;





    /**
     * 문자열 그대로 반환하는 파서
     * 순수 구현은 ./primaryKeyParsers 로 추출; 문서화된 public API 보존을 위해 정적 별칭 유지
     */
    public static parseString = parseStringImpl;





    /**
     * 정수 전용 파서 (검증 포함)
     * 순수 구현은 ./primaryKeyParsers 로 추출; 문서화된 public API 보존을 위해 정적 별칭 유지
     */
    public static parseInt = parseIntImpl;

    /**
     * 문서화 등록 헬퍼
     * CrudRouteBuilder(CRUD 엔진)가 컨텍스트로 접근하므로 public.
     */
    public registerDocumentation(method: string, path: string, config: any): void {
        // CRUD 엔드포인트도 생성자 기본 태그를 따른다(미지정 시 빌드 단계에서 경로 자동 파생).
        const tags = config.tags ?? (this.defaultTag ? [this.defaultTag] : undefined);
        if (this.basePath) {
            DocumentationGenerator.registerRoute({
                method,
                path: this.getFullPath(path),
                contentType: 'jsonapi',
                ...config,
                ...(tags !== undefined ? { tags } : {}),
            });
        } else {
            this.pendingDocumentation.push({
                method,
                path,
                requestConfig: config.parameters ? {
                    query: config.parameters.query,
                    params: config.parameters.params,
                    body: config.parameters.body
                } : undefined,
                responseConfig: config.responses,
                contentType: 'jsonapi',
                // 지연 경로에서도 summary/tags 등 doc 메타를 보존(이전엔 유실됨).
                ...(config.summary !== undefined ? { summary: config.summary } : {}),
                ...(config.description !== undefined ? { description: config.description } : {}),
                ...(config.operationId !== undefined ? { operationId: config.operationId } : {}),
                ...(config.deprecated !== undefined ? { deprecated: config.deprecated } : {}),
                ...(tags !== undefined ? { tags } : {}),
            });
        }
    }


    



    /** Extension-registered router methods (name -> impl), for collision/idempotency tracking. */
    private static registeredExtensionMethods: Map<string, RouterMethodImpl> = new Map();

    /** Constructor-assigned instance fields (the RouterContext surface) an extension method must not shadow. */
    private static readonly reservedInstanceFields: ReadonlySet<string> = new Set([
        'router', 'basePath', 'schemaRegistry', 'schemaAnalyzer',
    ]);

    /**
     * Register a new router method at runtime (used by the extension system).
     * Attaches a fluent wrapper to `ExpressRouter.prototype` so `router.<name>(...)`
     * delegates to `impl(routerContext, ...args)` and returns the router for chaining.
     *
     * Guards: re-registering the same name with the same impl is a no-op (safe under
     * reload); a different impl for an existing name, or any name that collides with a
     * built-in ExpressRouter member, throws.
     */
    public static registerMethod(name: string, impl: RouterMethodImpl): void {
        if (!name || typeof name !== 'string') {
            throw new Error('[kusto] registerMethod requires a non-empty method name.');
        }
        if (typeof impl !== 'function') {
            throw new Error(`[kusto] Router method '${name}' implementation must be a function (got ${typeof impl}).`);
        }
        const existing = ExpressRouter.registeredExtensionMethods.get(name);
        if (existing) {
            if (existing === impl) return; // idempotent
            throw new Error(`[kusto] Router method '${name}' is already registered by another extension.`);
        }
        // Reject both prototype members (verbs/build/CRUD/Object.prototype) and constructor-assigned
        // instance fields (router/basePath/...), which are not on the prototype at registration time.
        if (name in ExpressRouter.prototype || ExpressRouter.reservedInstanceFields.has(name)) {
            throw new Error(`[kusto] Router method '${name}' conflicts with a built-in ExpressRouter member.`);
        }
        ExpressRouter.registeredExtensionMethods.set(name, impl);
        (ExpressRouter.prototype as Record<string, any>)[name] = function (this: ExpressRouter, ...args: any[]) {
            impl(this as unknown as RouterContext, ...args);
            return this;
        };
    }

    /** Test-only: remove all extension-registered router methods (restores a clean prototype). */
    public static clearExtensionMethods(): void {
        for (const name of ExpressRouter.registeredExtensionMethods.keys()) {
            delete (ExpressRouter.prototype as Record<string, any>)[name];
        }
        ExpressRouter.registeredExtensionMethods.clear();
    }

    public build(): Router {
        const router = this.router;

        // ExpressRouter 인스턴스의 참조를 통해 setBasePath 호출이 가능하도록 함
        (router as any).setBasePath = (path: string) => {
            this.setBasePath(path);
            return router;
        };
        return router; // 최종 Express Router 인스턴스 반환
    }
}
