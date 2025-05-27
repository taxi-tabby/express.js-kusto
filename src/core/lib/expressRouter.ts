import { Router, Request, Response, RequestHandler, static as static_ } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import multer from 'multer';
import { RequestConfig, ResponseConfig, RequestHandler as CustomRequestHandler, ValidatedRequest } from './requestHandler';


type HandlerFunction = (req: Request, res: Response) => void;
type ValidatedHandlerFunction = (req: ValidatedRequest, res: Response) => Promise<any> | any;

export class ExpressRouter {
    public router = Router();

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
        const slugs = this.convertSlugsToPath(slug);
        this.router.get(slugs, handler);
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
        this.router.post(this.convertSlugsToPath(slug), handler);
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
        this.router.put(this.convertSlugsToPath(slug), handler);
        return this;
    }

    public DELETE(handler: HandlerFunction, options?: object): ExpressRouter {
        this.router.delete('/', handler);
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
        this.router.delete(this.convertSlugsToPath(slug), handler);
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
        this.router.patch(this.convertSlugsToPath(slug), handler);
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

    
    public MIDDLE_PROXY_ROUTE(options: Options) {
        this.router.use("/", createProxyMiddleware(options));
    }

    
    public MIDDLE_PROXY_ROUTE_SLUG(slug: string[], options: Options) {
        this.router.use(this.convertSlugsToPath(slug), createProxyMiddleware(options));
    }


    // public STATIC(folderPath: string) {
    //     this.router.use("/", static_(path.join(__dirname, `public/${folderPath}`)))
    // }

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
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );
        this.router.get('/', ...middlewares);
        return this;
    }    /**
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
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );
        
        const slugPath = this.convertSlugsToPath(slug);
        
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
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );
        this.router.post('/', ...middlewares);
        return this;
    }    /**
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
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );
        
        const slugPath = this.convertSlugsToPath(slug);
        
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
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );
        this.router.put('/', ...middlewares);
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
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );
        this.router.delete('/', ...middlewares);
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
        const middlewares = CustomRequestHandler.createHandler(
            { request: requestConfig, response: responseConfig },
            handler
        );
        this.router.patch('/', ...middlewares);
        return this;
    }

    /**
     * # 간단한 검증 메서드들 (응답 검증 없이 요청 검증만)
     */

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
        return this.router; // 최종 Express Router 인스턴스 반환
    }
}
