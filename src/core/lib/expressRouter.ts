import { Router, Request, Response, RequestHandler, static as static_ } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import multer from 'multer';
import { DocumentationGenerator } from './documentationGenerator';
import { RequestHandler as CustomRequestHandler, RequestConfig, ResponseConfig, ValidatedRequest } from './requestHandler';
import { Injectable } from './types/generated-injectable-types';


type HandlerFunction = (req: Request, res: Response) => void;
type ValidatedHandlerFunction = (req: ValidatedRequest, res: Response, injected: Injectable) => Promise<any> | any;

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
    private convertSlugsToExactPath(slugs: string[]): string {
        const pathSegments = slugs.map(slug => slug === "*" ? "*" : `/:${slug}`);
        const path = pathSegments.join('');
        // 끝에 추가 경로가 오는 것을 방지하기 위해 '(?=/|$)' 사용
        return path + '(?=/|$)';
    }    
    
    /**
     * # GET
     * @param handler 
     * @param options 
     * @returns 
     */
    public GET(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.get('/', handler);
        
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
        this.router.get(slugPath, handler);
        
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
        this.router.post('/', handler);
        
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
        this.router.post(slugPath, handler);
        
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
        this.router.post('/', accpetFileType, handler);
        
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
        const fileSize = options?.fileSize ?? undefined;
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.array(keyName, maxFileCount);
        this.router.post('/', accpetFileType, handler);
        
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
        const upload = multer({ storage: multerStorageEngine, limits: { fileSize: fileSize } });
        const accpetFileType = upload.fields(fields);
        this.router.post('/', accpetFileType, handler);
        
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
        this.router.post('/', accpetFileType, handler);
        return this;
    }



    /**
     * # PUT
     * @param handler 
     * @param options 
     * @returns 
     */
    public PUT(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.put('/', handler);
        
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
        this.router.put('/', accpetFileType, handler);
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
        this.router.put('/', accpetFileType, handler);
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
        this.router.put('/', accpetFileType, handler);
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
        const upload = multer({ storage: multerStorageEngine,  limits: { fileSize: fileSize } });
        const accpetFileType = upload.any();
        this.router.put('/', accpetFileType, handler);
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
        this.router.put(slugPath, handler);
        
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
        this.router.delete('/', handler);
        
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
        this.router.delete(slugPath, handler);
        
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
        this.router.patch('/', handler);
        
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
        this.router.patch(slugPath, handler);
        
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
     * # NOTFOUND
     * @param handler 
     * @param options 
     * @returns 
     */
    public NOTFOUND(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.all('*', handler);
        return this;
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
        );this.router.post('/', ...middlewares);
        
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
     */    public POST_SLUG_VALIDATED(
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
     */    public PUT_VALIDATED(
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
     */    public DELETE_VALIDATED(
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
        );this.router.delete('/', ...middlewares);
        
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
     */    public PATCH_VALIDATED(
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
    
    
    
    /**
     * # DELETE_SLUG_VALIDATED_EXACT
     * 검증된 DELETE 슬러그 요청 처리 (정확한 경로 매칭만)
     */
    public DELETE_SLUG_VALIDATED_EXACT(
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
        this.router.delete(new RegExp(`^${exactPath.replace(/:\w+/g, '([^/]+)')}$`), ...middlewares);
        
        // 문서화 등록을 지연시켜 setBasePath 호출 후 올바른 경로로 등록되도록 함
        if (this.basePath) {
            // basePath가 이미 설정된 경우 즉시 등록
            DocumentationGenerator.registerRoute({
                method: 'DELETE',
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
                method: 'DELETE',
                path: exactPath,
                requestConfig,
                responseConfig
            });
        }
        
        return this;
    }

    /**
     * # GET_SLUG_VALIDATED (개선된 버전)
     * 하위 라우터 영향 방지 옵션 추가
     */
    public GET_SLUG_VALIDATED_IMPROVED(
        slug: string[],
        requestConfig: RequestConfig,
        responseConfig: ResponseConfig,
        handler: ValidatedHandlerFunction,
        options?: { exact?: boolean }
    ): ExpressRouter {

        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );
        
        if (options?.exact) {
            // 정확한 매칭: 하위 경로 방지
            const exactPath = this.convertSlugsToPath(slug);

            // Express에서 정확한 매칭을 위해 미들웨어에서 경로 체크
            const exactMiddleware = (req: any, res: any, next: any) => {
                // URL이 정확히 일치하는지 확인
                const pathPattern = exactPath.replace(/:\w+/g, '[^/]+');
                const regex = new RegExp(`^${pathPattern}$`);
                if (regex.test(req.path)) {
                    next();
                } else {
                    next('route'); // 다른 라우트로 패스
                }
            };

            this.router.get(exactPath, exactMiddleware, ...middlewares);

        } else {
            // 기본 동작: 하위 경로도 매칭
            this.router.get(this.convertSlugsToPath(slug), ...middlewares);
        }
        
        return this;
    }


    build(): Router {
        const router = this.router;
        
        // ExpressRouter 인스턴스에 대한 참조를 유지하여 setBasePath 호출이 가능하도록 함
        (router as any).setBasePath = (path: string) => {
            this.setBasePath(path);
            return router;
        };
        return router; // 최종 Express Router 인스턴스 반환
    }
}
