import { Router, Request, Response, RequestHandler, NextFunction, static as static_ } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import multer from 'multer';
import { DocumentationGenerator } from './documentationGenerator';
import { RequestHandler as CustomRequestHandler, RequestConfig, ResponseConfig, ValidatedRequest } from './requestHandler';
import { Injectable, MiddlewareName, MiddlewareParams, MIDDLEWARE_PARAM_MAPPING } from './types/generated-injectable-types';
import { DatabaseNamesUnion, DatabaseClientMap } from './types/generated-db-types';
import { DependencyInjector } from './dependencyInjector';
import { prismaManager } from '@lib/prismaManager'
import { repositoryManager } from '@lib/repositoryManager'
import { kustoManager } from '@lib/kustoManager'
import { CrudQueryParser, PrismaQueryBuilder, CrudResponseFormatter, JsonApiTransformer, JsonApiResponse, JsonApiResource, JsonApiRelationship, JsonApiErrorResponse } from './crudHelpers';
import { ErrorFormatter } from './errorFormatter';
import { serializeBigInt, serialize } from './serializer';
import { ERROR_CODES, getHttpStatusForErrorCode } from './errorCodes';
import './types/express-extensions';


export type HandlerFunction = (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => void;
export type ValidatedHandlerFunction = (req: ValidatedRequest, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => Promise<any> | any;
export type MiddlewareHandlerFunction = (req: Request, res: Response, next: NextFunction, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => void;
export type ValidatedMiddlewareHandlerFunction = (req: ValidatedRequest, res: Response, next: NextFunction, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => Promise<any> | any;

/**
 * Extract model names from a Prisma client type
 * (prisma client ?�서 ?�전???�의 것들)
 */
type ExtractModelNames<T> = T extends { [K in keyof T]: any }
  ? Exclude<keyof T, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends' | '$executeRaw' | '$executeRawUnsafe' | '$queryRaw' | '$queryRawUnsafe'> & string
  : never;

  
/**
 * Get available model names for a specific database
 * (Prisma ?�서 ?�적?�로 모델명만 추출?�기 ?�한 ?�??
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
    wrapValidatedMiddlewares
} from './middlewareHelpers';




import { ErrorHandler, ErrorResponseFormat } from './errorHandler';

export class ExpressRouter {
    public router = Router();
    private basePath: string = '';
    private pendingDocumentation: Array<{
        method: string;
        path: string;
        requestConfig?: RequestConfig;
        responseConfig?: ResponseConfig;
    }> = [];    
    

    /**
     * MiddlewareHandlerFunction??Express ?�환 미들?�어�??�핑?�는 ?�퍼 메서??
     */
    private wrapMiddleware(handler: MiddlewareHandlerFunction): RequestHandler {
        return (req: Request, res: Response, next: NextFunction) => {
            try {
                // Kusto 매니?��?Request 객체???�정
                req.kusto = kustoManager;
                
                // Dependency injector?�서 모든 injectable 모듈 가?�오�?
                const injected = DependencyInjector.getInstance().getInjectedModules();
                handler(req, res, next, injected, repositoryManager, prismaManager);
            } catch (error) {
                next(error);
            }
        };
    }

    /**
     * HandlerFunction??Express ?�환 ?�들?�로 ?�핑?�는 ?�퍼 메서??
     */    
    private wrapHandler(handler: HandlerFunction): RequestHandler {
        return (req: Request, res: Response, next) => {
            try {
                // Dependency injector?�서 모든 injectable 모듈 가?�오�?
                const injected = DependencyInjector.getInstance().getInjectedModules();
                handler(req, res, injected, repositoryManager, prismaManager);
            } catch (error) {
                next(error);
            }
        };
    }

    /**
     * ?�택 ?�레?�스�??�용?�여 ?�출?�의 ?�일 ?�치 ?�보�?추출?�는 ?�퍼 메서??
     * @returns ?�일 경로?� ?�인 번호 ?�보가 ?�함??객체
     */
    private getCallerSourceInfo(): { filePath: string; lineNumber?: number } {
        const stack = new Error().stack;
        let filePath = 'Unknown';
        let lineNumber: number | undefined;

        // ?�택 추적?�서 ?�출???�일 경로 추출
        if (stack) {
            const stackLines = stack.split('\n');
            // �?번째 줄�? ?�재 ?�수, ??번째 줄�? ???�수�??�출??메서?? ??번째 줄이 ?�제 ?�용??코드???�출??
            const callerLine = stackLines[3] || '';

            // Windows 경로(?�라?�브 문자 ?�함)?� ?�반 경로 모두 처리?????�는 ?�규??
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

        // 지?�된 문서?�을 ?�바�?경로�??�록
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
                parameters: {
                    query: doc.requestConfig?.query,
                    params: doc.requestConfig?.params,
                    body: doc.requestConfig?.body
                },
                responses: doc.responseConfig
            });
        }
        // ?�록 ?�료 ???�시 ?�?�소 비우�?
        this.pendingDocumentation = [];
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
     * # convertSlugsToPath - ?�러그�? 경로�?변?�하???�퍼
     * ?�러�?배열??Express 경로 ?�식?�로 변??
     * @param slugs - ?�러�?배열
     * @returns 변?�된 경로 문자??
     */
    private convertSlugsToPath(slugs: string[]): string {
        const pathSegments = slugs.map(slug => slug === "*" ? "*" : `/:${slug}`);
        const path = pathSegments.join('');
        return path;
    }

    /**
     * # convertSlugsToExactPath - ?�확??경로 매칭???�퍼
     * ?�위 경로 매칭??방�??�기 ?�한 ?�확??경로 ?�성
     */
    // private convertSlugsToExactPath(slugs: string[]): string {
    //     const pathSegments = slugs.map(slug => slug === "*" ? "*" : `/:${slug}`);
    //     const path = pathSegments.join('');
    //     // ?�에 추�? 경로가 ?�는 것을 방�??�기 ?�해 '(?=/|$)' ?�용
    //     return path + '(?=/|$)';
    // }


    /**
   * # GET
   * @param handler 
   * @param options 
   * @returns 
   */
    public GET(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.get('/', this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'GET',
                path: this.getFullPath('/'),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'GET',
                path: '/',
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this; // 메소??체인???�해 ?�스?�스 반환
    }

    /**
     * # GET_SLUG
     * @param slug 
     * @param handler 
     * @param options 
     * @returns
     * @description
     * - ?�우?�로 ?�언??slug 직접 주워 ?�아???�니?? 
     * @example
     * ```typescript
     * router.GET_SLUG(["slug1", "slug2"],(req, res) => {
     *     res.send(`${req.params.slug1}`);
     * });
     * ```
     */
    public GET_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter {
        const slugPath = this.convertSlugsToPath(slug);
        this.router.get(slugPath, this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'GET',
                path: this.getFullPath(slugPath),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'GET',
                path: slugPath,
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this; // 메소??체인???�해 ?�스?�스 반환
    }


    /**
     * # POST
     * @param handler 
     * @param options 
     * @returns 
     */
    public POST(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.post('/', this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath('/'),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'POST',
                path: '/',
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this; // 메소??체인???�해 ?�스?�스 반환
    }


    /**
     * # POST_SLUG
     * @param slug 
     * @param handler 
     * @param options 
     * @returns 
     * @description
     * - ?�우?�로 ?�언??slug 직접 주워 ?�아???�니?? 
     */
    public POST_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter {
        const slugPath = this.convertSlugsToPath(slug);
        this.router.post(slugPath, this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath(slugPath),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'POST',
                path: slugPath,
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this; // 메소??체인???�해 ?�스?�스 반환
    }



    /**
     * ```
     * - multer ?�이브러�?
     * ?�일 ?�로?��? ?�한 ?�우??기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public POST_SINGLE_FILE(multerStorageEngine: multer.StorageEngine, keyName: string, handler: HandlerFunction, options?: {
        fileSize?: number
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize }, });
        const accpetFileType = upload.single(keyName);
        this.router.post('/', accpetFileType, this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath('/'),
                summary: `File upload: ${keyName}`,
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'POST',
                path: '/',
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this;
    }



    /**
     * ```
     * - multer ?�이브러�?
     * ?�일 ?�로?��? ?�한 ?�우??기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public POST_ARRAY_FILE(multerStorageEngine: multer.StorageEngine, keyName: string, handler: HandlerFunction, maxFileCount?: number, options?: {
        fileSize?: number
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined; const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.array(keyName, maxFileCount);
        this.router.post('/', accpetFileType, this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath('/'),
                summary: `Multiple file upload: ${keyName}${maxFileCount ? ` (max: ${maxFileCount})` : ''}`,
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'POST',
                path: '/',
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this;
    }


    /**
     * ```
     * - multer ?�이브러�?
     * ?�일 ?�로?��? ?�한 ?�우??기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public POST_FIELD_FILE(multerStorageEngine: multer.StorageEngine, fields: readonly multer.Field[], handler: HandlerFunction, options?: {
        fileSize?: number
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } }); const accpetFileType = upload.fields(fields);
        this.router.post('/', accpetFileType, this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath('/'),
                summary: `Multiple fields file upload`,
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'POST',
                path: '/',
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this;
    }


    /**
     * ```
     * - multer ?�이브러�?
     * ?�일 ?�로?��? ?�한 ?�우??기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public POST_ANY_FILE(multerStorageEngine: multer.StorageEngine, handler: HandlerFunction, options?: {
        fileSize?: number
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.any();
        this.router.post('/', accpetFileType, this.wrapHandler(handler));
        return this;
    }



    /**
     * # PUT
     * @param handler 
     * @param options 
     * @returns 
     */
    public PUT(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.put('/', this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'PUT',
                path: this.getFullPath('/'),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });

        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'PUT',
                path: '/',
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this;
    }


    /**
     * ```
     * - multer ?�이브러�?
     * ?�일 ?�로?��? ?�한 ?�우??기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public PUT_SINGLE_FILE(multerStorageEngine: multer.StorageEngine, keyName: string, handler: HandlerFunction, options?: {
        fileSize?: number
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize }, });
        const accpetFileType = upload.single(keyName);
        this.router.put('/', accpetFileType, this.wrapHandler(handler));
        return this;
    }


    /**
     * ```
     * - multer ?�이브러�?
     * ?�일 ?�로?��? ?�한 ?�우??기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public PUT_ARRAY_FILE(multerStorageEngine: multer.StorageEngine, keyName: string, handler: HandlerFunction, maxFileCount?: number, options?: {
        fileSize?: number
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.array(keyName, maxFileCount);
        this.router.put('/', accpetFileType, this.wrapHandler(handler));
        return this;
    }



    /**
     * ```
     * - multer ?�이브러�?
     * ?�일 ?�로?��? ?�한 ?�우??기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public PUT_FIELD_FILE(multerStorageEngine: multer.StorageEngine, fields: readonly multer.Field[], handler: HandlerFunction, options?: {
        fileSize?: number
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.fields(fields);
        this.router.put('/', accpetFileType, this.wrapHandler(handler));
        return this;
    }





    /**
     * ```
     * - multer ?�이브러�?
     * ?�일 ?�로?��? ?�한 ?�우??기능
     * ```
     * @param multerStorageEngine 
     * @param keyName 
     * @param handler 
     * @param options 
     * @returns 
     */
    public PUT_ANY_FILE(multerStorageEngine: multer.StorageEngine, handler: HandlerFunction, options?: {
        fileSize?: number
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.any();
        this.router.put('/', accpetFileType, this.wrapHandler(handler));
        return this;
    }




    /**
     * # PUT_SLUG
     * @param slug 
     * @param handler 
     * @param options 
     * @returns 
     * @description
     * - ?�우?�로 ?�언??slug 직접 주워 ?�아???�니?? 
     */
    public PUT_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter {
        const slugPath = this.convertSlugsToPath(slug);
        this.router.put(slugPath, this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'PUT',
                path: this.getFullPath(slugPath),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'PUT',
                path: slugPath,
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this;
    }




    /**
     * # DELETE
     * @param handler 
     * @param options 
     * @returns
     * - http delete ?�청??처리?�는 메서?�입?�다. 
     */
    public DELETE(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.delete('/', this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'DELETE',
                path: this.getFullPath('/'),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'DELETE',
                path: '/',
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this;
    }




    /**
     * # DELETE_SLUG
     * @param slug 
     * @param handler 
     * @param options 
     * @returns 
     * @description
     * - ?�우?�로 ?�언??slug 직접 주워 ?�아???�니?? 
     */
    public DELETE_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter {
        const slugPath = this.convertSlugsToPath(slug);
        this.router.delete(slugPath, this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'DELETE',
                path: this.getFullPath(slugPath),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'DELETE',
                path: slugPath,
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this;
    }





    /**
     * # PATCH
     * @param handler 
     * @param options 
     * @returns 
     */
    public PATCH(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.patch('/', this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'PATCH',
                path: this.getFullPath('/'),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'PATCH',
                path: '/',
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this;
    }





    /**
     * # PATCH_SLUG
     * @param slug 
     * @param handler 
     * @param options 
     * @returns 
     * @description
     * - ?�우?�로 ?�언??slug 직접 주워 ?�아???�니?? 
     */
    public PATCH_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter {
        const slugPath = this.convertSlugsToPath(slug);
        this.router.patch(slugPath, this.wrapHandler(handler));

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'PATCH',
                path: this.getFullPath(slugPath),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'PATCH',
                path: slugPath,
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

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
     * 미들?�어�??�용?�는 메서??
     * @param middleware 미들?�어 ?�수 ?�는 미들?�어 ?�수??배열
     * @returns ExpressRouter ?�스?�스
     */
    public USE(middleware: RequestHandler | RequestHandler[]): ExpressRouter {
        if (Array.isArray(middleware)) {
            middleware.forEach((mw) => this.router.use(mw));
        } else {
            this.router.use(middleware);
        }
        return this; // 메소??체인???�해 ?�스?�스 반환
    }    
    



    
    /**
     * HandlerFunction ?�?�의 미들?�어�??�용?�는 메서??
     * @param middleware HandlerFunction ?�?�의 미들?�어 ?�수 ?�는 배열
     * @returns ExpressRouter ?�스?�스
     * @deprecated 보통??경우 USE_MIDDLEWARE�??�용?�니?? ?�걸 ?�용?�는 경우???�습?�다. (미들?�어�??�는??NEXT ?�수가 ?�으�??�음?�로 ?�어가�?못해??
     */
    public USE_HANDLER(middleware: HandlerFunction | HandlerFunction[]): ExpressRouter {
        if (Array.isArray(middleware)) {
            middleware.forEach((mw) => this.router.use(this.wrapHandler(mw)));
        } else {
            this.router.use(this.wrapHandler(middleware));
        }
        return this; // 메소??체인???�해 ?�스?�스 반환
    }
    


    
    /**
     * MiddlewareHandlerFunction ?�?�의 미들?�어�??�용?�는 메서??
     * @param middleware MiddlewareHandlerFunction ?�?�의 미들?�어 ?�수 ?�는 배열
     * @returns ExpressRouter ?�스?�스
     * 
     * @example
     * ```typescript
     * // ?�반 ?�수 (?�???�트 지??
     * router.MIDDLEWARE(function(req, res, next, injected, repo, db) {
     *     // 미들?�어 로직
     * });
     * 
     * // ?�살???�수 (?�???�트 미�???
     * router.MIDDLEWARE((req, res, next, injected, repo, db) => {
     *     // 미들?�어 로직
     * } as MiddlewareHandlerFunction);
     * 
     * // 배열�??�러 개의 미들?�어�??�용???�도 ?�습?�다. ??경우???�살???�수???�???�트�?지?�합?�다.
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
        return this; // 메소??체인???�해 ?�스?�스 반환
    }    
    


    /**
     * Injectable 미들?�어�??�용?�는 메서??
     * 
     * ?�용 ?�시:
     * - ?�라미터 ?�이: router.WITH('authNoLoginOnly')
     * - ?�라미터?� ?�께: router.WITH('rateLimiterDefault', { repositoryName: 'test', maxRequests: 10, windowMs: 60000 })
     * 
     * @param middlewareName 미들?�어 ?�름
     * @param params 미들?�어???�달???�라미터 (미들?�어???�라 ?�동 결정)
     * @returns ExpressRouter ?�스?�스
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
            
            // 미들?�어 ?�름???�라미터 ?�로 변?�하???�수 (?�적 매핑 ?�용)
            const getParameterKey = (middlewareName: string): string => {
                // ?�성??매핑?�서 ?�라미터 ??조회
                return MIDDLEWARE_PARAM_MAPPING[middlewareName as keyof typeof MIDDLEWARE_PARAM_MAPPING] || middlewareName;
            };

            // 미들?�어 ?�스?�스??모든 메서?��? Express 미들?�어�?변?�하???�용
            if (typeof middlewareInstance === 'object' && middlewareInstance !== null) {
                
                // 미들?�어 객체??메서?�들???�인?�고 Express 미들?�어�??�핑
                Object.keys(middlewareInstance).forEach(methodName => {
                    const method = (middlewareInstance as any)[methodName];
                    if (typeof method === 'function') {
                        // �?메서?��? 미들?�어�??�핑?�여 ?�우?�에 ?�용
                        // 미들?�어 ?�수??매개변??개수�??�단 (req, res, next, injected, repo, db = 6�?
                        if (method.length >= 6) {
                            // MiddlewareHandlerFunction ?�?�으�??�단?�면 wrapMiddleware ?�용
                            this.router.use(this.wrapMiddleware(method));
                        } else {
                            // ?�반 Express 미들?�어
                            this.router.use((req: Request, res: Response, next: NextFunction) => {
                                try {
                                    // Kusto 매니?��?Request 객체???�정
                                    req.kusto = kustoManager;
                                    
                                    // ?�라미터가 ?�다�?req 객체??추�?
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
               
                // 미들?�어가 직접 ?�수??경우
                // 매개변??개수�?MiddlewareHandlerFunction?��? ?�단
                if ((middlewareInstance as Function).length >= 6) {
                    // MiddlewareHandlerFunction ?�?�으�??�단?�면 wrapMiddleware ?�용
                    this.router.use(this.wrapMiddleware(middlewareInstance as MiddlewareHandlerFunction));
                } else {
                    // ?�반 Express 미들?�어
                    this.router.use((req: Request, res: Response, next: NextFunction) => {
                        try {
                            // Kusto 매니?��?Request 객체???�정
                            req.kusto = kustoManager;
                            
                            // ?�라미터가 ?�다�?req 객체??추�?
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
            console.error(`Error applying middleware '${middlewareName}':`, error);
            throw error;
        }
    }


    /**
     * # MIDDLE_PROXY_ROUTE
     * @param options - http-proxy-middleware ?�션
     * @description
     * - Express ?�우?�에 ?�록??미들?�어�?추�??�니??
     */
    public MIDDLE_PROXY_ROUTE(options: Options) {
        this.router.use("/", createProxyMiddleware(options));
    }



    /**
     * # MIDDLE_PROXY_ROUTE_SLUG
     * @param slug - ?�러�?배열
     * @param options - http-proxy-middleware ?�션
     * @description
     * - Express ?�우?�에 ?�록??미들?�어�?추�??�니??
     */
    public MIDDLE_PROXY_ROUTE_SLUG(slug: string[], options: Options) {
        this.router.use(this.convertSlugsToPath(slug), createProxyMiddleware(options));
    }

    /**
     * # STATIC
     * @param staticPath - ?�적 ?�일???�비?�할 물리??경로
     * @param options - express.static ?�션
     * @description
     * - Express???�적 ?�일 ?�비??미들?�어�??�우??루트(/)??추�??�니??
     */
    public STATIC(staticPath: string, options?: any): ExpressRouter {
        this.router.use('/', static_(staticPath, options));
        return this;
    }

    /**
     * # STATIC_SLUG
     * @param slug - ?�러�?배열 (URL 경로)
     * @param staticPath - ?�적 ?�일???�비?�할 물리??경로
     * @param options - express.static ?�션
     * @description
     * - Express???�적 ?�일 ?�비??미들?�어�??�정 경로??추�??�니??
     */
    public STATIC_SLUG(slug: string[], staticPath: string, options?: any): ExpressRouter {
        const slugPath = this.convertSlugsToPath(slug);
        this.router.use(slugPath, static_(staticPath, options));
        return this;
    }


    /**
     * # GET_VALIDATED
     * 검증된 GET ?�청 처리
     * @param requestConfig ?�청 검�??�정
     * @param responseConfig ?�답 검�??�정
     * @param handler ?�들???�수
     * @returns ExpressRouter
     */

    public GET_VALIDATED(
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        // ?�재 ?�치 ?�보�??�기 ?�해 Error ?�택 추적
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );
        this.router.get('/', ...middlewares);

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {


            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'GET',
                path: this.getFullPath('/'),
                parameters: {
                    query: requestConfig.query,
                    params: requestConfig.params,
                    body: requestConfig.body
                },
                responses: responseConfig
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'GET',
                path: '/',
                requestConfig,
                responseConfig
            });
        }

        return this;
    }






    /**
     * # GET_SLUG_VALIDATED
     * 검증된 GET ?�러�??�청 처리
     * @param exact true?�면 ?�위 경로 매칭 방�? (기본�? false)
     */
    public GET_SLUG_VALIDATED(
        slug: string[],
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction,
        options?: { exact?: boolean }
    ): ExpressRouter {
        // ?�퍼 메서?��? ?�해 ?�출???�치 ?�보 ?�득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );
        const slugPath = this.convertSlugsToPath(slug);

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'GET',
                path: this.getFullPath(slugPath),
                parameters: {
                    query: requestConfig.query,
                    params: requestConfig.params,
                    body: requestConfig.body
                },
                responses: responseConfig
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'GET',
                path: slugPath,
                requestConfig,
                responseConfig
            });
        }

        if (options?.exact) {
            // ?�확??매칭: ?�위 경로???�향??주�? ?�음
            const exactMiddleware = (req: any, res: any, next: any) => {
                // ?�재 ?�청 경로가 ?�확???�턴�??�치?�는지 ?�인
                const pathParts = req.path.split('/').filter(Boolean);
                const expectedParts = slug.length;

                // 경로 ?�그먼트 ?��? ?�확???�치?�야 ??
                if (pathParts.length === expectedParts) {
                    next();
                } else {
                    next('route'); // ???�우?��? 건너?�고 ?�음 ?�우?�로
                }
            };
            this.router.get(slugPath, exactMiddleware, ...middlewares);
        } else {
            // 기본 ?�작: ?�위 경로??매칭
            this.router.get(slugPath, ...middlewares);
        }

        return this;
    }






    /**
     * # POST_VALIDATED
     * 검증된 POST ?�청 처리
     */
    public POST_VALIDATED(
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        // ?�퍼 메서?��? ?�해 ?�출???�치 ?�보 ?�득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        ); this.router.post('/', ...middlewares);

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath('/'),
                parameters: {
                    query: requestConfig.query,
                    params: requestConfig.params,
                    body: requestConfig.body
                },
                responses: responseConfig
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'POST',
                path: '/',
                requestConfig,
                responseConfig
            });
        }

        return this;
    }






    /**
     * # POST_SLUG_VALIDATED
     * 검증된 POST ?�러�??�청 처리
     * @param exact true?�면 ?�위 경로 매칭 방�? (기본�? false)
     */    
    public POST_SLUG_VALIDATED(
        slug: string[],
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction,
        options?: { exact?: boolean }
    ): ExpressRouter {
        // ?�퍼 메서?��? ?�해 ?�출???�치 ?�보 ?�득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );


        const slugPath = this.convertSlugsToPath(slug);

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath(slugPath),
                parameters: {
                    query: requestConfig.query,
                    params: requestConfig.params,
                    body: requestConfig.body
                },
                responses: responseConfig
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'POST',
                path: slugPath,
                requestConfig,
                responseConfig
            });
        }

        if (options?.exact) {
            const exactMiddleware = (req: any, res: any, next: any) => {
                const pathParts = req.path.split('/').filter(Boolean);
                const expectedParts = slug.length;

                if (pathParts.length === expectedParts) {
                    next();
                } else {
                    next('route');
                }
            };
            this.router.post(slugPath, exactMiddleware, ...middlewares);
        } else {
            this.router.post(slugPath, ...middlewares);
        }

        return this;
    }






    /**
     * # PUT_VALIDATED
     * 검증된 PUT ?�청 처리
     */    
    public PUT_VALIDATED(
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        // ?�퍼 메서?��? ?�해 ?�출???�치 ?�보 ?�득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );

        this.router.put('/', ...middlewares);

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'PUT',
                path: this.getFullPath('/'),
                parameters: {
                    query: requestConfig.query,
                    params: requestConfig.params,
                    body: requestConfig.body
                },
                responses: responseConfig
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'PUT',
                path: '/',
                requestConfig,
                responseConfig
            });
        }

        return this;
    }






    /**
     * # DELETE_VALIDATED
     * 검증된 DELETE ?�청 처리
     */    
    public DELETE_VALIDATED(
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        // ?�퍼 메서?��? ?�해 ?�출???�치 ?�보 ?�득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        ); this.router.delete('/', ...middlewares);

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'DELETE',
                path: this.getFullPath('/'),
                parameters: {
                    query: requestConfig.query,
                    params: requestConfig.params,
                    body: requestConfig.body
                },
                responses: responseConfig
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'DELETE',
                path: '/',
                requestConfig,
                responseConfig
            });
        }

        return this;
    }






    /**
     * # PATCH_VALIDATED
     * 검증된 PATCH ?�청 처리
     */    
    public PATCH_VALIDATED(
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        // ?�퍼 메서?��? ?�해 ?�출???�치 ?�보 ?�득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        );


        this.router.patch('/', ...middlewares);

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'PATCH',
                path: this.getFullPath('/'),
                parameters: {
                    query: requestConfig.query,
                    params: requestConfig.params,
                    body: requestConfig.body
                },
                responses: responseConfig
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'PATCH',
                path: '/',
                requestConfig,
                responseConfig
            });
        }

        return this;
    }



    /**
     * # GET_WITH_VALIDATION
     * ?�청 검증만 ?�는 GET
     */
    public GET_WITH_VALIDATION(
        requestConfig: RequestConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        const middlewares = CustomRequestHandler.withValidation(requestConfig, handler);

        this.router.get('/', ...middlewares);

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'GET',
                path: this.getFullPath('/'),
                parameters: {
                    query: requestConfig.query,
                    params: requestConfig.params,
                    body: requestConfig.body
                },
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });

        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'GET',
                path: '/',
                requestConfig,
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this;
    }



    /**
     * # POST_WITH_VALIDATION
     * ?�청 검증만 ?�는 POST
     */
    public POST_WITH_VALIDATION(
        requestConfig: RequestConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {

        const middlewares = CustomRequestHandler.withValidation(requestConfig, handler);
        this.router.post('/', ...middlewares);

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {

            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath('/'),
                parameters: {
                    query: requestConfig.query,
                    params: requestConfig.params,
                    body: requestConfig.body
                },
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'POST',
                path: '/',
                requestConfig,
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this;
    }


    /**
     * # GET_SLUG_VALIDATED_EXACT
     * 검증된 GET ?�러�??�청 처리 (?�확??경로 매칭�?
     * ?�위 ?�우?�에 ?�향??주�? ?�음
     */
    public GET_SLUG_VALIDATED_EXACT(
        slug: string[],
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {

        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );

        // ?�확??경로 매칭???�해 '$' ?�커 ?�용?�는 ?�???�규???�턴?�로 처리
        const exactPath = this.convertSlugsToPath(slug);
        this.router.get(new RegExp(`^${exactPath.replace(/:\w+/g, '([^/]+)')}$`), ...middlewares);

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'GET',
                path: this.getFullPath(exactPath),
                parameters: {
                    query: requestConfig.query,
                    params: requestConfig.params,
                    body: requestConfig.body
                },
                responses: responseConfig
            });
        } else {

            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'GET',
                path: exactPath,
                requestConfig,
                responseConfig
            });
        }

        return this;
    }







    /**
     * # POST_SLUG_VALIDATED_EXACT
     * 검증된 POST ?�러�??�청 처리 (?�확??경로 매칭�?
     */
    public POST_SLUG_VALIDATED_EXACT(
        slug: string[],
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );

        const exactPath = this.convertSlugsToPath(slug);

        this.router.post(new RegExp(`^${exactPath.replace(/:\w+/g, '([^/]+)')}$`), ...middlewares);

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {

            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath(exactPath),
                parameters: {
                    query: requestConfig.query,
                    params: requestConfig.params,
                    body: requestConfig.body
                },
                responses: responseConfig
            });
        } else {

            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'POST',
                path: exactPath,
                requestConfig,
                responseConfig
            });
        }

        return this;
    }







    /**
     * # PUT_SLUG_VALIDATED_EXACT
     * 검증된 PUT ?�러�??�청 처리 (?�확??경로 매칭�?
     */
    public PUT_SLUG_VALIDATED_EXACT(
        slug: string[],
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );


        const exactPath = this.convertSlugsToPath(slug);
        this.router.put(new RegExp(`^${exactPath.replace(/:\w+/g, '([^/]+)')}$`), ...middlewares);

        // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
        if (this.basePath) {
            // basePath가 ?��? ?�정??경우 즉시 ?�록
            DocumentationGenerator.registerRoute({
                method: 'PUT',
                path: this.getFullPath(exactPath),
                parameters: {
                    query: requestConfig.query,
                    params: requestConfig.params,
                    body: requestConfig.body
                },
                responses: responseConfig
            });
        } else {
            // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
            this.pendingDocumentation.push({
                method: 'PUT',
                path: exactPath,
                requestConfig,
                responseConfig
            });
        }

        return this;
    }



    // /**
    //  * # DELETE_SLUG_VALIDATED_EXACT
    //  * 검증된 DELETE ?�러�??�청 처리 (?�확??경로 매칭�?
    //  */
    // public DELETE_SLUG_VALIDATED_EXACT(
    //     slug: string[],
    //     requestConfig: RequestConfig,
    //     responseConfig: ResponseConfig,
    //     handler: ValidatedHandlerFunction
    // ): ExpressRouter {
    //     const middlewares = CustomRequestHandler.createHandler(
    //         { request: requestConfig, response: responseConfig },
    //         handler
    //     );

    //     const exactPath = this.convertSlugsToPath(slug);
    //     this.router.delete(new RegExp(`^${exactPath.replace(/:\w+/g, '([^/]+)')}$`), ...middlewares);

    //     // 문서???�록??지?�시�?setBasePath ?�출 ???�바�?경로�??�록?�도�???
    //     if (this.basePath) {
    //         // basePath가 ?��? ?�정??경우 즉시 ?�록
    //         DocumentationGenerator.registerRoute({
    //             method: 'DELETE',
    //             path: this.getFullPath(exactPath),
    //             parameters: {
    //                 query: requestConfig.query,
    //                 params: requestConfig.params,
    //                 body: requestConfig.body
    //             },
    //             responses: responseConfig
    //         });

    //     } else {
    //         // basePath가 ?�직 ?�정?��? ?��? 경우 지???�록
    //         this.pendingDocumentation.push({
    //             method: 'DELETE',
    //             path: exactPath,
    //             requestConfig,
    //             responseConfig
    //         });
    //     }

    //     return this;
    // }

    // /**
    //  * # GET_SLUG_VALIDATED (개선??버전)
    //  * ?�위 ?�우???�향 방�? ?�션 추�?
    //  */
    // public GET_SLUG_VALIDATED_IMPROVED(
    //     slug: string[],
    //     requestConfig: RequestConfig,
    //     responseConfig: ResponseConfig,
    //     handler: ValidatedHandlerFunction,
    //     options?: { exact?: boolean }
    // ): ExpressRouter {

    //     const middlewares = CustomRequestHandler.createHandler(
    //         { request: requestConfig, response: responseConfig },
    //         handler
    //     );

    //     if (options?.exact) {
    //         // ?�확??매칭: ?�위 경로 방�?
    //         const exactPath = this.convertSlugsToPath(slug);

    //         // Express?�서 ?�확??매칭???�해 미들?�어?�서 경로 체크
    //         const exactMiddleware = (req: any, res: any, next: any) => {
    //             // URL???�확???�치?�는지 ?�인
    //             const pathPattern = exactPath.replace(/:\w+/g, '[^/]+');
    //             const regex = new RegExp(`^${pathPattern}$`);
    //             if (regex.test(req.path)) {
    //                 next();
    //             } else {
    //                 next('route'); // ?�른 ?�우?�로 ?�스
    //             }
    //         };

    //         this.router.get(exactPath, exactMiddleware, ...middlewares);

    //     } else {
    //         // 기본 ?�작: ?�위 경로??매칭
    //         this.router.get(this.convertSlugsToPath(slug), ...middlewares);
    //     }

    //     return this;
    // }

    
    /**
     * CRUD ?�동 ?�성 메서??
     * ?��? REST API CRUD ?�드?�인?��? ?�동?�로 ?�성?�니??
     * 
     * ?�성?�는 ?�우??
     * - GET / (index) - 리스??조회 with ?�터�? ?�렬, ?�이지?�이??
     * - GET /:identifier (show) - ?�일 ??�� 조회
     * - POST / (create) - ????�� ?�성
     * - PUT /:identifier (update) - ??�� ?�체 ?�정
     * - PATCH /:identifier (update) - ??�� 부�??�정  
     * - DELETE /:identifier (destroy) - ??�� ??��
     * 
     * @param databaseName ?�용???�이?�베?�스 ?�름
     * @param modelName ?�??모델 ?�름 (?�???�전?�을 ?�해 ?�네�??�용)
     * @param options CRUD ?�션 ?�정
     */
    public CRUD<T extends DatabaseNamesUnion>(
        databaseName: T, 
        modelName: ModelNamesFor<T>,
        options?: {

            /** CRUD ?�션 ?�성???�정 */
            only?: ('index' | 'show' | 'create' | 'update' | 'destroy' | 'recover')[];
            except?: ('index' | 'show' | 'create' | 'update' | 'destroy' | 'recover')[];


            /** Primary key ?�드�?지??(기본�? 'id') */
            primaryKey?: string;


            /** Primary key ?�??변???�수 */
            primaryKeyParser?: (value: string) => any;


            /** JSON:API 리소???�??(기본�? modelName.toLowerCase()) */
            resourceType?: string;


            /**
             * includeMerge: true�?included ?�??attributes??관계명?�로 병합 (기본�? false)
             */
            includeMerge?: boolean;


            /** Soft Delete ?�정 */
            softDelete?: {
                enabled: boolean;
                field: string;
            };

            /** 미들?�어 */
            middleware?: {
                index?: HandlerFunction[];
                show?: HandlerFunction[];
                create?: HandlerFunction[];
                update?: HandlerFunction[];
                destroy?: HandlerFunction[];
                recover?: HandlerFunction[];
            };

            /** ?�청 검�??�정 */
            validation?: {
                create?: RequestConfig;
                update?: RequestConfig;
                recover?: RequestConfig;
            };

            /** ?�답 검�??�정 */
            hooks?: {
                beforeCreate?: (data: any, req: Request) => Promise<any> | any;
                afterCreate?: (result: any, req: Request) => Promise<any> | any;

                beforeUpdate?: (data: any, req: Request) => Promise<any> | any;
                afterUpdate?: (result: any, req: Request) => Promise<any> | any

                beforeDestroy?: (id: any, req: Request) => Promise<void> | void;
                afterDestroy?: (id: any, req: Request) => Promise<void> | void;

                beforeRecover?: (id: any, req: Request) => Promise<void> | void;
                afterRecover?: (result: any, req: Request) => Promise<void> | void;
            };
        }
    ): ExpressRouter {
        

        const enabledActions = this.getEnabledActions(options);
        const client = prismaManager.getWrap(databaseName);
        
        // Primary key ?�정 �??�동 ?�서 ?�택
        const primaryKey = options?.primaryKey || 'id';
        const primaryKeyParser = options?.primaryKeyParser || this.getSmartPrimaryKeyParser(databaseName, modelName, primaryKey);
        
        // INDEX - GET / (목록 조회)
        if (enabledActions.includes('index')) {
            this.setupIndexRoute(client, modelName, options, primaryKey);
        }

        // SHOW - GET /:identifier (?�일 조회)
        if (enabledActions.includes('show')) {
            this.setupShowRoute(client, modelName, options, primaryKey, primaryKeyParser);
        }

        // CREATE - POST / (?�성)
        if (enabledActions.includes('create')) {
            this.setupCreateRoute(client, modelName, options, primaryKey);
        }

        // UPDATE - PUT /:identifier, PATCH /:identifier (?�정)
        if (enabledActions.includes('update')) {
            this.setupUpdateRoute(client, modelName, options, primaryKey, primaryKeyParser);
        }

        // DESTROY - DELETE /:identifier (??��)
        if (enabledActions.includes('destroy')) {
            this.setupDestroyRoute(client, modelName, options, primaryKey, primaryKeyParser);
        }

        // ATOMIC OPERATIONS - POST /atomic (?�자???�업)
        this.setupAtomicOperationsRoute(client, modelName, options);

        // RECOVER - POST /:identifier/recover (복구)
        if (enabledActions.includes('recover')) {
            this.setupRecoverRoute(client, modelName, options, primaryKey, primaryKeyParser);
        }

        // JSON:API Relationship ?�우??추�?
        this.setupRelationshipRoutes(client, modelName, options, primaryKey, primaryKeyParser);

        return this;
    }

    /**
     * Primary key ?�?�을 ?�동?�로 감�??�고 ?�절???�서�?반환?�는 ?�퍼 메서??
     */
    private getSmartPrimaryKeyParser(databaseName: string, modelName: string, primaryKey: string): (value: string) => any {
        try {
            // 간단???�??추론 로직
            // ?�제로는 Prisma ?�키마나 메�??�이?��? ?�어???�단?????��?�?
            // ?�기?�는 ?�반?�인 ?�턴??기반?�로 추론
            
            // primaryKey ?�름 기반 추론
            if (primaryKey === 'uuid' || primaryKey.includes('uuid') || primaryKey.endsWith('_uuid')) {
                return ExpressRouter.parseUuid;
            }
            
            // 기본?�으�??�마???�서 ?�용 (?�자?��? UUID?��? ?�동 ?�단)
            return this.parseIdSmart;
        } catch (error) {
            console.warn(`Failed to determine primary key type for ${modelName}.${primaryKey}, using string parser`);
            return ExpressRouter.parseString;
        }
    }

    /**
     * ?�마??ID ?�서 - ?�력값을 보고 ?�절???�?�으�?변??
     * UUID ?�식???�닌 경우 ?�자??문자?�로 ?�전?�게 처리
     */
    private parseIdSmart = (id: string): any => {
        // 먼�? ?�력�?검�?
        if (!id || typeof id !== 'string') {
            throw new Error('Invalid ID format: ID must be a non-empty string');
        }

        // UUID ?�턴 체크 (?�격??검�?
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(id)) {
            return id; // ?�효??UUID 그�?�?반환
        }
        
        // ?�수 ?�자??경우 ?�수�?변??
        if (/^\d+$/.test(id)) {
            const numValue = parseInt(id, 10);
            if (!isNaN(numValue) && numValue > 0) {
                return numValue;
            }
        }
        
        // ?�효??문자??ID??경우 (?�파�? ?�자, ?�이?? ?�더?�코???�용)
        if (/^[a-zA-Z0-9_-]+$/.test(id)) {
            return id;
        }
        
        // �??�의 경우 ?�러 발생
        throw new Error(`Invalid ID format: '${id}' is not a valid UUID, number, or string identifier`);
    };

    /**
     * ?�성?�된 ?�션 목록 계산
     * 
     * ?�선?�위:
     * 1. only?� except가 ????지?�된 경우: only�??�선?�로 ?�되, 경고 로그�?출력
     * 2. only�?지?�된 경우: only???�함???�션?�만 ?�성??
     * 3. except�?지?�된 경우: ?�체 ?�션?�서 except???�함??것들???�외
     * 4. ?????�는 경우: 모든 ?�션 ?�성??
     */
    private getEnabledActions(options?: any): string[] {
        const allActions = ['index', 'show', 'create', 'update', 'destroy', 'recover'];
        
        // only?� except가 ????지?�된 경우 경고
        if (options?.only && options?.except) {
            console.warn(
                '[CRUD Warning] Both "only" and "except" options are specified. ' +
                '"only" takes precedence and "except" will be ignored.'
            );
            return options.only;
        }
        
        // only�?지?�된 경우
        if (options?.only) {
            return options.only;
        }
        
        // except�?지?�된 경우
        if (options?.except) {
            return allActions.filter(action => !options.except.includes(action));
        }
        
        // 기본�? 모든 ?�션
        return allActions;
    }

    /**
     * INDEX ?�우???�정 (GET /) - JSON:API 준??
     */
    private setupIndexRoute(client: any, modelName: string, options?: any, primaryKey: string = 'id'): void {
        const middlewares = options?.middleware?.index || [];
        const isSoftDelete = options?.softDelete?.enabled;
        const softDeleteField = options?.softDelete?.field || 'deletedAt';
        
        const handler: HandlerFunction = async (req, res, injected, repo, db) => {
            try {
                // JSON:API Content-Type ?�더 ?�정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                res.setHeader('Vary', 'Accept');
                
                // 쿼리 ?�라미터 ?�싱
                const queryParams = CrudQueryParser.parseQuery(req);
                
                // ?�이지?�이??방식 검�?- 반드??지?�되?�야 ??
                if (!queryParams.page) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Pagination is required. You must specify either page-based pagination (page[number] & page[size]) or cursor-based pagination (page[cursor] & page[size])'),
                        ERROR_CODES.PAGINATION_REQUIRED,
                        400,
                        req.path,
                        req.method
                    );
                    return res.status(400).json(errorResponse);
                }
                
                // ?�이지?�이???�라미터 ?�세 검�?
                if (!queryParams.page.number && !queryParams.page.cursor) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Invalid pagination parameters. Specify either page[number] for offset-based pagination or page[cursor] for cursor-based pagination'),
                        ERROR_CODES.INVALID_PAGINATION_PARAMS,
                        400,
                        req.path,
                        req.method
                    );
                    return res.status(400).json(errorResponse);
                }
                
                // ?�이지 ?�기 검�?
                if (!queryParams.page.size || queryParams.page.size <= 0) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('page[size] parameter is required and must be greater than 0'),
                        ERROR_CODES.INVALID_PAGE_SIZE,
                        400,
                        req.path,
                        req.method
                    );
                    return res.status(400).json(errorResponse);
                }
                
                // Prisma 쿼리 ?�션 빌드
                const findManyOptions = PrismaQueryBuilder.buildFindManyOptions(queryParams);
                
                // Soft Delete ?�터 추�? (기존 where 조건�?병합)
                if (isSoftDelete) {
                    // include_deleted 쿼리 ?�라미터가 true가 ?�닌 경우 ??��????�� ?�외
                    const includeDeleted = req.query.include_deleted === 'true';
                    
                    if (!includeDeleted) {
                        // 기존 where 조건???�는 경우 AND 조건?�로 추�?
                        if (findManyOptions.where) {
                            findManyOptions.where = {
                                AND: [
                                    findManyOptions.where,
                                    { [softDeleteField]: null }
                                ]
                            };
                        } else {
                            // where 조건???�는 경우 ?�로 ?�성
                            findManyOptions.where = { [softDeleteField]: null };
                        }
                    }
                }
                
                // �?개수 조회 (?�이지?�이?�용)
                const totalCountOptions = { ...findManyOptions };
                delete totalCountOptions.skip;
                delete totalCountOptions.take;
                delete totalCountOptions.cursor;
                 
                const [items, total] = await Promise.all([
                    client[modelName].findMany(findManyOptions),
                    client[modelName].count({ where: totalCountOptions.where })
                ]);

                // Base URL ?�성
                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
                
                // ?�함??리소???�성 (include ?�라미터가 ?�는 경우)
                let included: JsonApiResource[] | undefined;
                if (queryParams.include && queryParams.include.length > 0 && !options?.includeMerge) {
                    included = JsonApiTransformer.createIncludedResources(
                        items,
                        queryParams.include,
                        queryParams.fields,
                        baseUrl
                    );
                }

                // ?�이지?�이??링크 ?�성
                let links: any;
                if (queryParams.page) {
                    const pageSize = queryParams.page.size || 10;
                    const currentPage = queryParams.page.number || 1;
                    const totalPages = Math.ceil(total / pageSize);
                    
                    links = {
                        self: this.buildPaginationUrl(baseUrl, req.query, currentPage, pageSize),
                        first: this.buildPaginationUrl(baseUrl, req.query, 1, pageSize),
                        last: this.buildPaginationUrl(baseUrl, req.query, totalPages, pageSize)
                    };
                    
                    if (currentPage > 1) {
                        links.prev = this.buildPaginationUrl(baseUrl, req.query, currentPage - 1, pageSize);
                    }
                    if (currentPage < totalPages) {
                        links.next = this.buildPaginationUrl(baseUrl, req.query, currentPage + 1, pageSize);
                    }
                }

                // 메�??�이???�성 (JSON:API ?�펙 준??
                const meta: any = {
                    timestamp: new Date().toISOString(),
                    total: total,  // ?�체 ?�코????(JSON:API?�서 ?�반?�으�??�용)
                    count: items.length  // ?�재 ?�답???�코????
                };

                // ?�이지?�이?�이 ?�성?�된 경우?�만 ?�이지 ?�보 추�?
                if (queryParams.page) {
                    const pageSize = queryParams.page.size || 10;
                    const currentPage = queryParams.page.number || 1;
                    const totalPages = Math.ceil(total / pageSize);
                    
                    meta.page = {
                        current: currentPage,
                        size: pageSize,
                        total: totalPages  // ?�체 ?�이지 ??
                    };
                }

                // JSON:API ?�답 ?�성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    items,
                    modelName,
                    {
                        primaryKey,
                        fields: queryParams.fields,
                        baseUrl,
                        links,
                        meta,
                        included,
                        includeMerge: options?.includeMerge || false
                    }
                );
                
                // metadata ?�성 - 기존 ?�퍼 ?�수 ?�용
                const metadata = CrudResponseFormatter.createPaginationMeta(
                    items,
                    total,
                    queryParams.page,
                    'index',
                    queryParams.include,
                    queryParams
                );
                
                // BigInt?� DATE ?�??직렬??처리
                const serializedResponse = serialize({ ...response, metadata });
                
                res.json(serializedResponse);
                
            } catch (error: any) {
                console.error(`CRUD Index Error for ${modelName}:`, error);
                
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                
                res.status(status).json(errorResponse);
            }
        };

        // 미들?�어 ?�록
        if (middlewares.length > 0) {
            this.router.get('/', ...middlewares, this.wrapHandler(handler));
        } else {
            this.router.get('/', this.wrapHandler(handler));
        }

        // 문서???�록
        const queryParams: any = {
            include: { type: 'string', required: false, description: 'Related resources to include (comma-separated). Example: author,comments.author' },
            'fields[type]': { type: 'string', required: false, description: 'Sparse fieldsets - specify which fields to include for each resource type. Example: fields[posts]=title,content&fields[users]=name,email' },
            sort: { type: 'string', required: false, description: 'Sort fields (prefix with - for desc). Example: -createdAt,title' },
            'page[number]': { type: 'number', required: true, description: 'Page number for offset-based pagination (required with page[size])' },
            'page[cursor]': { type: 'string', required: false, description: 'Cursor for cursor-based pagination (alternative to page[number])' },
            'page[size]': { type: 'number', required: true, description: 'Page size for pagination (required)' },
            'filter[field_op]': { type: 'string', required: false, description: 'Filter conditions. Operators: eq, ne, gt, gte, lt, lte, like, in, etc. Example: filter[status_eq]=active&filter[age_gte]=18' }
        };
        
        // Soft delete가 ?�성?�된 경우 include_deleted ?�라미터 추�?
        if (isSoftDelete) {
            queryParams.include_deleted = { 
                type: 'boolean', 
                required: false, 
                description: 'Include soft deleted items (default: false)' 
            };
        }
        
        this.registerDocumentation('GET', '/', {
            summary: `Get ${modelName} list with required pagination, optional filtering and sorting`,
            parameters: {
                query: queryParams
            },
            responses: {
                200: {
                    data: { type: 'array', required: true, description: `Array of ${modelName} items` },
                    meta: { type: 'object', required: true, description: 'Pagination metadata' }
                },
                400: {
                    error: { type: 'object', required: true, description: 'Bad request - pagination parameters are required' }
                }
            }
        });
    }

    /**
     * SHOW ?�우???�정 (GET /:identifier) - JSON:API 준??
     */
    private setupShowRoute(
        client: any, 
        modelName: string, 
        options?: any, 
        primaryKey: string = 'id', 
        primaryKeyParser: (value: string) => any = ExpressRouter.parseString
    ): void {
        const middlewares = options?.middleware?.show || [];
        const isSoftDelete = options?.softDelete?.enabled;
        const softDeleteField = options?.softDelete?.field || 'deletedAt';
        
        const handler: HandlerFunction = async (req, res, injected, repo, db) => {
            try {
                // JSON:API Content-Type ?�더 ?�정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                res.setHeader('Vary', 'Accept');
                
                // ?�라미터 추출 �??�싱
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return; // ?�러 ?�답?� ?��? ?�퍼?�서 처리??
                
                // 쿼리 ?�라미터?�서 include ?�싱
                const queryParams = CrudQueryParser.parseQuery(req);
                const includeOptions = queryParams.include 
                    ? PrismaQueryBuilder['buildIncludeOptions'](queryParams.include)
                    : undefined;

                // Soft Delete ?�터 추�? (include_deleted가 true가 ?�닌 경우)
                const includeDeleted = req.query.include_deleted === 'true';
                const whereClause: any = { [primaryKey]: parsedIdentifier };
                
                if (isSoftDelete && !includeDeleted) {
                    whereClause[softDeleteField] = null;
                }

                const item = await client[modelName].findFirst({
                    where: whereClause,
                    ...(includeOptions && { include: includeOptions })
                });

                if (!item) {
                    // Soft delete????��?��? ?�인 (include_deleted=false ?�태?�서)
                    if (isSoftDelete && !includeDeleted) {
                        const deletedItem = await client[modelName].findUnique({
                            where: { [primaryKey]: parsedIdentifier }
                        });
                        
                        if (deletedItem && deletedItem[softDeleteField]) {
                            // Soft delete????��???�??410 Gone ?�답 (JSON:API ?�장)
                            const errorResponse = this.formatJsonApiError(
                                new Error(`${modelName} has been deleted`),
                                'RESOURCE_DELETED',
                                410,
                                req.path,
                                req.method
                            );
                            return res.status(410).json(errorResponse);
                        }
                    }
                    
                    const errorResponse = this.formatJsonApiError(
                        new Error(`${modelName} not found`),
                        'NOT_FOUND',
                        404,
                        req.path,
                        req.method
                    );
                    return res.status(404).json(errorResponse);
                }

                // Base URL ?�성
                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
                
                // ?�함??리소???�성 (include ?�라미터가 ?�는 경우)
                let included: JsonApiResource[] | undefined;
                if (queryParams.include && queryParams.include.length > 0 && !options?.includeMerge) {
                    included = JsonApiTransformer.createIncludedResources(
                        [item],
                        queryParams.include,
                        queryParams.fields,
                        baseUrl
                    );
                }

                // JSON:API ?�답 ?�성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    item,
                    modelName,
                    {
                        primaryKey,
                        fields: queryParams.fields,
                        baseUrl,
                        included,
                        includeMerge: options?.includeMerge || false
                    }
                );
                
                // metadata 객체 ?�성 - 기존 ?�퍼 ?�수 ?�용
                const metadata = CrudResponseFormatter.createPaginationMeta(
                    [item], // ?�일 ??��??배열�?감싸???�달
                    1,      // total count??1
                    undefined, // page ?�라미터 ?�음 (?�일 조회)
                    'show',
                    queryParams.include,
                    queryParams
                );
                
                // excludedFields 추�? (show ?�용)
                if (queryParams.fields) {
                    metadata.excludedFields = Object.keys(queryParams.fields[modelName] || {});
                }
                
                // BigInt?� DATE ?�??직렬??처리
                const serializedResponse = serialize({ ...response, metadata });
                
                res.json(serializedResponse);
                
            } catch (error: any) {
                console.error(`CRUD Show Error for ${modelName}:`, error);
                
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                
                res.status(status).json(errorResponse);
            }
        };

        // 미들?�어 ?�록 - ?�적 경로 ?�용
        const routePath = `/:${primaryKey}`;
        if (middlewares.length > 0) {
            this.router.get(routePath, ...middlewares, this.wrapHandler(handler));
        } else {
            this.router.get(routePath, this.wrapHandler(handler));
        }

        // 문서???�록
        const queryParams: any = {
            include: { type: 'string', required: false, description: 'Related resources to include' }
        };
        
        // Soft delete가 ?�성?�된 경우 include_deleted ?�라미터 추�?
        if (isSoftDelete) {
            queryParams.include_deleted = { 
                type: 'boolean', 
                required: false, 
                description: 'Include soft deleted items (default: false)' 
            };
        }
        
        const responses: any = {
            200: {
                data: { type: 'object', required: true, description: `${modelName} object` }
            },
            404: {
                error: { type: 'object', required: true, description: 'Not found error' }
            }
        };
        
        // Soft delete가 ?�성?�된 경우 410 Gone ?�답 추�?
        if (isSoftDelete) {
            responses[410] = {
                error: { type: 'object', required: true, description: 'Resource has been soft deleted' }
            };
        }
        
        this.registerDocumentation('GET', routePath, {
            summary: `Get single ${modelName} by ${primaryKey}`,
            parameters: {
                params: {
                    [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                },
                query: queryParams
            },
            responses: responses
        });
    }

    /**
     * CREATE ?�우???�정 (POST /) - JSON:API 준??
     */
    private setupCreateRoute(client: any, modelName: string, options?: any, primaryKey: string = 'id'): void {
        const middlewares = options?.middleware?.create || [];
        
        const handler: HandlerFunction = async (req, res, injected, repo, db) => {
            try {
                // JSON:API Content-Type ?�더 ?�정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                res.setHeader('Vary', 'Accept');
                
                // Content Negotiation 검�?
                // if (!this.validateJsonApiContentType(req, res)) {
                //     return;
                // }
                
                // JSON:API ?�청 ?�식 검�?
                if (!req.body || !req.body.data) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Request must contain a data object'),
                        'INVALID_REQUEST',
                        400,
                        req.path,
                        req.method
                    );
                    return res.status(400).json(errorResponse);
                }

                const { data: requestData } = req.body;
                
                // 리소???�??검�?(?�우??경로?�서 추출 ?�는 ?�션 ?�용)
                const routeResourceType = req.baseUrl.split('/').filter(Boolean).pop() || modelName.toLowerCase();
                const expectedType = options?.resourceType || routeResourceType;
                
                // JSON:API 리소??구조 검�?
                if (!this.validateJsonApiResource(requestData, expectedType, req, res, false)) {
                    return;
                }

                // attributes?�서 ?�이??추출
                let data = requestData.attributes || {};

                // ?�라?�언???�성 ID 지??(JSON:API ?�펙)
                if (requestData.id) {
                    // ?�라?�언?��? ID�??�공??경우
                    if (primaryKey === 'id') {
                        data.id = requestData.id;
                    } else {
                        data[primaryKey] = requestData.id;
                    }
                }

                // 관�??�이??처리 (relationships가 ?�는 경우)
                if (requestData.relationships) {
                    try {
                        data = await this.processRelationships(
                            data, 
                            requestData.relationships, 
                            client, 
                            modelName,
                            false // ?�성 모드
                        );
                    } catch (relationshipError: any) {
                        const errorResponse = this.formatJsonApiError(
                            relationshipError,
                            'INVALID_RELATIONSHIP',
                            422,
                            req.path,
                            req.method
                        );
                        return res.status(422).json(errorResponse);
                    }
                }

                // Before hook ?�행
                if (options?.hooks?.beforeCreate) {
                    data = await options.hooks.beforeCreate(data, req);
                }

                const result = await client[modelName].create({
                    data
                });

                // After hook ?�행
                if (options?.hooks?.afterCreate) {
                    await options.hooks.afterCreate(result, req);
                }

                // Base URL ?�성
                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;

                // JSON:API ?�답 ?�성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    result,
                    modelName,
                    {
                        primaryKey,
                        baseUrl,
                        includeMerge: options?.includeMerge || false
                    }
                );
                
                // metadata 객체 ?�성 - 기존 ?�퍼 ?�수 ?�용
                const metadata = CrudResponseFormatter.createPaginationMeta(
                    [result], // ?�성???�일 ??��??배열�?감싸???�달
                    1,        // total count??1
                    undefined, // page ?�라미터 ?�음 (?�일 ?�성)
                    'create',
                    undefined, // includedRelations ?�음
                    undefined  // queryParams ?�음
                );
                
                // BigInt?� DATE ?�??직렬??처리
                const serializedResponse = serialize({ ...response, metadata });
                
                res.status(201).json(serializedResponse);
                
            } catch (error: any) {
                console.error(`CRUD Create Error for ${modelName}:`, error);
                
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                
                res.status(status).json(errorResponse);
            }
        };

        // Validation???�는 경우
        if (options?.validation?.create) {
            const validationMiddlewares = CustomRequestHandler.withValidation(
                options.validation.create,
                handler as any
            );
            
            if (middlewares.length > 0) {
                this.router.post('/', ...middlewares, ...validationMiddlewares);
            } else {
                this.router.post('/', ...validationMiddlewares);
            }
        } else {
            // ?�반 ?�들??
            if (middlewares.length > 0) {
                this.router.post('/', ...middlewares, this.wrapHandler(handler));
            } else {
                this.router.post('/', this.wrapHandler(handler));
            }
        }

        // 문서???�록
        this.registerDocumentation('POST', '/', {
            summary: `Create new ${modelName} (JSON:API)`,
            parameters: {
                body: {
                    type: 'object',
                    required: true,
                    description: 'JSON:API resource object with optional relationships',
                    properties: {
                        data: {
                            type: 'object',
                            required: true,
                            properties: {
                                type: { type: 'string', required: true, description: 'Resource type' },
                                id: { type: 'string', required: false, description: 'Client-generated ID (optional)' },
                                attributes: options?.validation?.create?.body || 
                                          { type: 'object', required: true, description: `${modelName} attributes` },
                                relationships: { 
                                    type: 'object', 
                                    required: false, 
                                    description: 'JSON:API relationships object with data containing resource identifiers' 
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                201: {
                    data: { type: 'object', required: true, description: `Created ${modelName} resource` }
                },
                400: {
                    errors: { type: 'array', required: true, description: 'JSON:API error objects' }
                },
                422: {
                    errors: { type: 'array', required: true, description: 'JSON:API validation errors including relationship errors' }
                }
            }
        });
    }

    /**
     * Atomic Operations ?�드?�인???�정 (JSON:API Extension)
     */
    private setupAtomicOperationsRoute(client: any, modelName: string, options?: any): void {
        const handler: HandlerFunction = async (req, res, injected, repo, db) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"');
                
                // Content-Type 검�?(atomic extension ?�요)
                // const contentType = req.get('Content-Type');
                // if (!contentType || !contentType.includes('application/vnd.api+json') || !contentType.includes('ext="https://jsonapi.org/ext/atomic"')) {
                //     const errorResponse = this.formatJsonApiError(
                //         new Error('Content-Type must include atomic extension'),
                //         'INVALID_CONTENT_TYPE',
                //         415,
                //         req.path
                //     );
                //     return res.status(415).json(errorResponse);
                // }

                // ?�청 구조 검�?
                if (!req.body || !req.body['atomic:operations']) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Request must contain atomic:operations'),
                        'INVALID_REQUEST',
                        400,
                        req.path,
                        req.method
                    );
                    return res.status(400).json(errorResponse);
                }

                const operations = req.body['atomic:operations'];
                const results: (any | null)[] = [];

                // ?�랜??��?�로 모든 ?�업 ?�행
                await client.$transaction(async (tx: any) => {
                    for (const operation of operations) {
                        const result = await this.executeAtomicOperation(tx, operation, modelName, options, req);
                        results.push(result);
                    }
                });

                const response = {
                    'atomic:results': results,
                    jsonapi: {
                        version: "1.1",
                        ext: ["https://jsonapi.org/ext/atomic"]
                    }
                };

                res.status(200).json(response);

            } catch (error: any) {
                console.error(`Atomic Operations Error for ${modelName}:`, error);
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                res.status(status).json(errorResponse);
            }
        };

        this.router.post('/atomic', this.wrapHandler(handler));
    }

    /**
     * ?�일 ?�자???�업 ?�행
     */
    private async executeAtomicOperation(
        tx: any, 
        operation: any, 
        modelName: string, 
        options: any, 
        req: any
    ): Promise<any | null> {
        switch (operation.op) {
            case 'add':
                if (!operation.data) {
                    throw new Error('Add operation requires data');
                }
                
                const createData = operation.data.attributes || {};
                if (operation.data.relationships) {
                    const processedData = await this.processRelationships(
                        createData,
                        operation.data.relationships,
                        tx,
                        modelName
                    );
                    Object.assign(createData, processedData);
                }

                const created = await tx[modelName].create({ data: createData });
                return JsonApiTransformer.transformToResource(created, modelName);

            case 'update':
                if (!operation.ref || !operation.data) {
                    throw new Error('Update operation requires ref and data');
                }

                const updateData = operation.data.attributes || {};
                if (operation.data.relationships) {
                    const processedData = await this.processRelationships(
                        updateData,
                        operation.data.relationships,
                        tx,
                        modelName
                    );
                    Object.assign(updateData, processedData);
                }

                const updated = await tx[modelName].update({
                    where: { id: operation.ref.id },
                    data: updateData
                });
                return JsonApiTransformer.transformToResource(updated, modelName);

            case 'remove':
                if (!operation.ref) {
                    throw new Error('Remove operation requires ref');
                }

                if (operation.ref.relationship) {
                    // 관�??�거
                    const relationshipData: any = {};
                    relationshipData[operation.ref.relationship] = { disconnect: true };
                    
                    await tx[modelName].update({
                        where: { id: operation.ref.id },
                        data: relationshipData
                    });
                } else {
                    // 리소???�거
                    await tx[modelName].delete({
                        where: { id: operation.ref.id }
                    });
                }
                return null;

            default:
                throw new Error(`Unsupported atomic operation: ${operation.op}`);
        }
    }

    /**
     * JSON:API 고급 ?�러 검�?
     */
    private validateJsonApiResource(data: any, expectedType: string, req: any, res: any, isUpdate: boolean = false): boolean {
        // 리소??객체 구조 검�?
        if (!data || typeof data !== 'object') {
            const errorResponse = this.formatJsonApiError(
                new Error('Resource must be an object'),
                'INVALID_RESOURCE_STRUCTURE',
                400,
                req.path
            );
            res.status(400).json(errorResponse);
            return false;
        }

        // ?�???�드 검�?
        // if (!data.type || typeof data.type !== 'string') {
        //     const errorResponse = this.formatJsonApiError(
        //         new Error('Resource must have a type field'),
        //         'MISSING_RESOURCE_TYPE',
        //         400,
        //         req.path
        //     );
        //     res.status(400).json(errorResponse);
        //     return false;
        // }

        // ?�???�치 검�?
        // if (data.type !== expectedType) {
        //     const errorResponse = this.formatJsonApiError(
        //         new Error(`Resource type "${data.type}" does not match expected type "${expectedType}"`),
        //         'INVALID_RESOURCE_TYPE',
        //         409,
        //         req.path
        //     );
        //     res.status(409).json(errorResponse);
        //     return false;
        // }

        // ?�데?�트 ??ID ?�드 검�?
        if (isUpdate) {
            if (!data.id) {
                const errorResponse = this.formatJsonApiError(
                    new Error('Resource must have an id field for updates'),
                    'MISSING_RESOURCE_ID',
                    400,
                    req.path
                );
                res.status(400).json(errorResponse);
                return false;
            }

            // URL??ID?� 본문??ID ?�치 검�?
            const urlId = req.params.id || req.params.identifier;
            if (urlId && data.id !== urlId) {
                const errorResponse = this.formatJsonApiError(
                    new Error(`Resource id "${data.id}" does not match URL id "${urlId}"`),
                    'ID_MISMATCH',
                    400,
                    req.path
                );
                res.status(400).json(errorResponse);
                return false;
            }
        }

        // attributes?� relationships 검�?
        if (data.attributes && typeof data.attributes !== 'object') {
            const errorResponse = this.formatJsonApiError(
                new Error('Resource attributes must be an object'),
                'INVALID_ATTRIBUTES',
                400,
                req.path
            );
            res.status(400).json(errorResponse);
            return false;
        }

        if (data.relationships && typeof data.relationships !== 'object') {
            const errorResponse = this.formatJsonApiError(
                new Error('Resource relationships must be an object'),
                'INVALID_RELATIONSHIPS',
                400,
                req.path
            );
            res.status(400).json(errorResponse);
            return false;
        }

        return true;
    }

    /**
     * Content Negotiation ?�퍼 - JSON:API ?�펙 준??
     */
    // private validateJsonApiContentType(req: any, res: any): boolean {
    //     const contentType = req.get('Content-Type');
        
    //     if (contentType && !contentType.includes('application/vnd.api+json')) {
    //         const errorResponse = this.formatJsonApiError(
    //             new Error('Content-Type must be application/vnd.api+json'),
    //             'INVALID_CONTENT_TYPE',
    //             415,
    //             req.path
    //         );
    //         res.status(415).json(errorResponse);
    //         return false;
    //     }

    //     // 지?�하지 ?�는 미디???�???�라미터 검�?
    //     if (contentType) {
    //         const mediaTypeParams = this.parseMediaTypeParameters(contentType);
    //         for (const param of Object.keys(mediaTypeParams)) {
    //             if (param !== 'ext' && param !== 'profile') {
    //                 const errorResponse = this.formatJsonApiError(
    //                     new Error(`Unsupported media type parameter: ${param}`),
    //                     'UNSUPPORTED_MEDIA_TYPE_PARAMETER',
    //                     415,
    //                     req.path
    //                 );
    //                 res.status(415).json(errorResponse);
    //                 return false;
    //             }
    //         }
    //     }
        
    //     return true;
    // }

    /**
     * 미디???�???�라미터 ?�싱
     */
    private parseMediaTypeParameters(contentType: string): Record<string, string> {
        const params: Record<string, string> = {};
        const parts = contentType.split(';');
        
        for (let i = 1; i < parts.length; i++) {
            const [key, value] = parts[i].split('=').map(s => s.trim());
            if (key && value) {
                params[key] = value.replace(/"/g, '');
            }
        }
        
        return params;
    }

    /**
     * PATCH 부�??�데?�트 ?�략 처리
     */
    private async applyPatchStrategy(
        existingData: any,
        newData: any,
        strategy: 'merge' | 'replace' = 'merge'
    ): Promise<any> {
        if (strategy === 'replace') {
            return newData;
        }

        // merge ?�략: 기존 ?�이?��? ???�이?��? 병합
        const mergedData = { ...existingData };
        
        Object.keys(newData).forEach(key => {
            if (newData[key] !== undefined) {
                if (typeof newData[key] === 'object' && newData[key] !== null && !Array.isArray(newData[key])) {
                    // 객체??경우 ?��??�으�?병합
                    mergedData[key] = {
                        ...(mergedData[key] || {}),
                        ...newData[key]
                    };
                } else {
                    // ?�시�??�는 배열??경우 교체
                    mergedData[key] = newData[key];
                }
            }
        });

        return mergedData;
    }

    /**
     * JSON:API 관�??�이??처리 - ?�전??JSON:API 명세 준??
     * ?�성/?�정 ??관�??�이?��? Prisma ?�식?�로 변??
     * 기존 리소???�결�???리소???�성??모두 지??
     */
    private async processRelationships(
        data: any, 
        relationships: Record<string, JsonApiRelationship>, 
        client: any, 
        modelName: string,
        isUpdate: boolean = false
    ): Promise<any> {
        const processedData = { ...data };
        
        for (const [relationName, relationshipData] of Object.entries(relationships)) {
            if (relationshipData.data !== undefined) {
                // null??경우 - 관�??�거 (?�데?�트 ?�에�?
                if (relationshipData.data === null) {
                    if (isUpdate) {
                        processedData[relationName] = {
                            disconnect: true
                        };
                    }
                    // ?�성 ?�에??null 관계�? 무시
                }
                // 배열??경우 - ?��???관�?
                else if (Array.isArray(relationshipData.data)) {
                    if (relationshipData.data.length === 0) {
                        // �?배열 - 모든 관�??�거 (?�데?�트 ?�에�?
                        if (isUpdate) {
                            processedData[relationName] = {
                                set: []
                            };
                        }
                    } else {
                        // 관�??�이??처리
                        const connectIds = [];
                        const createData = [];
                        
                        for (const item of relationshipData.data) {
                            // console.log(`Processing relationship item in ${relationName}:`, JSON.stringify(item, null, 2));
                            
                            if (!item.type) {
                                throw new Error(`Invalid relationship data: missing type in ${relationName}`);
                            }
                            
                            // 기존 리소???�결 (id가 ?�는 경우)
                            if (item.id) {
                                // 관�?리소?��? ?�제�?존재?�는지 검�?(?�택??
                                const relatedModel = this.getModelNameFromResourceType(item.type);
                                if (relatedModel) {
                                    try {
                                        const exists = await client[relatedModel].findUnique({
                                            where: { id: item.id }
                                        });
                                        if (!exists) {
                                            throw new Error(`Related resource ${item.type}:${item.id} not found`);
                                        }
                                    } catch (error) {
                                        console.warn(`Could not verify existence of ${item.type}:${item.id}`, error);
                                    }
                                }
                                
                                connectIds.push({ id: item.id });
                            }
                            // ??리소???�성 (attributes가 ?�는 경우)
                            else if (this.hasAttributes(item)) {
                                // console.log(`Creating new resource for ${relationName} with attributes:`, item.attributes);
                                createData.push(item.attributes);
                            } else {
                                // console.log(`Invalid relationship item in ${relationName}:`, JSON.stringify(item, null, 2));
                                throw new Error(`Invalid relationship data: item must have either id (for connecting) or attributes (for creating) in ${relationName}`);
                            }
                        }
                        
                        // Prisma 관�??�이??구성
                        const relationshipConfig: any = {};
                        
                        if (connectIds.length > 0) {
                            if (isUpdate) {
                                relationshipConfig.connect = connectIds;
                            } else {
                                relationshipConfig.connect = connectIds;
                            }
                        }
                        
                        if (createData.length > 0) {
                            relationshipConfig.create = createData;
                        }
                        
                        // set ?�업?� ?�데?�트 ?�에�??�용 (기존 관계�? ?�전???��?
                        if (isUpdate && connectIds.length > 0 && createData.length === 0) {
                            processedData[relationName] = {
                                set: connectIds
                            };
                        } else {
                            processedData[relationName] = relationshipConfig;
                        }
                    }
                }
                // ?�일 객체??경우 - ?��???관�?
                else if (typeof relationshipData.data === 'object') {
                    if (!relationshipData.data.type) {
                        throw new Error(`Invalid relationship data: missing type in ${relationName}`);
                    }
                    
                    // 기존 리소???�결
                    if (relationshipData.data.id) {
                        // 관�?리소?��? ?�제�?존재?�는지 검�?(?�택??
                        const relatedModel = this.getModelNameFromResourceType(relationshipData.data.type);
                        if (relatedModel) {
                            try {
                                const exists = await client[relatedModel].findUnique({
                                    where: { id: relationshipData.data.id }
                                });
                                if (!exists) {
                                    throw new Error(`Related resource ${relationshipData.data.type}:${relationshipData.data.id} not found`);
                                }
                            } catch (error) {
                                console.warn(`Could not verify existence of ${relationshipData.data.type}:${relationshipData.data.id}`, error);
                            }
                        }
                        
                        processedData[relationName] = {
                            connect: { id: relationshipData.data.id }
                        };
                    }
                    // ??리소???�성
                    else if (this.hasAttributes(relationshipData.data)) {
                        processedData[relationName] = {
                            create: relationshipData.data.attributes
                        };
                    } else {
                        throw new Error(`Invalid relationship data: item must have either id (for connecting) or attributes (for creating) in ${relationName}`);
                    }
                }
            }
        }
        
        return processedData;
    }

    /**
     * 객체가 attributes�?가지�??�는지 ?�인?�는 ?�??가??
     */
    private hasAttributes(obj: any): obj is JsonApiResource {
        const result = obj && typeof obj === 'object' && 'attributes' in obj && obj.attributes != null;
        // console.log(`hasAttributes check for:`, JSON.stringify(obj, null, 2), `Result: ${result}`);
        return result;
    }

    /**
     * 리소???�?�에??모델명을 추론?�는 ?�퍼 메서??
     */
    private getModelNameFromResourceType(resourceType: string): string | null {
        // 캐�?케?�스�?변??(orderItem -> OrderItem)
        const pascalCase = resourceType
            .split(/[-_]/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
        
        // 복수??-> ?�수??변??
        if (pascalCase.endsWith('ies')) {
            return pascalCase.slice(0, -3) + 'y'; // Categories -> Category
        } else if (pascalCase.endsWith('s') && !pascalCase.endsWith('ss')) {
            return pascalCase.slice(0, -1); // Users -> User, Orders -> Order
        }
        
        return pascalCase; // OrderItem -> OrderItem (?�수??그�?�?
    }

    /**
     * UPDATE ?�우???�정 (PUT /:identifier, PATCH /:identifier) - JSON:API 준??
     */
    private setupUpdateRoute(
        client: any, 
        modelName: string, 
        options?: any, 
        primaryKey: string = 'id', 
        primaryKeyParser: (value: string) => any = ExpressRouter.parseString
    ): void {
        const middlewares = options?.middleware?.update || [];
        
        const handler: HandlerFunction = async (req, res, injected, repo, db) => {
            try {
                // JSON:API Content-Type ?�더 ?�정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // Content Negotiation 검�?
                // if (!this.validateJsonApiContentType(req, res)) {
                //     return;
                // }
                
                // ?�라미터 추출 �?검�?
                const extractResult = this.extractAndParsePrimaryKey(req, res, primaryKey, primaryKeyParser, modelName);
                if (!extractResult.success) return; // ?�러 ?�답?� ?�퍼 메서?�에??처리

                const { parsedIdentifier } = extractResult;

                // JSON:API ?�청 ?�식 검�?
                if (!req.body || !req.body.data) {
                    // 리소???�?�을 ?�적?�로 결정
                    const routeResourceType = req.baseUrl.split('/').filter(Boolean).pop() || modelName.toLowerCase();
                    const resourceType = options?.resourceType || routeResourceType;
                    
                    const exampleRequest = {
                        data: {
                            type: resourceType,
                            id: String(parsedIdentifier),
                            attributes: {
                                // "fieldName": "fieldValue"
                                // ?? "email": "user@example.com"
                            }
                        }
                    };
                    
                    const errorDetail = `Request must contain a data object following JSON:API specification. Expected format: ${JSON.stringify(exampleRequest, null, 2)}`;
                    const errorResponse = this.formatJsonApiError(
                        new Error(errorDetail),
                        'INVALID_REQUEST',
                        400,
                        req.path
                    );
                    return res.status(400).json(errorResponse);
                }

                const { data: requestData } = req.body;
                
                // 리소???�??검�?(?�우??경로?�서 추출 ?�는 ?�션 ?�용)
                const routeResourceType = req.baseUrl.split('/').filter(Boolean).pop() || modelName.toLowerCase();
                const expectedType = options?.resourceType || routeResourceType;

                // JSON:API 리소??구조 검�?(?�데?�트??
                if (!this.validateJsonApiResource(requestData, expectedType, req, res, true)) {
                    return;
                }

                // attributes?�서 ?�이??추출
                let data = requestData.attributes || {};

                // 관�??�이??처리 (relationships가 ?�는 경우)
                if (requestData.relationships) {
                    try {
                        data = await this.processRelationships(
                            data, 
                            requestData.relationships, 
                            client, 
                            modelName,
                            true // ?�데?�트 모드
                        );
                    } catch (relationshipError: any) {
                        const errorResponse = this.formatJsonApiError(
                            relationshipError,
                            'INVALID_RELATIONSHIP',
                            422,
                            req.path
                        );
                        return res.status(422).json(errorResponse);
                    }
                }

                // �?값이??null 값들 ?�리�??�행
                data = this.cleanEmptyValues(data);

                // Before hook ?�행
                if (options?.hooks?.beforeUpdate) {
                    data = await options.hooks.beforeUpdate(data, req);
                }

                const result = await client[modelName].update({
                    where: { [primaryKey]: parsedIdentifier },
                    data
                });

                // After hook ?�행
                if (options?.hooks?.afterUpdate) {
                    await options.hooks.afterUpdate(result, req);
                }

                // Base URL ?�성
                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;

                // JSON:API ?�답 ?�성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    result,
                    modelName,
                    {
                        primaryKey,
                        baseUrl,
                        includeMerge: options?.includeMerge || false
                    }
                );
                
                // metadata 객체 ?�성 - 기존 ?�퍼 ?�수 ?�용
                const metadata = CrudResponseFormatter.createPaginationMeta(
                    [result], // ?�정???�일 ??��??배열�?감싸???�달
                    1,        // total count??1
                    undefined, // page ?�라미터 ?�음 (?�일 ?�정)
                    'update',
                    undefined, // includedRelations ?�음
                    undefined  // queryParams ?�음
                );
                
                // BigInt?� DATE ?�??직렬??처리
                const serializedResponse = serialize({ ...response, metadata });
                
                res.json(serializedResponse);
                
            } catch (error: any) {
                console.error(`CRUD Update Error for ${modelName}:`, error);
                
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                
                res.status(status).json(errorResponse);
            }
        };

        // PUT�?PATCH 모두 ?�록
        const routePath = `/:${primaryKey}`;
        const registerMethod = (method: 'put' | 'patch') => {
            if (options?.validation?.update) {
                const validationMiddlewares = CustomRequestHandler.withValidation(
                    options.validation.update,
                    handler as any
                );
                
                if (middlewares.length > 0) {
                    this.router[method](routePath, ...middlewares, ...validationMiddlewares);
                } else {
                    this.router[method](routePath, ...validationMiddlewares);
                }
            } else {
                if (middlewares.length > 0) {
                    this.router[method](routePath, ...middlewares, this.wrapHandler(handler));
                } else {
                    this.router[method](routePath, this.wrapHandler(handler));
                }
            }
        };

        registerMethod('put');
        registerMethod('patch');

        // 문서???�록 (PUT/PATCH ?�일) - JSON:API ?�식
        ['PUT', 'PATCH'].forEach(method => {
            this.registerDocumentation(method, routePath, {
                summary: `Update ${modelName} by ${primaryKey} (JSON:API)`,
                parameters: {
                    params: {
                        [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                    },
                    body: {
                        type: 'object',
                        required: true,
                        description: 'JSON:API resource object with optional relationships',
                        properties: {
                            data: {
                                type: 'object',
                                required: true,
                                properties: {
                                    type: { type: 'string', required: true, description: 'Resource type' },
                                    id: { type: 'string', required: false, description: 'Resource ID (must match URL parameter)' },
                                    attributes: options?.validation?.update?.body || 
                                              { type: 'object', required: true, description: `${modelName} attributes to update` },
                                    relationships: { 
                                        type: 'object', 
                                        required: false, 
                                        description: 'JSON:API relationships object for updating related resources (set/connect/disconnect)' 
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        data: { type: 'object', required: true, description: `Updated ${modelName} resource` }
                    },
                    404: {
                        errors: { type: 'array', required: true, description: 'JSON:API error objects' }
                    },
                    400: {
                        errors: { type: 'array', required: true, description: 'JSON:API error objects' }
                    },
                    422: {
                        errors: { type: 'array', required: true, description: 'JSON:API validation errors including relationship errors' }
                    }
                }
            });
        });
    }





    /**
     * DESTROY ?�우???�정 (DELETE /:identifier) - JSON:API 준??
     */
    private setupDestroyRoute(
        client: any, 
        modelName: string, 
        options?: any, 
        primaryKey: string = 'id', 
        primaryKeyParser: (value: string) => any = ExpressRouter.parseString
    ): void {
        const middlewares = options?.middleware?.destroy || [];
        const isSoftDelete = options?.softDelete?.enabled;
        const softDeleteField = options?.softDelete?.field || 'deletedAt';
        
        const handler: HandlerFunction = async (req, res, injected, repo, db) => {
            try {
                // JSON:API Content-Type ?�더 ?�정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // Content Negotiation 검�?(DELETE ?�청??본문???�는 경우)
                if (req.body && Object.keys(req.body).length > 0) {
                    // if (!this.validateJsonApiContentType(req, res)) {
                    //     return;
                    // }
                }
                
                // ?�라미터 추출 �??�싱
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return; // ?�러 ?�답?� ?��? ?�퍼?�서 처리??

                // Before hook ?�행
                if (options?.hooks?.beforeDestroy) {
                    await options.hooks.beforeDestroy(parsedIdentifier, req);
                }

                if (isSoftDelete) {
                    // Soft Delete: ??�� ?�간 ?�정
                    const result = await client[modelName].update({
                        where: { [primaryKey]: parsedIdentifier },
                        data: { [softDeleteField]: new Date() }
                    });

                    // After hook ?�행
                    if (options?.hooks?.afterDestroy) {
                        await options.hooks.afterDestroy(parsedIdentifier, req);
                    }

                    // metadata 객체 ?�성 - 기존 ?�퍼 ?�수 ?�용
                    const metadata = CrudResponseFormatter.createPaginationMeta(
                        [result], // ??��???�일 ??��??배열�?감싸???�달
                        1,        // total count??1
                        undefined, // page ?�라미터 ?�음 (?�일 ??��)
                        'soft_delete',
                        undefined, // includedRelations ?�음
                        undefined  // queryParams ?�음
                    );
                    
                    // soft delete ?�용 ?�드 추�?
                    metadata.wasSoftDeleted = false; // ?�전?�는 ??��?��? ?�았??

                    // JSON:API 준??- ?�공?�인 soft delete ?�답 (200 OK with meta)
                    const response = {
                        jsonapi: {
                            version: "1.1"
                        },
                        meta: {
                            operation: 'soft_delete',
                            timestamp: metadata.timestamp,
                            [softDeleteField]: result[softDeleteField]
                        },
                        metadata
                    };
                    
                    res.status(200).json(response);
                } else {
                    // ??�� ??존재 ?��? ?�인 (404 처리�??�해)
                    const existingItem = await client[modelName].findUnique({
                        where: { [primaryKey]: parsedIdentifier },
                    });

                    if (!existingItem) {
                        const errorResponse = this.formatJsonApiError(
                            new Error(`${modelName} not found`),
                            'NOT_FOUND',
                            404,
                            req.path
                        );
                        return res.status(404).json(errorResponse);
                    }

                    // Hard Delete: ?�전 ??��
                    await client[modelName].delete({
                        where: { [primaryKey]: parsedIdentifier }
                    });

                    // After hook ?�행
                    if (options?.hooks?.afterDestroy) {
                        await options.hooks.afterDestroy(parsedIdentifier, req);
                    }

                    // JSON:API ??�� ?�공 ?�답 (204 No Content)
                    res.status(204).end();
                }
                
            } catch (error: any) {
                console.error(`CRUD Destroy Error for ${modelName}:`, error);
                
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                
                res.status(status).json(errorResponse);
            }
        };

        // 미들?�어 ?�록
        const routePath = `/:${primaryKey}`;
        if (middlewares.length > 0) {
            this.router.delete(routePath, ...middlewares, this.wrapHandler(handler));
        } else {
            this.router.delete(routePath, this.wrapHandler(handler));
        }

        // 문서???�록 - JSON:API ?�식
        const deleteDescription = isSoftDelete ? 
            `Soft delete ${modelName} by ${primaryKey} (JSON:API)` : 
            `Delete ${modelName} by ${primaryKey} (JSON:API)`;
            
        const deleteResponses = isSoftDelete ? {
            200: {
                meta: { type: 'object', required: true, description: 'Soft delete metadata with timestamp' }
            },
            404: {
                errors: { type: 'array', required: true, description: 'JSON:API error objects' }
            }
        } : {
            204: {
                description: 'Successfully deleted (no content)'
            },
            404: {
                errors: { type: 'array', required: true, description: 'JSON:API error objects' }
            }
        };
        
        this.registerDocumentation('DELETE', routePath, {
            summary: deleteDescription,
            parameters: {
                params: {
                    [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                }
            },
            responses: deleteResponses
        });
    }

    /**
     * RECOVER ?�우???�정 (POST /:identifier/recover) - JSON:API 준??
     */
    private setupRecoverRoute(
        client: any, 
        modelName: string, 
        options?: any, 
        primaryKey: string = 'id', 
        primaryKeyParser: (value: string) => any = ExpressRouter.parseString
    ): void {
        const middlewares = options?.middleware?.recover || [];
        
        const handler: HandlerFunction = async (req, res, injected, repo, db) => {
            try {
                // JSON:API Content-Type ?�더 ?�정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // ?�라미터 추출 �??�싱
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return; // ?�러 ?�답?� ?��? ?�퍼?�서 처리??

                // Before hook ?�행
                if (options?.hooks?.beforeRecover) {
                    await options.hooks.beforeRecover(parsedIdentifier, req);
                }

                // 먼�? ?�재 ?�태 ?�인 (?�프????��???�태?��? 체크)
                const existingItem = await client[modelName].findFirst({
                    where: { 
                        [primaryKey]: parsedIdentifier,
                        deletedAt: { not: null } // ?�프????��????���?조회
                    }
                });

                if (!existingItem) {
                    // ??��???�거???��? 복구???�태
                    const activeItem = await client[modelName].findUnique({
                        where: { [primaryKey]: parsedIdentifier }
                    });
                    
                    if (activeItem) {
                        const errorResponse = this.formatJsonApiError(
                            new Error(`${modelName} is already active (not deleted)`),
                            'CONFLICT',
                            409,
                            req.path
                        );
                        return res.status(409).json(errorResponse);
                    } else {
                        const errorResponse = this.formatJsonApiError(
                            new Error(`${modelName} not found`),
                            'NOT_FOUND',
                            404,
                            req.path
                        );
                        return res.status(404).json(errorResponse);
                    }
                }

                // 복구 ?�행 (deletedAt??null�??�정)
                const result = await client[modelName].update({
                    where: { [primaryKey]: parsedIdentifier },
                    data: { deletedAt: null }
                });

                // After hook ?�행
                if (options?.hooks?.afterRecover) {
                    await options.hooks.afterRecover(result, req);
                }

                // metadata 객체 ?�성 - 기존 ?�퍼 ?�수 ?�용
                const metadata = CrudResponseFormatter.createPaginationMeta(
                    [result], // 복구???�일 ??��??배열�?감싸???�달
                    1,        // total count??1
                    undefined, // page ?�라미터 ?�음 (?�일 복구)
                    'recover',
                    undefined, // includedRelations ?�음
                    undefined  // queryParams ?�음
                );
                
                // recover ?�용 ?�드 추�?
                metadata.wasSoftDeleted = true;

                // JSON:API ?�답 ?�맷
                const response = {
                    data: this.transformToJsonApiResource(result, modelName, req, primaryKey),
                    jsonapi: {
                        version: "1.0"
                    },
                    meta: {
                        operation: 'recover',
                        timestamp: metadata.timestamp
                    },
                    metadata
                };
                
                // BigInt?� DATE ?�??직렬??처리
                const serializedResponse = serialize(response);
                
                res.json(serializedResponse);
                
            } catch (error: any) {
                console.error(`CRUD Recover Error for ${modelName}:`, error);
                
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                
                res.status(status).json(errorResponse);
            }
        };

        // Validation???�는 경우
        const routePath = `/:${primaryKey}/recover`;
        if (options?.validation?.recover) {
            const validationMiddlewares = CustomRequestHandler.withValidation(
                options.validation.recover,
                handler as any
            );
            
            if (middlewares.length > 0) {
                this.router.post(routePath, ...middlewares, ...validationMiddlewares);
            } else {
                this.router.post(routePath, ...validationMiddlewares);
            }
        } else {
            // ?�반 ?�들??
            if (middlewares.length > 0) {
                this.router.post(routePath, ...middlewares, this.wrapHandler(handler));
            } else {
                this.router.post(routePath, this.wrapHandler(handler));
            }
        }

        // 문서???�록 - JSON:API ?�식
        this.registerDocumentation('POST', routePath, {
            summary: `Recover soft-deleted ${modelName} by ${primaryKey} (JSON:API)`,
            parameters: {
                params: {
                    [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                },
                body: options?.validation?.recover?.body || undefined
            },
            responses: {
                200: {
                    data: { type: 'object', required: true, description: `Recovered ${modelName} resource` },
                    meta: { 
                        type: 'object', 
                        required: true, 
                        description: 'Recovery operation metadata' 
                    }
                },
                404: {
                    errors: { type: 'array', required: true, description: 'JSON:API error objects' }
                },
                409: {
                    errors: { type: 'array', required: true, description: 'JSON:API error objects' }
                }
            }
        });
    }






    /**
     * JSON:API 리소??객체�?변?�하???�퍼 메서??
     */
    private transformToJsonApiResource(item: any, modelName: string, req: any, primaryKey: string = 'id'): any {
        const resourceType = modelName.toLowerCase();
        const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
        
        // Primary key �?추출
        const id = item[primaryKey] || item.id || item.uuid || item._id || Object.values(item)[0];
        
        // attributes?�서 primary key?� 관�??�드 ?�외
        const attributes = { ...item };
        delete attributes[primaryKey];
        
        // primaryKey가 'id'가 ?�닌 경우, 기존 'id' ?�드??attributes???��?
        // ?�른 기본 ID ?�드?��? ?�거 (중복 방�?)
        if (primaryKey !== 'uuid') delete attributes.uuid;
        if (primaryKey !== '_id') delete attributes._id;
        
        // 관�??�드 분리
        const relationships: any = {};
        const resourceAttributes: any = {};
        
        Object.keys(attributes).forEach(key => {
            const value = attributes[key];
            // 배열?�거??객체?�면??id�?가�?경우 관계로 처리
            if (Array.isArray(value) || (value && typeof value === 'object' && value.id)) {
                relationships[key] = {
                    links: {
                        self: `${baseUrl}/${id}/relationships/${key}`,
                        related: `${baseUrl}/${id}/${key}`
                    }
                };
                
                // 관�??�이?��? ?�함??경우
                if (Array.isArray(value)) {
                    relationships[key].data = value.map((relItem: any) => ({
                        type: key.slice(0, -1), // 복수?�에???�수?�으�?(간단??변??
                        id: relItem.id || relItem.uuid || relItem._id
                    }));
                } else if (value.id) {
                    relationships[key].data = {
                        type: key,
                        id: value.id || value.uuid || value._id
                    };
                }
            } else {
                resourceAttributes[key] = value;
            }
        });
        
        const resource: any = {
            type: resourceType,
            id: String(id),
            attributes: resourceAttributes,
            links: {
                self: `${baseUrl}/${id}`
            }
        };
        
        // 관계�? ?�는 경우?�만 relationships ?�드 추�?
        if (Object.keys(relationships).length > 0) {
            resource.relationships = relationships;
        }
        
        return resource;
    }

    /**
     * ?�이지?�이??URL ?�성 ?�퍼 메서??
     */
    private buildPaginationUrl(baseUrl: string, query: any, page: number, size: number): string {
        const params = new URLSearchParams();
        
        // 기존 쿼리 ?�라미터 ?��? (page ?�외)
        Object.keys(query).forEach(key => {
            if (!key.startsWith('page[')) {
                const value = query[key];
                // 객체??배열??경우 JSON.stringify�?직렬?�하거나 무시
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    params.append(key, String(value));
                } else if (Array.isArray(value)) {
                    // 배열??경우 �??�소�?개별?�으�?추�?
                    value.forEach(item => {
                        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
                            params.append(key, String(item));
                        }
                    });
                }
                // 객체??경우??무시 (page 객체 ??
            }
        });
        
        // ?�이지?�이???�라미터 추�?
        params.append('page[number]', String(page));
        params.append('page[size]', String(size));
        
        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * 공통 JSON:API 기본 구조 ?�성 ?�퍼
     */
    private createBaseJsonApiStructure(): any {
        return {
            jsonapi: {
                version: "1.1",
                // ext: ["https://jsonapi.org/ext/atomic"],
                // profile: ["https://jsonapi.org/profiles/ethanresnick/cursor-pagination/"],
                meta: {
                    implementation: "express.js-kusto v2.0",
                    // implementedFeatures: [
                    //     "sparse-fieldsets",
                    //     "compound-documents", 
                    //     "resource-relationships",
                    //     "pagination",
                    //     "sorting",
                    //     "filtering",
                    //     "atomic-operations",
                    //     "content-negotiation",
                    //     "resource-identification"
                    // ],
                    // supportedExtensions: [
                    //     "https://jsonapi.org/ext/atomic"
                    // ],
                    // supportedProfiles: [
                    //     "https://jsonapi.org/profiles/ethanresnick/cursor-pagination/"
                    // ]
                }
            }
        };
    }

    /**
     * JSON:API ?�러 ?�식?�로 ?�맷?�는 ?�퍼 메서??(?�합 ErrorHandler ?�용)
     */
    private formatJsonApiError(error: Error | unknown, code: string, status: number, path: string, method?: string): JsonApiErrorResponse {
        return ErrorHandler.handleError(error, {
            format: ErrorResponseFormat.JSON_API,
            context: {
                code,
                status,
                path,
                method: method || 'UNKNOWN',
                source: {
                    pointer: path
                }
            },
            security: {
                isDevelopment: process.env.NODE_ENV === 'development',
                sanitizeDetails: process.env.NODE_ENV !== 'development',
                maxDetailLength: 500
            }
        });
    }


    /**
     * �?값들 ?�리 (undefined, �?객체, �?배열 ??
     */
    private cleanEmptyValues(data: any): any {
        const cleanedData = { ...data };
        
        Object.keys(cleanedData).forEach(key => {
            const value = cleanedData[key];
            
            // undefined ?�거
            if (value === undefined) {
                delete cleanedData[key];
                return;
            }
            
            // �?객체 ?�거 (null???�닌 경우)
            if (typeof value === 'object' && value !== null) {
                if (Array.isArray(value)) {
                    // �?배열 ?�거 (?�정???�라)
                    if (value.length === 0) {
                        delete cleanedData[key];
                    }
                } else {
                    // �?객체 ?�거
                    if (Object.keys(value).length === 0) {
                        delete cleanedData[key];
                    }
                }
            }
        });

        return cleanedData;
    }

    /**
     * HTTP ?�태 코드???�른 ?�러 ?�목 반환
     */
    private getErrorTitle(status: number): string {
        switch (status) {
            case 400: return 'Bad Request';
            case 401: return 'Unauthorized';
            case 403: return 'Forbidden';
            case 404: return 'Not Found';
            case 409: return 'Conflict';
            case 422: return 'Unprocessable Entity';
            case 500: return 'Internal Server Error';
            default: return 'Error';
        }
    }

    /**
     * ?�청?�서 primary key ?�라미터�?추출?�고 ?�싱?�는 ?�퍼 메서??- JSON:API ?�??
     */
    private extractAndParsePrimaryKey(
        req: any, 
        res: any, 
        primaryKey: string, 
        primaryKeyParser: (value: string) => any,
        modelName: string
    ): { success: boolean; parsedIdentifier?: any } {
        // ?�라미터 추출
        let identifier: string;
        
        if (primaryKey !== 'id' && req.params[primaryKey]) {
            identifier = req.params[primaryKey];
        } else if (req.params.id) {
            identifier = req.params.id;
        } else {
            const paramKeys = Object.keys(req.params);
            if (paramKeys.length > 0) {
                identifier = req.params[paramKeys[0]];
            } else {
                const errorResponse = this.formatJsonApiError(
                    new Error(`Missing ${primaryKey} parameter`),
                    'VALIDATION_ERROR',
                    400,
                    req.path
                );
                res.status(400).json(errorResponse);
                return { success: false };
            }
        }

        // ?�라미터 ?�효??검??
        if (!identifier || identifier.trim() === '') {
            const errorResponse = this.formatJsonApiError(
                new Error(`Invalid ${primaryKey} parameter`),
                'VALIDATION_ERROR',
                400,
                req.path
            );
            res.status(400).json(errorResponse);
            return { success: false };
        }

        // Primary key ?�싱 ???�러 처리
        try {
            const parsedIdentifier = primaryKeyParser(identifier);
            return { success: true, parsedIdentifier };
        } catch (parseError: any) {
            const { code, status } = ErrorFormatter.mapPrismaError(parseError);
            const errorResponse = this.formatJsonApiError(parseError, code, status, req.path, req.method);
            res.status(status).json(errorResponse);
            return { success: false };
        }
    }






    /**
     * ID ?�싱 ?�퍼 (문자?�을 ?�자�?변???�도)
     */
    private parseId = (id: string): any => {
        // ?�자??경우 ?�수�?변??
        if (/^\d+$/.test(id)) {
            return parseInt(id, 10);
        }
        // UUID ?�의 경우 문자??그�?�?반환
        return id;
    };





    /**
     * UUID ?�용 ?�서 (검�??�함)
     */
    public static parseUuid = (uuid: string): string => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(uuid)) {
            throw new Error(`Invalid UUID format: ${uuid}`);
        }
        return uuid;
    };





    /**
     * 문자??그�?�?반환?�는 ?�서
     */
    public static parseString = (value: string): string => {
        return value;
    };





    /**
     * ?�수 ?�용 ?�서 (검�??�함)
     */
    public static parseInt = (value: string): number => {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
            throw new Error(`Invalid integer format: ${value}`);
        }
        return parsed;
    };

    /**
     * 문서???�록 ?�퍼
     */
    private registerDocumentation(method: string, path: string, config: any): void {
        if (this.basePath) {
            DocumentationGenerator.registerRoute({
                method,
                path: this.getFullPath(path),
                ...config
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
                responseConfig: config.responses
            });
        }
    }

    /**
     * JSON:API Relationship ?�우???�정
     * 관�??�체�?관리하???�우?��? 관??리소?��? 조회?�는 ?�우?��? ?�성
     */
    private setupRelationshipRoutes(
        client: any, 
        modelName: string, 
        options?: any, 
        primaryKey: string = 'id', 
        primaryKeyParser: (value: string) => any = ExpressRouter.parseString
    ): void {
        // ?�재??기본?�인 관�?조회 ?�우?�만 구현
        // ?�후 ?�장 가?? POST, PATCH, DELETE for relationships
        
        // GET /:identifier/:relationName - 관??리소??직접 조회
        this.router.get(`/:${primaryKey}/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return;

                const relationName = req.params.relationName;
                
                // 쿼리 ?�라미터 ?�싱 (include, fields, sort, pagination 지??
                const queryParams = CrudQueryParser.parseQuery(req);
                
                // 기본 리소??조회
                const item = await client[modelName].findUnique({
                    where: { [primaryKey]: parsedIdentifier },
                    include: { [relationName]: true }
                });

                if (!item) {
                    const errorResponse = this.formatJsonApiError(
                        new Error(`${modelName} not found`),
                        'NOT_FOUND',
                        404,
                        req.path
                    );
                    return res.status(404).json(errorResponse);
                }

                const relationData = item[relationName];
                
                if (!relationData) {
                    const errorResponse = this.formatJsonApiError(
                        new Error(`Relationship '${relationName}' not found`),
                        'RELATIONSHIP_NOT_FOUND',
                        404,
                        req.path
                    );
                    return res.status(404).json(errorResponse);
                }

                // Base URL ?�성
                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
                
                // 관�?리소???�??추론
                const relationResourceType = JsonApiTransformer.inferResourceTypeFromRelationship(
                    relationName, 
                    Array.isArray(relationData)
                );

                // JSON:API ?�답 ?�성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    relationData,
                    relationResourceType,
                    {
                        primaryKey: 'id',
                        fields: queryParams.fields,
                        baseUrl,
                        links: {
                            self: `${baseUrl}/${modelName.toLowerCase()}/${parsedIdentifier}/${relationName}`,
                            related: `${baseUrl}/${modelName.toLowerCase()}/${parsedIdentifier}/relationships/${relationName}`
                        }
                    }
                );

                res.json(serialize(response));

            } catch (error: any) {
                console.error(`Related Resource Error for ${modelName}:`, error);
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                res.status(status).json(errorResponse);
            }
        });

        // GET /:identifier/relationships/:relationName - 관�??�체 조회
        this.router.get(`/:${primaryKey}/relationships/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return;

                const relationName = req.params.relationName;
                
                // 기본 리소??조회
                const item = await client[modelName].findUnique({
                    where: { [primaryKey]: parsedIdentifier },
                    include: { [relationName]: true }
                });

                if (!item) {
                    const errorResponse = this.formatJsonApiError(
                        new Error(`${modelName} not found`),
                        'NOT_FOUND',
                        404,
                        req.path
                    );
                    return res.status(404).json(errorResponse);
                }

                const relationData = item[relationName];
                
                // 관�??�이?��? JSON:API ?�식?�로 변??
                let data = null;
                if (relationData) {
                    if (Array.isArray(relationData)) {
                        data = relationData.map(relItem => ({
                            type: JsonApiTransformer.inferResourceTypeFromRelationship(relationName, true),
                            id: String(relItem.id || relItem.uuid || relItem._id)
                        }));
                    } else {
                        data = {
                            type: JsonApiTransformer.inferResourceTypeFromRelationship(relationName, false),
                            id: String(relationData.id || relationData.uuid || relationData._id)
                        };
                    }
                }

                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
                const response = {
                    data,
                    links: {
                        self: `${baseUrl}/${modelName.toLowerCase()}/${parsedIdentifier}/relationships/${relationName}`,
                        related: `${baseUrl}/${modelName.toLowerCase()}/${parsedIdentifier}/${relationName}`
                    },
                    jsonapi: {
                        version: "1.1"
                    }
                };

                res.json(serialize(response));

            } catch (error: any) {
                console.error(`Relationship Error for ${modelName}:`, error);
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                res.status(status).json(errorResponse);
            }
        });

        // POST /:identifier/relationships/:relationName - 관�?추�?
        this.router.post(`/:${primaryKey}/relationships/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // Content-Type 검�?
                const contentType = req.get('Content-Type');
                if (contentType && !contentType.includes('application/vnd.api+json')) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Content-Type must be application/vnd.api+json'),
                        'INVALID_CONTENT_TYPE',
                        415,
                        req.path
                    );
                    return res.status(415).json(errorResponse);
                }
                
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return;

                const relationName = req.params.relationName;
                
                if (!req.body || !req.body.data) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Request must contain data field with relationship identifiers'),
                        'INVALID_REQUEST',
                        400,
                        req.path
                    );
                    return res.status(400).json(errorResponse);
                }

                const relationshipData = req.body.data;
                let connectData;

                if (Array.isArray(relationshipData)) {
                    connectData = { [relationName]: { connect: relationshipData.map((item: any) => ({ id: item.id })) } };
                } else {
                    connectData = { [relationName]: { connect: { id: relationshipData.id } } };
                }

                await client[modelName].update({
                    where: { [primaryKey]: parsedIdentifier },
                    data: connectData
                });

                res.status(204).end();

            } catch (error: any) {
                console.error(`Relationship Update Error for ${modelName}:`, error);
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                res.status(status).json(errorResponse);
            }
        });

        // PATCH /:identifier/relationships/:relationName - 관�??�전 교체
        this.router.patch(`/:${primaryKey}/relationships/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // Content-Type 검�?
                const contentType = req.get('Content-Type');
                if (contentType && !contentType.includes('application/vnd.api+json')) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Content-Type must be application/vnd.api+json'),
                        'INVALID_CONTENT_TYPE',
                        415,
                        req.path
                    );
                    return res.status(415).json(errorResponse);
                }
                
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return;

                const relationName = req.params.relationName;
                
                if (!req.body || req.body.data === undefined) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Request must contain data field'),
                        'INVALID_REQUEST',
                        400,
                        req.path
                    );
                    return res.status(400).json(errorResponse);
                }

                const relationshipData = req.body.data;
                let updateData;

                if (relationshipData === null) {
                    // 관�??�거
                    updateData = { [relationName]: { disconnect: true } };
                } else if (Array.isArray(relationshipData)) {
                    // ?��???관�?교체
                    updateData = { 
                        [relationName]: { 
                            set: relationshipData.map((item: any) => ({ id: item.id })) 
                        } 
                    };
                } else {
                    // ?��???관�?교체
                    updateData = { [relationName]: { connect: { id: relationshipData.id } } };
                }

                await client[modelName].update({
                    where: { [primaryKey]: parsedIdentifier },
                    data: updateData
                });

                res.status(204).end();

            } catch (error: any) {
                console.error(`Relationship Replace Error for ${modelName}:`, error);
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                res.status(status).json(errorResponse);
            }
        });

        // DELETE /:identifier/relationships/:relationName - 관�??�거
        this.router.delete(`/:${primaryKey}/relationships/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // Content-Type 검�?
                const contentType = req.get('Content-Type');
                if (contentType && !contentType.includes('application/vnd.api+json')) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Content-Type must be application/vnd.api+json'),
                        'INVALID_CONTENT_TYPE',
                        415,
                        req.path
                    );
                    return res.status(415).json(errorResponse);
                }
                
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return;

                const relationName = req.params.relationName;
                
                if (!req.body || !req.body.data) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Request must contain data field with relationship identifiers to remove'),
                        'INVALID_REQUEST',
                        400,
                        req.path
                    );
                    return res.status(400).json(errorResponse);
                }

                const relationshipData = req.body.data;
                let disconnectData;

                if (Array.isArray(relationshipData)) {
                    disconnectData = { [relationName]: { disconnect: relationshipData.map((item: any) => ({ id: item.id })) } };
                } else {
                    disconnectData = { [relationName]: { disconnect: { id: relationshipData.id } } };
                }

                await client[modelName].update({
                    where: { [primaryKey]: parsedIdentifier },
                    data: disconnectData
                });

                res.status(204).end();

            } catch (error: any) {
                console.error(`Relationship Delete Error for ${modelName}:`, error);
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                res.status(status).json(errorResponse);
            }
        });

        // GET /:identifier/:relationName - 관??리소??조회
        this.router.get(`/:${primaryKey}/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return;

                const relationName = req.params.relationName;
                const queryParams = CrudQueryParser.parseQuery(req);
                
                // 기본 리소??조회
                const item = await client[modelName].findUnique({
                    where: { [primaryKey]: parsedIdentifier },
                    include: { [relationName]: true }
                });

                if (!item) {
                    const errorResponse = this.formatJsonApiError(
                        new Error(`${modelName} not found`),
                        'NOT_FOUND',
                        404,
                        req.path
                    );
                    return res.status(404).json(errorResponse);
                }

                const relationData = item[relationName];
                
                if (!relationData) {
                    // 관계�? ?�는 경우 �??�이??반환
                    const response = {
                        data: Array.isArray(relationData) ? [] : null,
                        jsonapi: {
                            version: "1.1"
                        }
                    };
                    return res.json(response);
                }

                // Base URL ?�성
                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
                const resourceType = JsonApiTransformer.inferResourceTypeFromRelationship(relationName, Array.isArray(relationData));

                // JSON:API ?�답 ?�성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    relationData,
                    resourceType,
                    {
                        primaryKey: 'id', // 관??리소?�는 기본?�으�?id ?�용
                        fields: queryParams.fields,
                        baseUrl
                    }
                );

                res.json(serialize(response));

            } catch (error: any) {
                console.error(`Related Resource Error for ${modelName}:`, error);
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
                res.status(status).json(errorResponse);
            }
        });
    }

    



    public build(): Router {
        const router = this.router;

        // ExpressRouter ?�스?�스???�??참조�??��??�여 setBasePath ?�출??가?�하?�록 ??
        (router as any).setBasePath = (path: string) => {
            this.setBasePath(path);
            return router;
        };
        return router; // 최종 Express Router ?�스?�스 반환
    }
}
