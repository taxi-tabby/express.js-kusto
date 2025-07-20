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
import { CrudQueryParser, PrismaQueryBuilder, CrudResponseFormatter } from './crudHelpers';
import { ErrorFormatter } from './errorFormatter';
import { serializeBigInt } from './serializer';
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
            only?: ('index' | 'show' | 'create' | 'update' | 'destroy' | 'recover')[];
            except?: ('index' | 'show' | 'create' | 'update' | 'destroy' | 'recover')[];
            /** Primary key 필드명 지정 (기본값: 'id') */
            primaryKey?: string;
            /** Primary key 타입 변환 함수 */
            primaryKeyParser?: (value: string) => any;
            middleware?: {
                index?: HandlerFunction[];
                show?: HandlerFunction[];
                create?: HandlerFunction[];
                update?: HandlerFunction[];
                destroy?: HandlerFunction[];
                recover?: HandlerFunction[];
            };
            validation?: {
                create?: RequestConfig;
                update?: RequestConfig;
                recover?: RequestConfig;
            };
            hooks?: {
                beforeCreate?: (data: any, req: Request) => Promise<any> | any;
                afterCreate?: (result: any, req: Request) => Promise<any> | any;
                beforeUpdate?: (data: any, req: Request) => Promise<any> | any;
                afterUpdate?: (result: any, req: Request) => Promise<any> | any;
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

        // RECOVER - POST /:identifier/recover (복구)
        if (enabledActions.includes('recover')) {
            this.setupRecoverRoute(client, modelName, options, primaryKey, primaryKeyParser);
        }

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
        
        const handler: HandlerFunction = async (req, res, injected, repo, db) => {
            try {
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
                // 쿼리 파라미터 파싱
                const queryParams = CrudQueryParser.parseQuery(req);
                
                // Prisma 쿼리 옵션 빌드
                const findManyOptions = PrismaQueryBuilder.buildFindManyOptions(queryParams);
                
                // 총 개수 조회 (페이지네이션용)
                const totalCountOptions = { ...findManyOptions };
                delete totalCountOptions.skip;
                delete totalCountOptions.take;
                delete totalCountOptions.cursor;
                 
                const [items, total] = await Promise.all([
                    client[modelName].findMany(findManyOptions),
                    client[modelName].count({ where: totalCountOptions.where })
                ]);

                // JSON:API 형식으로 데이터 변환
                const jsonApiData = items.map((item: any) => this.transformToJsonApiResource(item, modelName, req, primaryKey));
                
                // JSON:API 응답 포맷
                const response: any = {
                    data: jsonApiData,
                    jsonapi: {
                        version: "1.0"
                    }
                };

                // 링크 추가 (페이지네이션)
                if (queryParams.page) {
                    const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}${req.path}`;
                    const pageSize = queryParams.page.size || 10;
                    const currentPage = queryParams.page.number || 1;
                    const totalPages = Math.ceil(total / pageSize);
                    
                    response.links = {
                        self: this.buildPaginationUrl(baseUrl, req.query, currentPage, pageSize),
                        first: this.buildPaginationUrl(baseUrl, req.query, 1, pageSize),
                        last: this.buildPaginationUrl(baseUrl, req.query, totalPages, pageSize)
                    };
                    
                    if (currentPage > 1) {
                        response.links.prev = this.buildPaginationUrl(baseUrl, req.query, currentPage - 1, pageSize);
                    }
                    if (currentPage < totalPages) {
                        response.links.next = this.buildPaginationUrl(baseUrl, req.query, currentPage + 1, pageSize);
                    }
                }

                // 메타데이터 추가
                response.meta = {
                    total: total,
                    ...(queryParams.page && {
                        page: {
                            current: queryParams.page.number || 1,
                            size: queryParams.page.size || 10,
                            total: Math.ceil(total / (queryParams.page.size || 10))
                        }
                    })
                };
                
                // BigInt 직렬화 처리
                const serializedResponse = serializeBigInt(response);
                
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
        this.registerDocumentation('GET', '/', {
            summary: `Get ${modelName} list with filtering, sorting, and pagination`,
            parameters: {
                query: {
                    include: { type: 'string', required: false, description: 'Related resources to include (comma-separated)' },
                    sort: { type: 'string', required: false, description: 'Sort fields (prefix with - for desc)' },
                    'page[number]': { type: 'number', required: false, description: 'Page number' },
                    'page[size]': { type: 'number', required: false, description: 'Page size' },
                    'filter[field_op]': { type: 'string', required: false, description: 'Filter conditions (see API docs for operators)' }
                }
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
        
        const handler: HandlerFunction = async (req, res, injected, repo, db) => {
            try {
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', 'application/vnd.api+json');
                
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

                const item = await client[modelName].findUnique({
                    where: { [primaryKey]: parsedIdentifier },
                    ...(includeOptions && { include: includeOptions })
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

                // JSON:API 응답 포맷
                const response = {
                    data: this.transformToJsonApiResource(item, modelName, req, primaryKey),
                    jsonapi: {
                        version: "1.0"
                    }
                };
                
                // BigInt 직렬화 처리
                const serializedResponse = serializeBigInt(response);
                
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
        this.registerDocumentation('GET', routePath, {
            summary: `Get single ${modelName} by ${primaryKey}`,
            parameters: {
                params: {
                    [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                },
                query: {
                    include: { type: 'string', required: false, description: 'Related resources to include' }
                }
            },
            responses: {
                200: {
                    data: { type: 'object', required: true, description: `${modelName} object` }
                },
                404: {
                    error: { type: 'object', required: true, description: 'Not found error' }
                }
            }
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
                
                // 리소스 타입 검증
                const expectedType = modelName.toLowerCase();
                if (requestData.type !== expectedType) {
                    const errorResponse = this.formatJsonApiError(
                        new Error(`Expected resource type '${expectedType}', got '${requestData.type}'`),
                        'INVALID_TYPE',
                        409,
                        req.path
                    );
                    return res.status(409).json(errorResponse);
                }

                // attributes에서 데이터 추출
                let data = requestData.attributes || {};

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

                // JSON:API 응답 포맷
                const response = {
                    data: this.transformToJsonApiResource(result, modelName, req, primaryKey),
                    jsonapi: {
                        version: "1.0"
                    }
                };
                
                // BigInt 직렬화 처리
                const serializedResponse = serializeBigInt(response);
                
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
                
                // 파라미터 추출 및 검증
                const extractResult = this.extractAndParsePrimaryKey(req, res, primaryKey, primaryKeyParser, modelName);
                if (!extractResult.success) return; // 에러 응답은 헬퍼 메서드에서 처리

                const { parsedIdentifier } = extractResult;

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
                
                // 리소스 타입 검증
                const expectedType = modelName.toLowerCase();
                if (requestData.type !== expectedType) {
                    const errorResponse = this.formatJsonApiError(
                        new Error(`Expected resource type '${expectedType}', got '${requestData.type}'`),
                        'INVALID_TYPE',
                        409,
                        req.path
                    );
                    return res.status(409).json(errorResponse);
                }

                // ID 일치성 검증
                if (requestData.id && String(requestData.id) !== String(parsedIdentifier)) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Resource ID in body does not match URL parameter'),
                        'ID_MISMATCH',
                        409,
                        req.path
                    );
                    return res.status(409).json(errorResponse);
                }

                // attributes에서 데이터 추출
                let data = requestData.attributes || {};

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

                // JSON:API 응답 포맷
                const response = {
                    data: this.transformToJsonApiResource(result, modelName, req, primaryKey),
                    jsonapi: {
                        version: "1.0"
                    }
                };
                
                // BigInt 직렬화 처리
                const serializedResponse = serializeBigInt(response);
                
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
                if (options?.hooks?.beforeDestroy) {
                    await options.hooks.beforeDestroy(parsedIdentifier, req);
                }

                await client[modelName].delete({
                    where: { [primaryKey]: parsedIdentifier }
                });

                // After hook 실행
                if (options?.hooks?.afterDestroy) {
                    await options.hooks.afterDestroy(parsedIdentifier, req);
                }

                // JSON:API 삭제 성공 응답 (204 No Content)
                res.status(204).send();
                
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
        this.registerDocumentation('DELETE', routePath, {
            summary: `Delete ${modelName} by ${primaryKey} (JSON:API)`,
            parameters: {
                params: {
                    [primaryKey]: { type: 'string', required: true, description: `${modelName} ${primaryKey}` }
                }
            },
            responses: {
                204: {
                    description: 'Successfully deleted (no content)'
                },
                404: {
                    errors: { type: 'array', required: true, description: 'JSON:API error objects' }
                }
            }
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
                
                // BigInt 직렬화 처리
                const serializedResponse = serializeBigInt(response);
                
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
                        self: `${baseUrl}/${resourceType}/${id}/relationships/${key}`,
                        related: `${baseUrl}/${resourceType}/${id}/${key}`
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
                self: `${baseUrl}/${resourceType}/${id}`
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
                params.append(key, query[key]);
            }
        });
        
        // 페이지네이션 파라미터 추가
        params.append('page[number]', String(page));
        params.append('page[size]', String(size));
        
        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * JSON:API 에러 형식으로 포맷하는 헬퍼 메서드
     */
    private formatJsonApiError(error: any, code: string, status: number, path: string): any {
        return {
            jsonapi: {
                version: "1.0"
            },
            errors: [
                {
                    status: String(status),
                    code: code,
                    title: this.getErrorTitle(status),
                    detail: error.message,
                    source: {
                        pointer: path
                    },
                    meta: {
                        timestamp: new Date().toISOString()
                    }
                }
            ]
        };
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
