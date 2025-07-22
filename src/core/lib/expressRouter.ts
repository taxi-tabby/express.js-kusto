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
import './types/express-extensions';


export type HandlerFunction = (req: Request, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => void;
export type ValidatedHandlerFunction = (req: ValidatedRequest, res: Response, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => Promise<any> | any;
export type MiddlewareHandlerFunction = (req: Request, res: Response, next: NextFunction, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => void;
export type ValidatedMiddlewareHandlerFunction = (req: ValidatedRequest, res: Response, next: NextFunction, injected: Injectable, repo: typeof repositoryManager, db: typeof prismaManager) => Promise<any> | any;

/**
 * Extract model names from a Prisma client type
 * (prisma client 에서 사전에 정의 것들)
 */
type ExtractModelNames<T> = T extends { [K in keyof T]: any }
  ? Exclude<keyof T, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends' | '$executeRaw' | '$executeRawUnsafe' | '$queryRaw' | '$queryRawUnsafe'> & string
  : never;

  
/**
 * Get available model names for a specific database
 * (Prisma 에서 정적으로 모델명만 추출하기 위한 타입)
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
     * MiddlewareHandlerFunction을 Express 호환 미들웨어로 래핑하는 헬퍼 메서드
     */
    private wrapMiddleware(handler: MiddlewareHandlerFunction): RequestHandler {
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
     * HandlerFunction을 Express 호환 핸들러로 래핑하는 헬퍼 메서드
     */    
    private wrapHandler(handler: HandlerFunction): RequestHandler {
        return (req: Request, res: Response, next) => {
            try {
                // Dependency injector에서 모든 injectable 모듈 가져오기
                const injected = DependencyInjector.getInstance().getInjectedModules();
                handler(req, res, injected, repositoryManager, prismaManager);
            } catch (error) {
                next(error);
            }
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
     * # convertSlugsToExactPath - 정확한 경로 매칭용 헬퍼
     * 하위 경로 매칭을 방지하기 위한 정확한 경로 생성
     */
    // private convertSlugsToExactPath(slugs: string[]): string {
    //     const pathSegments = slugs.map(slug => slug === "*" ? "*" : `/:${slug}`);
    //     const path = pathSegments.join('');
    //     // 끝에 추가 경로가 오는 것을 방지하기 위해 '(?=/|$)' 사용
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

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'GET',
                path: this.getFullPath('/'),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
            this.pendingDocumentation.push({
                method: 'GET',
                path: '/',
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this; // 메소드 체인을 위해 인스턴스 반환
    }

    /**
     * # GET_SLUG
     * @param slug 
     * @param handler 
     * @param options 
     * @returns
     * @description
     * - 라우터로 선언된 slug 직접 주워 담아야 합니다. 
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

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'GET',
                path: this.getFullPath(slugPath),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
            this.pendingDocumentation.push({
                method: 'GET',
                path: slugPath,
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this; // 메소드 체인을 위해 인스턴스 반환
    }


    /**
     * # POST
     * @param handler 
     * @param options 
     * @returns 
     */
    public POST(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.post('/', this.wrapHandler(handler));

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath('/'),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
            this.pendingDocumentation.push({
                method: 'POST',
                path: '/',
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this; // 메소드 체인을 위해 인스턴스 반환
    }


    /**
     * # POST_SLUG
     * @param slug 
     * @param handler 
     * @param options 
     * @returns 
     * @description
     * - 라우터로 선언된 slug 직접 주워 담아야 합니다. 
     */
    public POST_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter {
        const slugPath = this.convertSlugsToPath(slug);
        this.router.post(slugPath, this.wrapHandler(handler));

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath(slugPath),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
            this.pendingDocumentation.push({
                method: 'POST',
                path: slugPath,
                responseConfig: { 200: { data: { type: 'object', required: false } } }
            });
        }

        return this; // 메소드 체인을 위해 인스턴스 반환
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
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize }, });
        const accpetFileType = upload.single(keyName);
        this.router.post('/', accpetFileType, this.wrapHandler(handler));

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath('/'),
                summary: `File upload: ${keyName}`,
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined; const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.array(keyName, maxFileCount);
        this.router.post('/', accpetFileType, this.wrapHandler(handler));

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath('/'),
                summary: `Multiple file upload: ${keyName}${maxFileCount ? ` (max: ${maxFileCount})` : ''}`,
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } }); const accpetFileType = upload.fields(fields);
        this.router.post('/', accpetFileType, this.wrapHandler(handler));

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'POST',
                path: this.getFullPath('/'),
                summary: `Multiple fields file upload`,
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
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

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'PUT',
                path: this.getFullPath('/'),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });

        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize }, });
        const accpetFileType = upload.single(keyName);
        this.router.put('/', accpetFileType, this.wrapHandler(handler));
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
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.array(keyName, maxFileCount);
        this.router.put('/', accpetFileType, this.wrapHandler(handler));
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
    }): ExpressRouter {
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.fields(fields);
        this.router.put('/', accpetFileType, this.wrapHandler(handler));
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
     * - 라우터로 선언된 slug 직접 주워 담아야 합니다. 
     */
    public PUT_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter {
        const slugPath = this.convertSlugsToPath(slug);
        this.router.put(slugPath, this.wrapHandler(handler));

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'PUT',
                path: this.getFullPath(slugPath),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * - http delete 요청을 처리하는 메서드입니다. 
     */
    public DELETE(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.delete('/', this.wrapHandler(handler));

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'DELETE',
                path: this.getFullPath('/'),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * - 라우터로 선언된 slug 직접 주워 담아야 합니다. 
     */
    public DELETE_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter {
        const slugPath = this.convertSlugsToPath(slug);
        this.router.delete(slugPath, this.wrapHandler(handler));

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'DELETE',
                path: this.getFullPath(slugPath),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
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

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'PATCH',
                path: this.getFullPath('/'),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * - 라우터로 선언된 slug 직접 주워 담아야 합니다. 
     */
    public PATCH_SLUG(slug: string[], handler: HandlerFunction, options?: object): ExpressRouter {
        const slugPath = this.convertSlugsToPath(slug);
        this.router.patch(slugPath, this.wrapHandler(handler));

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'PATCH',
                path: this.getFullPath(slugPath),
                parameters: {},
                responses: { 200: { data: { type: 'object' as const, required: false } } }
            });
        } else {
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
            
            // 미들웨어 이름을 파라미터 키로 변환하는 함수 (동적 매핑 사용)
            const getParameterKey = (middlewareName: string): string => {
                // 생성된 매핑에서 파라미터 키 조회
                return MIDDLEWARE_PARAM_MAPPING[middlewareName as keyof typeof MIDDLEWARE_PARAM_MAPPING] || middlewareName;
            };

            // 미들웨어 인스턴스의 모든 메서드를 Express 미들웨어로 변환하여 적용
            if (typeof middlewareInstance === 'object' && middlewareInstance !== null) {
                
                // 미들웨어 객체의 메서드들을 확인하고 Express 미들웨어로 래핑
                Object.keys(middlewareInstance).forEach(methodName => {
                    const method = (middlewareInstance as any)[methodName];
                    if (typeof method === 'function') {                        // 각 메서드를 Express 미들웨어로 래핑하여 라우터에 적용
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
                });            
            
            } else if (typeof middlewareInstance === 'function') {
               
                // 미들웨어가 직접 함수인 경우
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

            return this;
            
        } catch (error) {
            console.error(`Error applying middleware '${middlewareName}':`, error);
            throw error;
        }
    }


    /**
     * # MIDDLE_PROXY_ROUTE
     * @param options - http-proxy-middleware 옵션
     * @description
     * - Express 라우터에 프록시 미들웨어를 추가합니다.
     */
    public MIDDLE_PROXY_ROUTE(options: Options) {
        this.router.use("/", createProxyMiddleware(options));
    }



    /**
     * # MIDDLE_PROXY_ROUTE_SLUG
     * @param slug - 슬러그 배열
     * @param options - http-proxy-middleware 옵션
     * @description
     * - Express 라우터에 프록시 미들웨어를 추가합니다.
     */
    public MIDDLE_PROXY_ROUTE_SLUG(slug: string[], options: Options) {
        this.router.use(this.convertSlugsToPath(slug), createProxyMiddleware(options));
    }

    /**
     * # STATIC
     * @param staticPath - 정적 파일을 서비스할 물리적 경로
     * @param options - express.static 옵션
     * @description
     * - Express의 정적 파일 서비스 미들웨어를 라우터 루트(/)에 추가합니다.
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
     * - Express의 정적 파일 서비스 미들웨어를 특정 경로에 추가합니다.
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

    public GET_VALIDATED(
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        // 현재 위치 정보를 얻기 위해 Error 스택 추적
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

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {


            // basePath가 이미 설정된 경우 즉시 등록
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
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * 검증된 GET 슬러그 요청 처리
     * @param exact true이면 하위 경로 매칭 방지 (기본값: false)
     */
    public GET_SLUG_VALIDATED(
        slug: string[],
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction,
        options?: { exact?: boolean }
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
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

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
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
            // basePath가 아직 설정되지 않은 경우 지연 등록
            this.pendingDocumentation.push({
                method: 'GET',
                path: slugPath,
                requestConfig,
                responseConfig
            });
        }

        if (options?.exact) {
            // 정확한 매칭: 하위 경로에 영향을 주지 않음
            const exactMiddleware = (req: any, res: any, next: any) => {
                // 현재 요청 경로가 정확히 패턴과 일치하는지 확인
                const pathParts = req.path.split('/').filter(Boolean);
                const expectedParts = slug.length;

                // 경로 세그먼트 수가 정확히 일치해야 함
                if (pathParts.length === expectedParts) {
                    next();
                } else {
                    next('route'); // 이 라우트를 건너뛰고 다음 라우트로
                }
            };
            this.router.get(slugPath, exactMiddleware, ...middlewares);
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
    public POST_VALIDATED(
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        ); this.router.post('/', ...middlewares);

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
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
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * 검증된 POST 슬러그 요청 처리
     * @param exact true이면 하위 경로 매칭 방지 (기본값: false)
     */    
    public POST_SLUG_VALIDATED(
        slug: string[],
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction,
        options?: { exact?: boolean }
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
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

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
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
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * 검증된 PUT 요청 처리
     */    
    public PUT_VALIDATED(
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
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

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
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
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * 검증된 DELETE 요청 처리
     */    
    public DELETE_VALIDATED(
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
        const { filePath, lineNumber } = this.getCallerSourceInfo();

        const middlewares = CustomRequestHandler.createHandler(
            {
                request: requestConfig,
                response: responseConfig,
                sourceInfo: { filePath, lineNumber }
            },
            handler
        ); this.router.delete('/', ...middlewares);

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
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
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * 검증된 PATCH 요청 처리
     */    
    public PATCH_VALIDATED(
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        // 헬퍼 메서드를 통해 호출자 위치 정보 획득
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

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
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
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * 요청 검증만 있는 GET
     */
    public GET_WITH_VALIDATION(
        requestConfig: RequestConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {
        const middlewares = CustomRequestHandler.withValidation(requestConfig, handler);

        this.router.get('/', ...middlewares);

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
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
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * 요청 검증만 있는 POST
     */
    public POST_WITH_VALIDATION(
        requestConfig: RequestConfig,
        handler: ValidatedHandlerFunction
    ): ExpressRouter {

        const middlewares = CustomRequestHandler.withValidation(requestConfig, handler);
        this.router.post('/', ...middlewares);

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {

            // basePath가 이미 설정된 경우 즉시 등록
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
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * 검증된 GET 슬러그 요청 처리 (정확한 경로 매칭만)
     * 하위 라우터에 영향을 주지 않음
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

        // 정확한 경로 매칭을 위해 '$' 앵커 사용하는 대신 정규식 패턴으로 처리
        const exactPath = this.convertSlugsToPath(slug);
        this.router.get(new RegExp(`^${exactPath.replace(/:\w+/g, '([^/]+)')}$`), ...middlewares);

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
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

            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * 검증된 POST 슬러그 요청 처리 (정확한 경로 매칭만)
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

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {

            // basePath가 이미 설정된 경우 즉시 등록
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

            // basePath가 아직 설정되지 않은 경우 지연 등록
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
     * 검증된 PUT 슬러그 요청 처리 (정확한 경로 매칭만)
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

        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
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
            // basePath가 아직 설정되지 않은 경우 지연 등록
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
    //  * 검증된 DELETE 슬러그 요청 처리 (정확한 경로 매칭만)
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

    //     // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
    //     if (this.basePath) {
    //         // basePath가 이미 설정된 경우 즉시 등록
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
    //         // basePath가 아직 설정되지 않은 경우 지연 등록
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
    //  * # GET_SLUG_VALIDATED (개선된 버전)
    //  * 하위 라우터 영향 방지 옵션 추가
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
    //         // 정확한 매칭: 하위 경로 방지
    //         const exactPath = this.convertSlugsToPath(slug);

    //         // Express에서 정확한 매칭을 위해 미들웨어에서 경로 체크
    //         const exactMiddleware = (req: any, res: any, next: any) => {
    //             // URL이 정확히 일치하는지 확인
    //             const pathPattern = exactPath.replace(/:\w+/g, '[^/]+');
    //             const regex = new RegExp(`^${pathPattern}$`);
    //             if (regex.test(req.path)) {
    //                 next();
    //             } else {
    //                 next('route'); // 다른 라우트로 패스
    //             }
    //         };

    //         this.router.get(exactPath, exactMiddleware, ...middlewares);

    //     } else {
    //         // 기본 동작: 하위 경로도 매칭
    //         this.router.get(this.convertSlugsToPath(slug), ...middlewares);
    //     }

    //     return this;
    // }

    
    /**
     * CRUD 자동 생성 메서드
     * 표준 REST API CRUD 엔드포인트를 자동으로 생성합니다.
     * 
     * 생성되는 라우트:
     * - GET / (index) - 리스트 조회 with 필터링, 정렬, 페이지네이션
     * - GET /:identifier (show) - 단일 항목 조회
     * - POST / (create) - 새 항목 생성
     * - PUT /:identifier (update) - 항목 전체 수정
     * - PATCH /:identifier (update) - 항목 부분 수정  
     * - DELETE /:identifier (destroy) - 항목 삭제
     * 
     * @param databaseName 사용할 데이터베이스 이름
     * @param modelName 대상 모델 이름 (타입 안전성을 위해 제네릭 사용)
     * @param options CRUD 옵션 설정
     */
    public CRUD<T extends DatabaseNamesUnion>(
        databaseName: T, 
        modelName: ModelNamesFor<T>,
        options?: {

            /** CRUD 액션 활성화 설정 */
            only?: ('index' | 'show' | 'create' | 'update' | 'destroy' | 'recover')[];
            except?: ('index' | 'show' | 'create' | 'update' | 'destroy' | 'recover')[];


            /** Primary key 필드명 지정 (기본값: 'id') */
            primaryKey?: string;


            /** Primary key 타입 변환 함수 */
            primaryKeyParser?: (value: string) => any;


            /** JSON:API 리소스 타입 (기본값: modelName.toLowerCase()) */
            resourceType?: string;


            /** Soft Delete 설정 */
            softDelete?: {
                enabled: boolean;
                field: string;
            };

            /** 미들웨어 */
            middleware?: {
                index?: HandlerFunction[];
                show?: HandlerFunction[];
                create?: HandlerFunction[];
                update?: HandlerFunction[];
                destroy?: HandlerFunction[];
                recover?: HandlerFunction[];
            };

            /** 요청 검증 설정 */
            validation?: {
                create?: RequestConfig;
                update?: RequestConfig;
                recover?: RequestConfig;
            };

            /** 응답 검증 설정 */
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
        
        // Primary key 설정 및 자동 파서 선택
        const primaryKey = options?.primaryKey || 'id';
        const primaryKeyParser = options?.primaryKeyParser || this.getSmartPrimaryKeyParser(databaseName, modelName, primaryKey);
        
        // INDEX - GET / (목록 조회)
        if (enabledActions.includes('index')) {
            this.setupIndexRoute(client, modelName, options, primaryKey);
        }

        // SHOW - GET /:identifier (단일 조회)
        if (enabledActions.includes('show')) {
            this.setupShowRoute(client, modelName, options, primaryKey, primaryKeyParser);
        }

        // CREATE - POST / (생성)
        if (enabledActions.includes('create')) {
            this.setupCreateRoute(client, modelName, options, primaryKey);
        }

        // UPDATE - PUT /:identifier, PATCH /:identifier (수정)
        if (enabledActions.includes('update')) {
            this.setupUpdateRoute(client, modelName, options, primaryKey, primaryKeyParser);
        }

        // DESTROY - DELETE /:identifier (삭제)
        if (enabledActions.includes('destroy')) {
            this.setupDestroyRoute(client, modelName, options, primaryKey, primaryKeyParser);
        }

        // ATOMIC OPERATIONS - POST /atomic (원자적 작업)
        this.setupAtomicOperationsRoute(client, modelName, options);

        // RECOVER - POST /:identifier/recover (복구)
        if (enabledActions.includes('recover')) {
            this.setupRecoverRoute(client, modelName, options, primaryKey, primaryKeyParser);
        }

        // JSON:API Relationship 라우트 추가
        this.setupRelationshipRoutes(client, modelName, options, primaryKey, primaryKeyParser);

        return this;
    }

    /**
     * Primary key 타입을 자동으로 감지하고 적절한 파서를 반환하는 헬퍼 메서드
     */
    private getSmartPrimaryKeyParser(databaseName: string, modelName: string, primaryKey: string): (value: string) => any {
        try {
            // 간단한 타입 추론 로직
            // 실제로는 Prisma 스키마나 메타데이터를 읽어서 판단할 수 있지만,
            // 여기서는 일반적인 패턴을 기반으로 추론
            
            // primaryKey 이름 기반 추론
            if (primaryKey === 'uuid' || primaryKey.includes('uuid') || primaryKey.endsWith('_uuid')) {
                return ExpressRouter.parseUuid;
            }
            
            // 기본적으로 스마트 파서 사용 (숫자인지 UUID인지 자동 판단)
            return this.parseIdSmart;
        } catch (error) {
            console.warn(`Failed to determine primary key type for ${modelName}.${primaryKey}, using string parser`);
            return ExpressRouter.parseString;
        }
    }

    /**
     * 스마트 ID 파서 - 입력값을 보고 적절한 타입으로 변환
     * UUID 형식이 아닌 경우 숫자나 문자열로 안전하게 처리
     */
    private parseIdSmart = (id: string): any => {
        // 먼저 입력값 검증
        if (!id || typeof id !== 'string') {
            throw new Error('Invalid ID format: ID must be a non-empty string');
        }

        // UUID 패턴 체크 (엄격한 검증)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(id)) {
            return id; // 유효한 UUID 그대로 반환
        }
        
        // 순수 숫자인 경우 정수로 변환
        if (/^\d+$/.test(id)) {
            const numValue = parseInt(id, 10);
            if (!isNaN(numValue) && numValue > 0) {
                return numValue;
            }
        }
        
        // 유효한 문자열 ID인 경우 (알파벳, 숫자, 하이픈, 언더스코어 허용)
        if (/^[a-zA-Z0-9_-]+$/.test(id)) {
            return id;
        }
        
        // 그 외의 경우 에러 발생
        throw new Error(`Invalid ID format: '${id}' is not a valid UUID, number, or string identifier`);
    };

    /**
     * 활성화된 액션 목록 계산
     * 
     * 우선순위:
     * 1. only와 except가 둘 다 지정된 경우: only를 우선으로 하되, 경고 로그를 출력
     * 2. only만 지정된 경우: only에 포함된 액션들만 활성화
     * 3. except만 지정된 경우: 전체 액션에서 except에 포함된 것들을 제외
     * 4. 둘 다 없는 경우: 모든 액션 활성화
     */
    private getEnabledActions(options?: any): string[] {
        const allActions = ['index', 'show', 'create', 'update', 'destroy', 'recover'];
        
        // only와 except가 둘 다 지정된 경우 경고
        if (options?.only && options?.except) {
            console.warn(
                '[CRUD Warning] Both "only" and "except" options are specified. ' +
                '"only" takes precedence and "except" will be ignored.'
            );
            return options.only;
        }
        
        // only만 지정된 경우
        if (options?.only) {
            return options.only;
        }
        
        // except만 지정된 경우
        if (options?.except) {
            return allActions.filter(action => !options.except.includes(action));
        }
        
        // 기본값: 모든 액션
        return allActions;
    }

    /**
     * INDEX 라우트 설정 (GET /) - JSON:API 준수
     */
    private setupIndexRoute(client: any, modelName: string, options?: any, primaryKey: string = 'id'): void {
        const middlewares = options?.middleware?.index || [];
        const isSoftDelete = options?.softDelete?.enabled;
        const softDeleteField = options?.softDelete?.field || 'deletedAt';
        
        const handler: HandlerFunction = async (req, res, injected, repo, db) => {
            try {
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                res.setHeader('Vary', 'Accept');
                
                // 쿼리 파라미터 파싱
                const queryParams = CrudQueryParser.parseQuery(req);
                
                // Prisma 쿼리 옵션 빌드
                const findManyOptions = PrismaQueryBuilder.buildFindManyOptions(queryParams);
                
                // Soft Delete 필터 추가 (기존 where 조건과 병합)
                if (isSoftDelete) {
                    // include_deleted 쿼리 파라미터가 true가 아닌 경우 삭제된 항목 제외
                    const includeDeleted = req.query.include_deleted === 'true';
                    
                    if (!includeDeleted) {
                        // 기존 where 조건이 있는 경우 AND 조건으로 추가
                        if (findManyOptions.where) {
                            findManyOptions.where = {
                                AND: [
                                    findManyOptions.where,
                                    { [softDeleteField]: null }
                                ]
                            };
                        } else {
                            // where 조건이 없는 경우 새로 생성
                            findManyOptions.where = { [softDeleteField]: null };
                        }
                    }
                }
                
                // 총 개수 조회 (페이지네이션용)
                const totalCountOptions = { ...findManyOptions };
                delete totalCountOptions.skip;
                delete totalCountOptions.take;
                delete totalCountOptions.cursor;
                 
                const [items, total] = await Promise.all([
                    client[modelName].findMany(findManyOptions),
                    client[modelName].count({ where: totalCountOptions.where })
                ]);

                // Base URL 생성
                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
                
                // 포함된 리소스 생성 (include 파라미터가 있는 경우)
                let included: JsonApiResource[] | undefined;
                if (queryParams.include && queryParams.include.length > 0) {
                    included = JsonApiTransformer.createIncludedResources(
                        items,
                        queryParams.include,
                        queryParams.fields,
                        baseUrl
                    );
                }

                // 페이지네이션 링크 생성
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

                // 메타데이터 생성 (JSON:API 스펙 준수)
                const meta: any = {
                    timestamp: new Date().toISOString(),
                    total: total,  // 전체 레코드 수 (JSON:API에서 일반적으로 사용)
                    count: items.length  // 현재 응답의 레코드 수
                };

                // 페이지네이션이 활성화된 경우에만 페이지 정보 추가
                if (queryParams.page) {
                    const pageSize = queryParams.page.size || 10;
                    const currentPage = queryParams.page.number || 1;
                    const totalPages = Math.ceil(total / pageSize);
                    
                    meta.page = {
                        current: currentPage,
                        size: pageSize,
                        total: totalPages  // 전체 페이지 수
                    };
                }

                // JSON:API 응답 생성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    items,
                    modelName,
                    {
                        primaryKey,
                        fields: queryParams.fields,
                        baseUrl,
                        links,
                        meta,
                        included
                    }
                );
                
                // BigInt와 DATE 타입 직렬화 처리
                const serializedResponse = serialize(response);
                
                res.json(serializedResponse);
                
            } catch (error: any) {
                console.error(`CRUD Index Error for ${modelName}:`, error);
                
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                
                res.status(status).json(errorResponse);
            }
        };

        // 미들웨어 등록
        if (middlewares.length > 0) {
            this.router.get('/', ...middlewares, this.wrapHandler(handler));
        } else {
            this.router.get('/', this.wrapHandler(handler));
        }

        // 문서화 등록
        const queryParams: any = {
            include: { type: 'string', required: false, description: 'Related resources to include (comma-separated). Example: author,comments.author' },
            'fields[type]': { type: 'string', required: false, description: 'Sparse fieldsets - specify which fields to include for each resource type. Example: fields[posts]=title,content&fields[users]=name,email' },
            sort: { type: 'string', required: false, description: 'Sort fields (prefix with - for desc). Example: -createdAt,title' },
            'page[number]': { type: 'number', required: false, description: 'Page number for pagination' },
            'page[size]': { type: 'number', required: false, description: 'Page size for pagination' },
            'filter[field_op]': { type: 'string', required: false, description: 'Filter conditions. Operators: eq, ne, gt, gte, lt, lte, like, in, etc. Example: filter[status_eq]=active&filter[age_gte]=18' }
        };
        
        // Soft delete가 활성화된 경우 include_deleted 파라미터 추가
        if (isSoftDelete) {
            queryParams.include_deleted = { 
                type: 'boolean', 
                required: false, 
                description: 'Include soft deleted items (default: false)' 
            };
        }
        
        this.registerDocumentation('GET', '/', {
            summary: `Get ${modelName} list with filtering, sorting, and pagination`,
            parameters: {
                query: queryParams
            },
            responses: {
                200: {
                    data: { type: 'array', required: true, description: `Array of ${modelName} items` },
                    meta: { type: 'object', required: true, description: 'Pagination metadata' }
                }
            }
        });
    }

    /**
     * SHOW 라우트 설정 (GET /:identifier) - JSON:API 준수
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
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                res.setHeader('Vary', 'Accept');
                
                // 파라미터 추출 및 파싱
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return; // 에러 응답은 이미 헬퍼에서 처리됨
                
                // 쿼리 파라미터에서 include 파싱
                const queryParams = CrudQueryParser.parseQuery(req);
                const includeOptions = queryParams.include 
                    ? PrismaQueryBuilder['buildIncludeOptions'](queryParams.include)
                    : undefined;

                // Soft Delete 필터 추가 (include_deleted가 true가 아닌 경우)
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
                    // Soft delete된 항목인지 확인 (include_deleted=false 상태에서)
                    if (isSoftDelete && !includeDeleted) {
                        const deletedItem = await client[modelName].findUnique({
                            where: { [primaryKey]: parsedIdentifier }
                        });
                        
                        if (deletedItem && deletedItem[softDeleteField]) {
                            // Soft delete된 항목에 대한 410 Gone 응답 (JSON:API 확장)
                            const errorResponse = this.formatJsonApiError(
                                new Error(`${modelName} has been deleted`),
                                'RESOURCE_DELETED',
                                410,
                                req.path
                            );
                            return res.status(410).json(errorResponse);
                        }
                    }
                    
                    const errorResponse = this.formatJsonApiError(
                        new Error(`${modelName} not found`),
                        'NOT_FOUND',
                        404,
                        req.path
                    );
                    return res.status(404).json(errorResponse);
                }

                // Base URL 생성
                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
                
                // 포함된 리소스 생성 (include 파라미터가 있는 경우)
                let included: JsonApiResource[] | undefined;
                if (queryParams.include && queryParams.include.length > 0) {
                    included = JsonApiTransformer.createIncludedResources(
                        [item],
                        queryParams.include,
                        queryParams.fields,
                        baseUrl
                    );
                }

                // JSON:API 응답 생성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    item,
                    modelName,
                    {
                        primaryKey,
                        fields: queryParams.fields,
                        baseUrl,
                        included
                    }
                );
                
                // BigInt와 DATE 타입 직렬화 처리
                const serializedResponse = serialize(response);
                
                res.json(serializedResponse);
                
            } catch (error: any) {
                console.error(`CRUD Show Error for ${modelName}:`, error);
                
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                
                res.status(status).json(errorResponse);
            }
        };

        // 미들웨어 등록 - 동적 경로 사용
        const routePath = `/:${primaryKey}`;
        if (middlewares.length > 0) {
            this.router.get(routePath, ...middlewares, this.wrapHandler(handler));
        } else {
            this.router.get(routePath, this.wrapHandler(handler));
        }

        // 문서화 등록
        const queryParams: any = {
            include: { type: 'string', required: false, description: 'Related resources to include' }
        };
        
        // Soft delete가 활성화된 경우 include_deleted 파라미터 추가
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
        
        // Soft delete가 활성화된 경우 410 Gone 응답 추가
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
     * CREATE 라우트 설정 (POST /) - JSON:API 준수
     */
    private setupCreateRoute(client: any, modelName: string, options?: any, primaryKey: string = 'id'): void {
        const middlewares = options?.middleware?.create || [];
        
        const handler: HandlerFunction = async (req, res, injected, repo, db) => {
            try {
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                res.setHeader('Vary', 'Accept');
                
                // Content Negotiation 검증
                // if (!this.validateJsonApiContentType(req, res)) {
                //     return;
                // }
                
                // JSON:API 요청 형식 검증
                if (!req.body || !req.body.data) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Request must contain a data object'),
                        'INVALID_REQUEST',
                        400,
                        req.path
                    );
                    return res.status(400).json(errorResponse);
                }

                const { data: requestData } = req.body;
                
                // 리소스 타입 검증 (라우트 경로에서 추출 또는 옵션 사용)
                const routeResourceType = req.baseUrl.split('/').filter(Boolean).pop() || modelName.toLowerCase();
                const expectedType = options?.resourceType || routeResourceType;
                
                // JSON:API 리소스 구조 검증
                if (!this.validateJsonApiResource(requestData, expectedType, req, res, false)) {
                    return;
                }

                // attributes에서 데이터 추출
                let data = requestData.attributes || {};

                // 클라이언트 생성 ID 지원 (JSON:API 스펙)
                if (requestData.id) {
                    // 클라이언트가 ID를 제공한 경우
                    if (primaryKey === 'id') {
                        data.id = requestData.id;
                    } else {
                        data[primaryKey] = requestData.id;
                    }
                }

                // 관계 데이터 처리 (relationships가 있는 경우)
                if (requestData.relationships) {
                    data = await this.processRelationships(
                        data, 
                        requestData.relationships, 
                        client, 
                        modelName
                    );
                }

                // Before hook 실행
                if (options?.hooks?.beforeCreate) {
                    data = await options.hooks.beforeCreate(data, req);
                }

                const result = await client[modelName].create({
                    data
                });

                // After hook 실행
                if (options?.hooks?.afterCreate) {
                    await options.hooks.afterCreate(result, req);
                }

                // Base URL 생성
                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;

                // JSON:API 응답 생성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    result,
                    modelName,
                    {
                        primaryKey,
                        baseUrl
                    }
                );
                
                // BigInt와 DATE 타입 직렬화 처리
                const serializedResponse = serialize(response);
                
                res.status(201).json(serializedResponse);
                
            } catch (error: any) {
                console.error(`CRUD Create Error for ${modelName}:`, error);
                
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                
                res.status(status).json(errorResponse);
            }
        };

        // Validation이 있는 경우
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
            // 일반 핸들러
            if (middlewares.length > 0) {
                this.router.post('/', ...middlewares, this.wrapHandler(handler));
            } else {
                this.router.post('/', this.wrapHandler(handler));
            }
        }

        // 문서화 등록
        this.registerDocumentation('POST', '/', {
            summary: `Create new ${modelName} (JSON:API)`,
            parameters: {
                body: {
                    type: 'object',
                    required: true,
                    description: 'JSON:API resource object',
                    properties: {
                        data: {
                            type: 'object',
                            required: true,
                            properties: {
                                type: { type: 'string', required: true, description: 'Resource type' },
                                attributes: options?.validation?.create?.body || 
                                          { type: 'object', required: true, description: `${modelName} attributes` }
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
                }
            }
        });
    }

    /**
     * Atomic Operations 엔드포인트 설정 (JSON:API Extension)
     */
    private setupAtomicOperationsRoute(client: any, modelName: string, options?: any): void {
        const handler: HandlerFunction = async (req, res, injected, repo, db) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"');
                
                // Content-Type 검증 (atomic extension 필요)
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

                // 요청 구조 검증
                if (!req.body || !req.body['atomic:operations']) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Request must contain atomic:operations'),
                        'INVALID_REQUEST',
                        400,
                        req.path
                    );
                    return res.status(400).json(errorResponse);
                }

                const operations = req.body['atomic:operations'];
                const results: (any | null)[] = [];

                // 트랜잭션으로 모든 작업 실행
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
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                res.status(status).json(errorResponse);
            }
        };

        this.router.post('/atomic', this.wrapHandler(handler));
    }

    /**
     * 단일 원자적 작업 실행
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
                    // 관계 제거
                    const relationshipData: any = {};
                    relationshipData[operation.ref.relationship] = { disconnect: true };
                    
                    await tx[modelName].update({
                        where: { id: operation.ref.id },
                        data: relationshipData
                    });
                } else {
                    // 리소스 제거
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
     * JSON:API 고급 에러 검증
     */
    private validateJsonApiResource(data: any, expectedType: string, req: any, res: any, isUpdate: boolean = false): boolean {
        // 리소스 객체 구조 검증
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

        // 타입 필드 검증
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

        // 타입 일치 검증
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

        // 업데이트 시 ID 필드 검증
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

            // URL의 ID와 본문의 ID 일치 검증
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

        // attributes와 relationships 검증
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
     * Content Negotiation 헬퍼 - JSON:API 스펙 준수
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

    //     // 지원하지 않는 미디어 타입 파라미터 검증
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
     * 미디어 타입 파라미터 파싱
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
     * PATCH 부분 업데이트 전략 처리
     */
    private async applyPatchStrategy(
        existingData: any,
        newData: any,
        strategy: 'merge' | 'replace' = 'merge'
    ): Promise<any> {
        if (strategy === 'replace') {
            return newData;
        }

        // merge 전략: 기존 데이터와 새 데이터를 병합
        const mergedData = { ...existingData };
        
        Object.keys(newData).forEach(key => {
            if (newData[key] !== undefined) {
                if (typeof newData[key] === 'object' && newData[key] !== null && !Array.isArray(newData[key])) {
                    // 객체인 경우 재귀적으로 병합
                    mergedData[key] = {
                        ...(mergedData[key] || {}),
                        ...newData[key]
                    };
                } else {
                    // 원시값 또는 배열인 경우 교체
                    mergedData[key] = newData[key];
                }
            }
        });

        return mergedData;
    }

    /**
     * JSON:API 관계 데이터 처리
     * 생성/수정 시 관계 데이터를 Prisma 형식으로 변환
     */
    private async processRelationships(
        data: any, 
        relationships: Record<string, JsonApiRelationship>, 
        client: any, 
        modelName: string
    ): Promise<any> {
        const processedData = { ...data };
        
        for (const [relationName, relationshipData] of Object.entries(relationships)) {
            if (relationshipData.data) {
                if (Array.isArray(relationshipData.data)) {
                    // 일대다 관계 처리
                    processedData[relationName] = {
                        connect: relationshipData.data.map((item: any) => ({ id: item.id }))
                    };
                } else if (relationshipData.data) {
                    // 일대일 관계 처리
                    processedData[relationName] = {
                        connect: { id: relationshipData.data.id }
                    };
                }
            }
        }
        
        return processedData;
    }

    /**
     * UPDATE 라우트 설정 (PUT /:identifier, PATCH /:identifier) - JSON:API 준수
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
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // Content Negotiation 검증
                // if (!this.validateJsonApiContentType(req, res)) {
                //     return;
                // }
                
                // 파라미터 추출 및 검증
                const extractResult = this.extractAndParsePrimaryKey(req, res, primaryKey, primaryKeyParser, modelName);
                if (!extractResult.success) return; // 에러 응답은 헬퍼 메서드에서 처리

                const { parsedIdentifier } = extractResult;

                // JSON:API 요청 형식 검증
                if (!req.body || !req.body.data) {
                    // 리소스 타입을 동적으로 결정
                    const routeResourceType = req.baseUrl.split('/').filter(Boolean).pop() || modelName.toLowerCase();
                    const resourceType = options?.resourceType || routeResourceType;
                    
                    const exampleRequest = {
                        data: {
                            type: resourceType,
                            id: String(parsedIdentifier),
                            attributes: {
                                // "fieldName": "fieldValue"
                                // 예: "email": "user@example.com"
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
                
                // 리소스 타입 검증 (라우트 경로에서 추출 또는 옵션 사용)
                const routeResourceType = req.baseUrl.split('/').filter(Boolean).pop() || modelName.toLowerCase();
                const expectedType = options?.resourceType || routeResourceType;

                // JSON:API 리소스 구조 검증 (업데이트용)
                if (!this.validateJsonApiResource(requestData, expectedType, req, res, true)) {
                    return;
                }

                // attributes에서 데이터 추출
                let data = requestData.attributes || {};

                // 관계 데이터 처리 (relationships가 있는 경우)
                if (requestData.relationships) {
                    data = await this.processRelationships(
                        data, 
                        requestData.relationships, 
                        client, 
                        modelName
                    );
                }

                // 빈 값이나 null 값들 정리만 수행
                data = this.cleanEmptyValues(data);

                // Before hook 실행
                if (options?.hooks?.beforeUpdate) {
                    data = await options.hooks.beforeUpdate(data, req);
                }

                const result = await client[modelName].update({
                    where: { [primaryKey]: parsedIdentifier },
                    data
                });

                // After hook 실행
                if (options?.hooks?.afterUpdate) {
                    await options.hooks.afterUpdate(result, req);
                }

                // Base URL 생성
                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;

                // JSON:API 응답 생성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    result,
                    modelName,
                    {
                        primaryKey,
                        baseUrl
                    }
                );
                
                // BigInt와 DATE 타입 직렬화 처리
                const serializedResponse = serialize(response);
                
                res.json(serializedResponse);
                
            } catch (error: any) {
                console.error(`CRUD Update Error for ${modelName}:`, error);
                
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                
                res.status(status).json(errorResponse);
            }
        };

        // PUT과 PATCH 모두 등록
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

        // 문서화 등록 (PUT/PATCH 동일) - JSON:API 형식
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
                        description: 'JSON:API resource object',
                        properties: {
                            data: {
                                type: 'object',
                                required: true,
                                properties: {
                                    type: { type: 'string', required: true, description: 'Resource type' },
                                    id: { type: 'string', required: false, description: 'Resource ID (must match URL parameter)' },
                                    attributes: options?.validation?.update?.body || 
                                              { type: 'object', required: true, description: `${modelName} attributes to update` }
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
                    }
                }
            });
        });
    }





    /**
     * DESTROY 라우트 설정 (DELETE /:identifier) - JSON:API 준수
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
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // Content Negotiation 검증 (DELETE 요청에 본문이 있는 경우)
                if (req.body && Object.keys(req.body).length > 0) {
                    // if (!this.validateJsonApiContentType(req, res)) {
                    //     return;
                    // }
                }
                
                // 파라미터 추출 및 파싱
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return; // 에러 응답은 이미 헬퍼에서 처리됨

                // Before hook 실행
                if (options?.hooks?.beforeDestroy) {
                    await options.hooks.beforeDestroy(parsedIdentifier, req);
                }

                if (isSoftDelete) {
                    // Soft Delete: 삭제 시간 설정
                    const result = await client[modelName].update({
                        where: { [primaryKey]: parsedIdentifier },
                        data: { [softDeleteField]: new Date() }
                    });

                    // After hook 실행
                    if (options?.hooks?.afterDestroy) {
                        await options.hooks.afterDestroy(parsedIdentifier, req);
                    }

                    // JSON:API 준수 - 성공적인 soft delete 응답 (200 OK with meta)
                    const response = {
                        jsonapi: {
                            version: "1.1"
                        },
                        meta: {
                            operation: 'soft_delete',
                            timestamp: new Date().toISOString(),
                            [softDeleteField]: result[softDeleteField]
                        }
                    };
                    
                    res.status(200).json(response);
                } else {
                    // 삭제 전 존재 여부 확인 (404 처리를 위해)
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

                    // Hard Delete: 완전 삭제
                    await client[modelName].delete({
                        where: { [primaryKey]: parsedIdentifier }
                    });

                    // After hook 실행
                    if (options?.hooks?.afterDestroy) {
                        await options.hooks.afterDestroy(parsedIdentifier, req);
                    }

                    // JSON:API 삭제 성공 응답 (204 No Content)
                    res.status(204).end();
                }
                
            } catch (error: any) {
                console.error(`CRUD Destroy Error for ${modelName}:`, error);
                
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                
                res.status(status).json(errorResponse);
            }
        };

        // 미들웨어 등록
        const routePath = `/:${primaryKey}`;
        if (middlewares.length > 0) {
            this.router.delete(routePath, ...middlewares, this.wrapHandler(handler));
        } else {
            this.router.delete(routePath, this.wrapHandler(handler));
        }

        // 문서화 등록 - JSON:API 형식
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
     * RECOVER 라우트 설정 (POST /:identifier/recover) - JSON:API 준수
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
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // 파라미터 추출 및 파싱
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return; // 에러 응답은 이미 헬퍼에서 처리됨

                // Before hook 실행
                if (options?.hooks?.beforeRecover) {
                    await options.hooks.beforeRecover(parsedIdentifier, req);
                }

                // 먼저 현재 상태 확인 (소프트 삭제된 상태인지 체크)
                const existingItem = await client[modelName].findFirst({
                    where: { 
                        [primaryKey]: parsedIdentifier,
                        deletedAt: { not: null } // 소프트 삭제된 항목만 조회
                    }
                });

                if (!existingItem) {
                    // 항목이 없거나 이미 복구된 상태
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

                // 복구 실행 (deletedAt을 null로 설정)
                const result = await client[modelName].update({
                    where: { [primaryKey]: parsedIdentifier },
                    data: { deletedAt: null }
                });

                // After hook 실행
                if (options?.hooks?.afterRecover) {
                    await options.hooks.afterRecover(result, req);
                }

                // JSON:API 응답 포맷
                const response = {
                    data: this.transformToJsonApiResource(result, modelName, req, primaryKey),
                    jsonapi: {
                        version: "1.0"
                    },
                    meta: {
                        operation: 'recover',
                        timestamp: new Date().toISOString()
                    }
                };
                
                // BigInt와 DATE 타입 직렬화 처리
                const serializedResponse = serialize(response);
                
                res.json(serializedResponse);
                
            } catch (error: any) {
                console.error(`CRUD Recover Error for ${modelName}:`, error);
                
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                
                res.status(status).json(errorResponse);
            }
        };

        // Validation이 있는 경우
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
            // 일반 핸들러
            if (middlewares.length > 0) {
                this.router.post(routePath, ...middlewares, this.wrapHandler(handler));
            } else {
                this.router.post(routePath, this.wrapHandler(handler));
            }
        }

        // 문서화 등록 - JSON:API 형식
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
     * JSON:API 리소스 객체로 변환하는 헬퍼 메서드
     */
    private transformToJsonApiResource(item: any, modelName: string, req: any, primaryKey: string = 'id'): any {
        const resourceType = modelName.toLowerCase();
        const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
        
        // Primary key 값 추출
        const id = item[primaryKey] || item.id || item.uuid || item._id || Object.values(item)[0];
        
        // attributes에서 primary key와 관계 필드 제외
        const attributes = { ...item };
        delete attributes[primaryKey];
        
        // primaryKey가 'id'가 아닌 경우, 기존 'id' 필드는 attributes에 유지
        // 다른 기본 ID 필드들은 제거 (중복 방지)
        if (primaryKey !== 'uuid') delete attributes.uuid;
        if (primaryKey !== '_id') delete attributes._id;
        
        // 관계 필드 분리
        const relationships: any = {};
        const resourceAttributes: any = {};
        
        Object.keys(attributes).forEach(key => {
            const value = attributes[key];
            // 배열이거나 객체이면서 id를 가진 경우 관계로 처리
            if (Array.isArray(value) || (value && typeof value === 'object' && value.id)) {
                relationships[key] = {
                    links: {
                        self: `${baseUrl}/${id}/relationships/${key}`,
                        related: `${baseUrl}/${id}/${key}`
                    }
                };
                
                // 관계 데이터가 포함된 경우
                if (Array.isArray(value)) {
                    relationships[key].data = value.map((relItem: any) => ({
                        type: key.slice(0, -1), // 복수형에서 단수형으로 (간단한 변환)
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
        
        // 관계가 있는 경우에만 relationships 필드 추가
        if (Object.keys(relationships).length > 0) {
            resource.relationships = relationships;
        }
        
        return resource;
    }

    /**
     * 페이지네이션 URL 생성 헬퍼 메서드
     */
    private buildPaginationUrl(baseUrl: string, query: any, page: number, size: number): string {
        const params = new URLSearchParams();
        
        // 기존 쿼리 파라미터 유지 (page 제외)
        Object.keys(query).forEach(key => {
            if (!key.startsWith('page[')) {
                const value = query[key];
                // 객체나 배열인 경우 JSON.stringify로 직렬화하거나 무시
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    params.append(key, String(value));
                } else if (Array.isArray(value)) {
                    // 배열인 경우 각 요소를 개별적으로 추가
                    value.forEach(item => {
                        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
                            params.append(key, String(item));
                        }
                    });
                }
                // 객체인 경우는 무시 (page 객체 등)
            }
        });
        
        // 페이지네이션 파라미터 추가
        params.append('page[number]', String(page));
        params.append('page[size]', String(size));
        
        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * 공통 JSON:API 기본 구조 생성 헬퍼
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
     * JSON:API 에러 형식으로 포맷하는 헬퍼 메서드 - 완전한 스펙 준수
     */
    private formatJsonApiError(error: any, code: string, status: number, path: string): JsonApiErrorResponse {
        const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const baseStructure = this.createBaseJsonApiStructure();
        
        return {
            ...baseStructure,
            errors: [
                {
                    id: errorId,
                    links: {
                        about: `https://docs.api.com/errors/${code}`,
                        type: `https://docs.api.com/error-types/${status}`
                    },
                    status: String(status),
                    code: code,
                    title: this.getErrorTitle(status),
                    detail: error.message || `An error occurred while processing the request`,
                    source: {
                        pointer: path,
                        ...(error.parameter && { parameter: error.parameter }),
                        ...(error.header && { header: error.header })
                    },
                    meta: {
                        timestamp: new Date().toISOString(),
                        requestId: errorId,
                        ...(error.meta && { originalError: error.meta }),
                        ...(process.env.NODE_ENV === 'development' && error.stack && { 
                            stack: error.stack.split('\n').slice(0, 5) 
                        })
                    }
                }
            ],
            meta: {
                timestamp: new Date().toISOString(),
                errorCount: 1,
                requestInfo: {
                    path: path,
                    method: error.method || 'UNKNOWN'
                }
            },
            links: {
                self: path
            }
        };
    }

    /**
     * 빈 값들 정리 (undefined, 빈 객체, 빈 배열 등)
     */
    private cleanEmptyValues(data: any): any {
        const cleanedData = { ...data };
        
        Object.keys(cleanedData).forEach(key => {
            const value = cleanedData[key];
            
            // undefined 제거
            if (value === undefined) {
                delete cleanedData[key];
                return;
            }
            
            // 빈 객체 제거 (null이 아닌 경우)
            if (typeof value === 'object' && value !== null) {
                if (Array.isArray(value)) {
                    // 빈 배열 제거 (설정에 따라)
                    if (value.length === 0) {
                        delete cleanedData[key];
                    }
                } else {
                    // 빈 객체 제거
                    if (Object.keys(value).length === 0) {
                        delete cleanedData[key];
                    }
                }
            }
        });

        return cleanedData;
    }

    /**
     * HTTP 상태 코드에 따른 에러 제목 반환
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
     * 요청에서 primary key 파라미터를 추출하고 파싱하는 헬퍼 메서드 - JSON:API 대응
     */
    private extractAndParsePrimaryKey(
        req: any, 
        res: any, 
        primaryKey: string, 
        primaryKeyParser: (value: string) => any,
        modelName: string
    ): { success: boolean; parsedIdentifier?: any } {
        // 파라미터 추출
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

        // 파라미터 유효성 검사
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

        // Primary key 파싱 시 에러 처리
        try {
            const parsedIdentifier = primaryKeyParser(identifier);
            return { success: true, parsedIdentifier };
        } catch (parseError: any) {
            const { code, status } = ErrorFormatter.mapPrismaError(parseError);
            const errorResponse = this.formatJsonApiError(parseError, code, status, req.path);
            res.status(status).json(errorResponse);
            return { success: false };
        }
    }






    /**
     * ID 파싱 헬퍼 (문자열을 숫자로 변환 시도)
     */
    private parseId = (id: string): any => {
        // 숫자인 경우 정수로 변환
        if (/^\d+$/.test(id)) {
            return parseInt(id, 10);
        }
        // UUID 등의 경우 문자열 그대로 반환
        return id;
    };





    /**
     * UUID 전용 파서 (검증 포함)
     */
    public static parseUuid = (uuid: string): string => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(uuid)) {
            throw new Error(`Invalid UUID format: ${uuid}`);
        }
        return uuid;
    };





    /**
     * 문자열 그대로 반환하는 파서
     */
    public static parseString = (value: string): string => {
        return value;
    };





    /**
     * 정수 전용 파서 (검증 포함)
     */
    public static parseInt = (value: string): number => {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
            throw new Error(`Invalid integer format: ${value}`);
        }
        return parsed;
    };

    /**
     * 문서화 등록 헬퍼
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
     * JSON:API Relationship 라우트 설정
     * 관계 자체를 관리하는 라우트와 관련 리소스를 조회하는 라우트를 생성
     */
    private setupRelationshipRoutes(
        client: any, 
        modelName: string, 
        options?: any, 
        primaryKey: string = 'id', 
        primaryKeyParser: (value: string) => any = ExpressRouter.parseString
    ): void {
        // 현재는 기본적인 관계 조회 라우트만 구현
        // 향후 확장 가능: POST, PATCH, DELETE for relationships
        
        // GET /:identifier/:relationName - 관련 리소스 직접 조회
        this.router.get(`/:${primaryKey}/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return;

                const relationName = req.params.relationName;
                
                // 쿼리 파라미터 파싱 (include, fields, sort, pagination 지원)
                const queryParams = CrudQueryParser.parseQuery(req);
                
                // 기본 리소스 조회
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

                // Base URL 생성
                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
                
                // 관계 리소스 타입 추론
                const relationResourceType = JsonApiTransformer.inferResourceTypeFromRelationship(
                    relationName, 
                    Array.isArray(relationData)
                );

                // JSON:API 응답 생성
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
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                res.status(status).json(errorResponse);
            }
        });

        // GET /:identifier/relationships/:relationName - 관계 자체 조회
        this.router.get(`/:${primaryKey}/relationships/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return;

                const relationName = req.params.relationName;
                
                // 기본 리소스 조회
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
                
                // 관계 데이터를 JSON:API 형식으로 변환
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
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                res.status(status).json(errorResponse);
            }
        });

        // POST /:identifier/relationships/:relationName - 관계 추가
        this.router.post(`/:${primaryKey}/relationships/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // Content-Type 검증
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
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                res.status(status).json(errorResponse);
            }
        });

        // PATCH /:identifier/relationships/:relationName - 관계 완전 교체
        this.router.patch(`/:${primaryKey}/relationships/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // Content-Type 검증
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
                    // 관계 제거
                    updateData = { [relationName]: { disconnect: true } };
                } else if (Array.isArray(relationshipData)) {
                    // 일대다 관계 교체
                    updateData = { 
                        [relationName]: { 
                            set: relationshipData.map((item: any) => ({ id: item.id })) 
                        } 
                    };
                } else {
                    // 일대일 관계 교체
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
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                res.status(status).json(errorResponse);
            }
        });

        // DELETE /:identifier/relationships/:relationName - 관계 제거
        this.router.delete(`/:${primaryKey}/relationships/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // Content-Type 검증
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
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                res.status(status).json(errorResponse);
            }
        });

        // GET /:identifier/:relationName - 관련 리소스 조회
        this.router.get(`/:${primaryKey}/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req, res, primaryKey, primaryKeyParser, modelName
                );
                if (!success) return;

                const relationName = req.params.relationName;
                const queryParams = CrudQueryParser.parseQuery(req);
                
                // 기본 리소스 조회
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
                    // 관계가 없는 경우 빈 데이터 반환
                    const response = {
                        data: Array.isArray(relationData) ? [] : null,
                        jsonapi: {
                            version: "1.1"
                        }
                    };
                    return res.json(response);
                }

                // Base URL 생성
                const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
                const resourceType = JsonApiTransformer.inferResourceTypeFromRelationship(relationName, Array.isArray(relationData));

                // JSON:API 응답 생성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    relationData,
                    resourceType,
                    {
                        primaryKey: 'id', // 관련 리소스는 기본적으로 id 사용
                        fields: queryParams.fields,
                        baseUrl
                    }
                );

                res.json(serialize(response));

            } catch (error: any) {
                console.error(`Related Resource Error for ${modelName}:`, error);
                const { code, status } = ErrorFormatter.mapPrismaError(error);
                const errorResponse = this.formatJsonApiError(error, code, status, req.path);
                res.status(status).json(errorResponse);
            }
        });
    }

    



    public build(): Router {
        const router = this.router;

        // ExpressRouter 인스턴스에 대한 참조를 유지하여 setBasePath 호출이 가능하도록 함
        (router as any).setBasePath = (path: string) => {
            this.setBasePath(path);
            return router;
        };
        return router; // 최종 Express Router 인스턴스 반환
    }
}
