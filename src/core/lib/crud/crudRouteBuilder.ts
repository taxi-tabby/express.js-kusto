import { RequestHandler as CustomRequestHandler } from '@lib/http/validation/requestHandler';
import { prismaManager } from '@lib/data/database/prismaManager';
import {
    CrudQueryParser,
    PrismaQueryBuilder,
    CrudResponseFormatter,
    JsonApiTransformer,
    JsonApiResponse,
    JsonApiResource,
    JsonApiRelationship,
    JsonApiErrorResponse,
} from '@lib/crud/crudHelpers';
import { ErrorFormatter } from '@lib/http/errors/errorFormatter';
import { serialize } from '@lib/http/serialization/serializer';
import { applyCrudSerializers } from '@lib/crud/crudResponseSerializer';
import {
    parseString as parseStringImpl,
    parseIdSmart as parseIdSmartImpl,
    getSmartPrimaryKeyParser as getSmartPrimaryKeyParserImpl,
    UUID_REGEX,
} from '@lib/crud/primaryKeyParsers';
import {
    DEFAULT_PRIMARY_KEY,
    DEFAULT_SOFT_DELETE_FIELD,
    DEFAULT_PAGE_SIZE,
    CRUD_ACTIONS_WITH_RECOVER,
} from '@lib/crud/crudConstants';
import { ERROR_CODES } from '@lib/http/errors/errorCodes';
import { PrismaSchemaAnalyzer } from '@lib/devtools/schema-api/prismaSchemaAnalyzer';
import {
    jsonApiCollectionResponse,
    jsonApiResponse,
    jsonApiBody,
    jsonApiErrorResponse,
} from '@lib/devtools/documentation';
import {
    JSON_API_CONTENT_TYPE,
    JSON_API_ATOMIC_CONTENT_TYPE,
    JSON_API_VERSION,
    JSON_API_ATOMIC_EXT,
} from '@lib/crud/jsonApiConstants';
import { ErrorHandler, ErrorResponseFormat } from '@lib/http/errors/errorHandler';
import { log } from '@ext/winston';
import type {
    HandlerFunction,
    MiddlewareHandlerFunction,
    RouterContext,
} from '@lib/http/routing/expressRouter';

/**
 * Capabilities the CrudRouteBuilder needs from the ExpressRouter that drives it.
 * Aliased to the shared {@link RouterContext} (single source of truth); on `CRUD()`
 * delegation `this` (an ExpressRouter instance) is passed through as the context.
 */
export type CrudBuilderContext = RouterContext;

/**
 * CRUD 엔진 (JSON:API v1.1).
 *
 * 기존 ExpressRouter 의 CRUD 라우트 설정/헬퍼 로직을 그대로 옮긴 클래스.
 * 동작은 ExpressRouter 시절과 100% 동일하며, ExpressRouter 의 공유 능력은
 * 생성자에 전달된 {@link CrudBuilderContext} 를 통해 호출한다.
 */
export class CrudRouteBuilder {
    constructor(private ctx: CrudBuilderContext) {}

    /**
     * CRUD 라우트 일괄 구성 진입점.
     * 기존 ExpressRouter.CRUD() 의 본문(오케스트레이션)을 그대로 수행한다.
     */
    public build(databaseName: string, modelName: string, options?: any): void {
        // 개발 모드에서 스키마 등록 (비동기로 백그라운드 실행)
        this.registerSchemaInDevelopment(databaseName, modelName as string, options).catch(
            (error) => {
                log.Error(
                    `Failed to register schema (${databaseName}.${modelName}):`,
                    error.message,
                );
            },
        );

        const enabledActions = this.getEnabledActions(options);
        const client = prismaManager.getWrap(databaseName as any);

        // Primary key 설정 및 자동 파서 선택
        const primaryKey = options?.primaryKey || DEFAULT_PRIMARY_KEY;
        const primaryKeyParser =
            options?.primaryKeyParser ||
            this.getSmartPrimaryKeyParser(databaseName, modelName, primaryKey);

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
    }

    /**
     * 개발 모드에서 CRUD 스키마를 등록합니다
     */
    private async registerSchemaInDevelopment(
        databaseName: string,
        modelName: string,
        options?: any,
    ): Promise<void> {
        if (!this.ctx.schemaRegistry.isSchemaApiEnabled() || !this.ctx.schemaAnalyzer) {
            return; // 개발 모드가 아니거나 스키마 분석기가 없으면 등록하지 않음
        }

        try {
            // 현재 스키마 분석기가 요청된 데이터베이스와 다른 경우 새로운 분석기 생성
            let analyzer = this.ctx.schemaAnalyzer;
            if (this.ctx.schemaAnalyzer.getDatabaseName() !== databaseName) {
                const requestedClient = await prismaManager.getClient(databaseName);
                if (requestedClient) {
                    analyzer = PrismaSchemaAnalyzer.getInstance(requestedClient, databaseName);
                } else {
                    log.Warn(
                        `Requested database '${databaseName}' not found. Using the default analyzer.`,
                    );
                }
            }

            // 현재 라우터의 base path를 계산
            const basePath = this.getBasePath(modelName);

            // 스키마 등록
            this.ctx.schemaRegistry.registerSchema(
                databaseName,
                modelName,
                basePath,
                options,
                analyzer,
            );
        } catch (error) {
            log.Warn(
                `Failed to register schema (${databaseName}.${modelName}):`,
                error instanceof Error ? error.message : String(error),
            );
        }
    }

    /**
     * 모델명으로부터 base path를 생성합니다
     */
    private getBasePath(modelName: string): string {
        if (this.ctx.basePath) {
            return `${this.ctx.basePath}/${modelName.toLowerCase()}`;
        }
        return `/${modelName.toLowerCase()}`;
    }

    /**
     * Primary key 타입을 자동으로 감지하고 적절한 파서를 반환하는 헬퍼 메서드
     * (순수 로직은 ./primaryKeyParsers 로 추출됨)
     */
    private getSmartPrimaryKeyParser(
        databaseName: string,
        modelName: string,
        primaryKey: string,
    ): (value: string) => any {
        return getSmartPrimaryKeyParserImpl(databaseName, modelName, primaryKey);
    }

    /**
     * 스마트 ID 파서 - 입력값을 보고 적절한 타입으로 변환
     * UUID 형식이 아닌 경우 숫자를 문자열로 안전하게 처리
     * (순수 로직은 ./primaryKeyParsers 로 추출됨)
     */
    private parseIdSmart = (id: string): any => parseIdSmartImpl(id);

    /**
     * 생성된 액션 목록 계산
     *
     * 우선순위:
     * 1. only와 except가 모두 지정된 경우: only를 우선으로 사용하며, 경고 로그를 출력
     * 2. only가 지정된 경우: only에 포함된 액션들만 생성함
     * 3. except가 지정된 경우: 전체 액션에서 except에 포함된 것들을 제외
     * 4. 아무것도 없는 경우: 모든 액션 생성함
     */
    private getEnabledActions(options?: any): string[] {
        const allActions = [...CRUD_ACTIONS_WITH_RECOVER];

        // only와 except가 모두 지정된 경우 경고
        if (options?.only && options?.except) {
            log.Warn(
                '[CRUD Warning] Both "only" and "except" options are specified. ' +
                    '"only" takes precedence and "except" will be ignored.',
            );
            return options.only;
        }

        // only가 지정된 경우
        if (options?.only) {
            return options.only;
        }

        // except가 지정된 경우
        if (options?.except) {
            return allActions.filter((action) => !options.except.includes(action));
        }

        // 기본값: 모든 액션
        return allActions;
    }

    /**
     * INDEX 라우트 설정 (GET /) - JSON:API 준수
     */
    private setupIndexRoute(
        client: any,
        modelName: string,
        options?: any,
        primaryKey: string = DEFAULT_PRIMARY_KEY,
    ): void {
        const middlewares = options?.middleware?.index || [];
        const isSoftDelete = options?.softDelete?.enabled;
        const softDeleteField = options?.softDelete?.field || DEFAULT_SOFT_DELETE_FIELD;

        const handler: HandlerFunction = async (req, res, _injected, _repo, _db) => {
            try {
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', JSON_API_CONTENT_TYPE);
                res.setHeader('Vary', 'Accept');

                // 쿼리 파라미터 파싱 + include 정책 적용 (UUID 검증 등의 에러 발생 가능)
                const queryParams = this.parseQueryWithIncludePolicy(req, res, modelName, options);
                if (!queryParams) return; // 에러 응답은 이미 헬퍼에서 전송됨

                // 페이지네이션 파라미터 검증 (미지정/잘못된 파라미터/잘못된 size)
                if (this.validateIndexPagination(req, res, queryParams)) return; // 에러 응답은 이미 헬퍼에서 전송됨

                // Prisma 쿼리 옵션 빌드
                let findManyOptions = PrismaQueryBuilder.buildFindManyOptions(queryParams);

                // beforeIndex 훅 실행 (쿼리 옵션 가공)
                const hookResult = await this.runBeforeIndexHook(
                    findManyOptions,
                    req,
                    res,
                    options,
                );
                if (!hookResult) return; // 에러 응답은 이미 헬퍼에서 전송됨
                findManyOptions = hookResult.findManyOptions;

                // Soft Delete 필터 추가 (기존 where 조건과 병합)
                findManyOptions = this.applyIndexSoftDeleteFilter(
                    findManyOptions,
                    req,
                    isSoftDelete,
                    softDeleteField,
                );

                // 총 개수 조회 (페이지네이션용)
                const totalCountOptions = { ...findManyOptions };
                delete totalCountOptions.skip;
                delete totalCountOptions.take;
                delete totalCountOptions.cursor;

                const [items, total] = await Promise.all([
                    client[modelName].findMany(findManyOptions),
                    client[modelName].count({ where: totalCountOptions.where }),
                ]);

                const serializedItems = await applyCrudSerializers(
                    items,
                    options?.serialize,
                    options?.serializeIncludes,
                    req,
                    { primaryKey },
                );

                // JSON:API 응답 엔벨로프 조립 + 직렬화
                const serializedResponse = this.buildIndexResponse(
                    serializedItems,
                    total,
                    queryParams,
                    req,
                    modelName,
                    options,
                    primaryKey,
                );

                res.json(serializedResponse);
            } catch (error: any) {
                log.Error(`CRUD Index Error for ${modelName}:`, error);

                this.sendMappedCrudError(res, error, req);
            }
        };

        // 미들웨어 등록
        if (middlewares.length > 0) {
            const wrappedMiddlewares = middlewares.map((mw: MiddlewareHandlerFunction) =>
                this.ctx.wrapMiddleware(mw),
            );
            this.ctx.router.get('/', ...wrappedMiddlewares, this.ctx.wrapHandler(handler));
        } else {
            this.ctx.router.get('/', this.ctx.wrapHandler(handler));
        }

        // 문서화 등록
        const queryParams: any = {
            include: {
                type: 'string',
                required: false,
                description:
                    'Related resources to include (comma-separated). Example: author,comments.author',
            },
            'fields[type]': {
                type: 'string',
                required: false,
                description:
                    'Sparse fieldsets - specify which fields to include for each resource type. Example: fields[posts]=title,content&fields[users]=name,email',
            },
            sort: {
                type: 'string',
                required: false,
                description: 'Sort fields (prefix with - for desc). Example: -createdAt,title',
            },
            'page[number]': {
                type: 'number',
                required: true,
                description: 'Page number for offset-based pagination (required with page[size])',
            },
            'page[cursor]': {
                type: 'string',
                required: false,
                description: 'Cursor for cursor-based pagination (alternative to page[number])',
            },
            'page[size]': {
                type: 'number',
                required: true,
                description: 'Page size for pagination (required)',
            },
            'filter[field_op]': {
                type: 'string',
                required: false,
                description:
                    'Filter conditions. Operators: eq, ne, gt, gte, lt, lte, like, in, etc. Example: filter[status_eq]=active&filter[age_gte]=18',
            },
        };

        // Soft delete가 설정된 경우 include_deleted 파라미터 추가
        if (isSoftDelete) {
            queryParams.include_deleted = {
                type: 'boolean',
                required: false,
                description: 'Include soft deleted items (default: false)',
            };
        }

        this.ctx.registerDocumentation('GET', '/', {
            summary: `Get ${modelName} list with required pagination, optional filtering and sorting`,
            parameters: {
                query: queryParams,
            },
            responses: {
                200: jsonApiCollectionResponse(modelName),
                400: jsonApiErrorResponse(400),
            },
        });
    }

    /**
     * SHOW 라우트 설정 (GET /:identifier) - JSON:API 준수
     */
    private setupShowRoute(
        client: any,
        modelName: string,
        options?: any,
        primaryKey: string = DEFAULT_PRIMARY_KEY,
        primaryKeyParser: (value: string) => any = parseStringImpl,
    ): void {
        const middlewares = options?.middleware?.show || [];
        const isSoftDelete = options?.softDelete?.enabled;
        const softDeleteField = options?.softDelete?.field || DEFAULT_SOFT_DELETE_FIELD;

        const handler: HandlerFunction = async (req, res, _injected, _repo, _db) => {
            try {
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', JSON_API_CONTENT_TYPE);
                res.setHeader('Vary', 'Accept');

                // 파라미터 추출 및 파싱
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req,
                    res,
                    primaryKey,
                    primaryKeyParser,
                    modelName,
                );
                if (!success) return; // 에러 응답은 이미 헬퍼에서 처리됨

                // 쿼리 파라미터에서 include 파싱 + include 정책 적용 (UUID 검증 등의 에러 발생 가능)
                const queryParams = this.parseQueryWithIncludePolicy(req, res, modelName, options);
                if (!queryParams) return; // 에러 응답은 이미 헬퍼에서 전송됨

                const includeOptions = queryParams.include
                    ? PrismaQueryBuilder['buildIncludeOptions'](queryParams.include)
                    : undefined;

                // Soft Delete 필터 추가 (include_deleted가 true가 아닌 경우)
                const includeDeleted = req.query.include_deleted === 'true';
                const whereClause: any = { [primaryKey]: parsedIdentifier };

                if (isSoftDelete && !includeDeleted) {
                    whereClause[softDeleteField] = null;
                }

                // Prisma findFirst 옵션 구성
                let findOptions: any = {
                    where: whereClause,
                    ...(includeOptions && { include: includeOptions }),
                };

                // beforeShow 훅 실행 (조회 옵션 가공)
                if (options?.hooks?.beforeShow) {
                    try {
                        const hookResult = await options.hooks.beforeShow(findOptions, req);
                        if (hookResult) {
                            findOptions = hookResult;
                        }
                    } catch (hookError) {
                        const errorResponse = this.formatJsonApiError(
                            hookError instanceof Error
                                ? hookError
                                : new Error('Hook execution failed'),
                            ERROR_CODES.INTERNAL_SERVER_ERROR,
                            500,
                            req.path,
                            req.method,
                        );
                        return res.status(500).json(errorResponse);
                    }
                }

                const item = await client[modelName].findFirst(findOptions);

                if (!item) {
                    // Soft delete된 데이터 확인 (include_deleted=false 상태에서)
                    if (isSoftDelete && !includeDeleted) {
                        const deletedItem = await client[modelName].findUnique({
                            where: { [primaryKey]: parsedIdentifier },
                        });

                        if (deletedItem && deletedItem[softDeleteField]) {
                            // Soft delete된 경우에는 410 Gone 응답 (JSON:API 확장)
                            const errorResponse = this.formatJsonApiError(
                                new Error(`${modelName} has been deleted`),
                                ERROR_CODES.RESOURCE_DELETED,
                                410,
                                req.path,
                                req.method,
                            );
                            return res.status(410).json(errorResponse);
                        }
                    }

                    const errorResponse = this.formatJsonApiError(
                        new Error(`${modelName} not found`),
                        ERROR_CODES.NOT_FOUND,
                        404,
                        req.path,
                        req.method,
                    );
                    return res.status(404).json(errorResponse);
                }

                // Base URL 생성
                const baseUrl = this.buildBaseUrl(req);

                const serializedItem = await applyCrudSerializers(
                    item,
                    options?.serialize,
                    options?.serializeIncludes,
                    req,
                    { primaryKey },
                );

                // 포함된 리소스 생성 (include 파라미터가 있는 경우)
                let included: JsonApiResource[] | undefined;
                if (
                    queryParams.include &&
                    queryParams.include.length > 0 &&
                    !options?.includeMerge
                ) {
                    included = JsonApiTransformer.createIncludedResources(
                        [serializedItem],
                        queryParams.include,
                        queryParams.fields,
                        baseUrl,
                    );
                }

                // Json 타입 필드 목록 가져오기
                const jsonFields = this.getJsonFieldSet(modelName);

                // JSON:API 응답 생성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    serializedItem,
                    modelName,
                    {
                        primaryKey,
                        fields: queryParams.fields,
                        baseUrl,
                        included,
                        includeMerge: options?.includeMerge || false,
                        jsonFields,
                    },
                );

                // metadata 객체 생성 - 기존 헬퍼 함수 사용
                const metadata = CrudResponseFormatter.createPaginationMeta(
                    [item], // 단일 아이템을 배열로 감싸서 전달
                    1, // total count는 1
                    undefined, // page 파라미터 없음 (단일 조회)
                    'show',
                    queryParams.include,
                    queryParams,
                );

                // excludedFields 추가 (show 전용)
                if (queryParams.fields) {
                    metadata.excludedFields = Object.keys(queryParams.fields[modelName] || {});
                }

                // BigInt와 DATE 타입 직렬화 처리
                const serializedResponse = serialize({ ...response, metadata });

                res.json(serializedResponse);
            } catch (error: any) {
                log.Error(`CRUD Show Error for ${modelName}:`, error);

                this.sendMappedCrudError(res, error, req);
            }
        };

        // 미들웨어 등록 - 정적 경로 사용
        const routePath = `/:${primaryKey}`;
        if (middlewares.length > 0) {
            const wrappedMiddlewares = middlewares.map((mw: MiddlewareHandlerFunction) =>
                this.ctx.wrapMiddleware(mw),
            );
            this.ctx.router.get(routePath, ...wrappedMiddlewares, this.ctx.wrapHandler(handler));
        } else {
            this.ctx.router.get(routePath, this.ctx.wrapHandler(handler));
        }

        // 문서화 등록
        const queryParams: any = {
            include: {
                type: 'string',
                required: false,
                description: 'Related resources to include',
            },
        };

        // Soft delete가 설정된 경우 include_deleted 파라미터 추가
        if (isSoftDelete) {
            queryParams.include_deleted = {
                type: 'boolean',
                required: false,
                description: 'Include soft deleted items (default: false)',
            };
        }

        const responses: any = {
            200: jsonApiResponse(modelName, 200),
            404: jsonApiErrorResponse(404),
        };

        // Soft delete가 설정된 경우 410 Gone 응답 추가
        if (isSoftDelete) {
            responses[410] = jsonApiErrorResponse(410);
        }

        this.ctx.registerDocumentation('GET', routePath, {
            summary: `Get single ${modelName} by ${primaryKey}`,
            parameters: {
                params: {
                    [primaryKey]: {
                        type: 'string',
                        required: true,
                        description: `${modelName} ${primaryKey}`,
                    },
                },
                query: queryParams,
            },
            responses: responses,
        });
    }

    /**
     * CREATE 라우트 설정 (POST /) - JSON:API 준수
     */
    private setupCreateRoute(
        client: any,
        modelName: string,
        options?: any,
        primaryKey: string = DEFAULT_PRIMARY_KEY,
    ): void {
        const middlewares = options?.middleware?.create || [];

        const handler: HandlerFunction = async (req, res, _injected, _repo, _db) => {
            try {
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', JSON_API_CONTENT_TYPE);
                res.setHeader('Vary', 'Accept');

                // 쿼리 파라미터 파싱 + include 정책 적용 (응답 included 지원)
                const queryParams = this.parseQueryWithIncludePolicy(req, res, modelName, options);
                if (!queryParams) return; // 에러 응답은 이미 헬퍼에서 전송됨

                // Content Negotiation 검증
                // if (!this.validateJsonApiContentType(req, res)) {
                //     return;
                // }

                // JSON:API 요청 형식 검증
                if (!req.body || !req.body.data) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Request must contain a data object'),
                        ERROR_CODES.INVALID_REQUEST,
                        400,
                        req.path,
                        req.method,
                    );
                    return res.status(400).json(errorResponse);
                }

                const { data: requestData } = req.body;

                // 리소스 타입 검증 (라우트 경로에서 추출 또는 옵션 사용)
                const routeResourceType =
                    req.baseUrl.split('/').filter(Boolean).pop() || modelName.toLowerCase();
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
                    if (primaryKey === DEFAULT_PRIMARY_KEY) {
                        data.id = requestData.id;
                    } else {
                        data[primaryKey] = requestData.id;
                    }
                }

                // 관계 데이터 처리 (relationships가 있는 경우)
                if (requestData.relationships) {
                    try {
                        data = await this.processRelationships(
                            data,
                            requestData.relationships,
                            client,
                            modelName,
                            false, // 생성 모드
                            options, // softDelete 옵션 전달 (생성 시에는 parentId 불필요)
                        );
                    } catch (relationshipError: any) {
                        const errorResponse = this.formatJsonApiError(
                            relationshipError,
                            ERROR_CODES.INVALID_RELATIONSHIP,
                            422,
                            req.path,
                            req.method,
                        );
                        return res.status(422).json(errorResponse);
                    }
                }

                // Before hook 실행
                if (options?.hooks?.beforeCreate) {
                    data = await options.hooks.beforeCreate(data, req);
                }

                // include 옵션 빌드 (?include= 또는 defaultIncludes 적용 시)
                const createIncludeOptions =
                    queryParams.include && queryParams.include.length > 0
                        ? PrismaQueryBuilder['buildIncludeOptions'](queryParams.include)
                        : undefined;

                const result = await client[modelName].create({
                    data,
                    ...(createIncludeOptions && { include: createIncludeOptions }),
                });

                // After hook 실행
                if (options?.hooks?.afterCreate) {
                    await options.hooks.afterCreate(result, req);
                }

                const serializedResult = await applyCrudSerializers(
                    result,
                    options?.serialize,
                    options?.serializeIncludes,
                    req,
                    { primaryKey },
                );

                // Base URL 생성
                const baseUrl = this.buildBaseUrl(req);

                // 포함된 리소스 생성 (include 파라미터가 있는 경우)
                let createIncluded: JsonApiResource[] | undefined;
                if (
                    queryParams.include &&
                    queryParams.include.length > 0 &&
                    !options?.includeMerge
                ) {
                    createIncluded = JsonApiTransformer.createIncludedResources(
                        [serializedResult],
                        queryParams.include,
                        queryParams.fields,
                        baseUrl,
                    );
                }

                // Json 타입 필드 목록 가져오기
                const jsonFields = this.getJsonFieldSet(modelName);

                // JSON:API 응답 생성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    serializedResult,
                    modelName,
                    {
                        primaryKey,
                        fields: queryParams.fields,
                        baseUrl,
                        included: createIncluded,
                        includeMerge: options?.includeMerge || false,
                        jsonFields,
                    },
                );

                // metadata 객체 생성 - 기존 헬퍼 함수 사용
                const metadata = CrudResponseFormatter.createPaginationMeta(
                    [result], // 단일 항목을 배열로 감싸서 전달
                    1, // total count = 1
                    undefined, // page 파라미터 없음 (단일 생성)
                    'create',
                    queryParams.include,
                    queryParams,
                );

                // BigInt와 DATE 타입 직렬화 처리
                const serializedResponse = serialize({ ...response, metadata });

                res.status(201).json(serializedResponse);
            } catch (error: any) {
                log.Error(`CRUD Create Error for ${modelName}:`, error);

                this.sendMappedCrudError(res, error, req);
            }
        };

        // Validation이 있는 경우
        if (options?.validation?.create) {
            const validationMiddlewares = CustomRequestHandler.withValidation(
                options.validation.create,
                handler,
            );

            if (middlewares.length > 0) {
                this.ctx.router.post('/', ...middlewares, ...validationMiddlewares);
            } else {
                this.ctx.router.post('/', ...validationMiddlewares);
            }
        } else {
            // 일반 핸들러
            if (middlewares.length > 0) {
                const wrappedMiddlewares = middlewares.map((mw: MiddlewareHandlerFunction) =>
                    this.ctx.wrapMiddleware(mw),
                );
                this.ctx.router.post('/', ...wrappedMiddlewares, this.ctx.wrapHandler(handler));
            } else {
                this.ctx.router.post('/', this.ctx.wrapHandler(handler));
            }
        }

        // 문서화 등록 (JSON:API ref 사용)
        this.ctx.registerDocumentation('POST', '/', {
            summary: `Create new ${modelName} (JSON:API)`,
            parameters: {
                body: jsonApiBody(modelName, 'create'),
            },
            responses: {
                201: jsonApiResponse(modelName, 201),
                400: jsonApiErrorResponse(400),
                422: jsonApiErrorResponse(422),
            },
        });
    }

    /**
     * Atomic Operations 엔드포인트 설정 (JSON:API Extension)
     */
    private setupAtomicOperationsRoute(client: any, modelName: string, options?: any): void {
        const handler: HandlerFunction = async (req, res, _injected, _repo, _db) => {
            try {
                res.setHeader('Content-Type', JSON_API_ATOMIC_CONTENT_TYPE);

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
                        ERROR_CODES.INVALID_REQUEST,
                        400,
                        req.path,
                        req.method,
                    );
                    return res.status(400).json(errorResponse);
                }

                const operations = req.body['atomic:operations'];
                const results: (any | null)[] = [];

                // 트랜잭션으로 모든 작업 실행
                await client.$transaction(async (tx: any) => {
                    for (const operation of operations) {
                        const result = await this.executeAtomicOperation(
                            tx,
                            operation,
                            modelName,
                            options,
                            req,
                        );
                        results.push(result);
                    }
                });

                const response = {
                    'atomic:results': results,
                    jsonapi: {
                        version: JSON_API_VERSION,
                        ext: [JSON_API_ATOMIC_EXT],
                    },
                };

                res.status(200).json(response);
            } catch (error: any) {
                log.Error(`Atomic Operations Error for ${modelName}:`, error);
                this.sendMappedCrudError(res, error, req);
            }
        };

        this.ctx.router.post('/atomic', this.ctx.wrapHandler(handler));
    }

    /**
     * 단일 원자적 작업 실행
     */
    private async executeAtomicOperation(
        tx: any,
        operation: any,
        modelName: string,
        _options: any,
        _req: any,
    ): Promise<any | null> {
        switch (operation.op) {
            case 'add': {
                if (!operation.data) {
                    throw new Error('Add operation requires data');
                }

                const createData = operation.data.attributes || {};
                if (operation.data.relationships) {
                    const processedData = await this.processRelationships(
                        createData,
                        operation.data.relationships,
                        tx,
                        modelName,
                    );
                    Object.assign(createData, processedData);
                }

                const created = await tx[modelName].create({ data: createData });
                return JsonApiTransformer.transformToResource(created, { resourceType: modelName });
            }

            case 'update': {
                if (!operation.ref || !operation.data) {
                    throw new Error('Update operation requires ref and data');
                }

                const updateData = operation.data.attributes || {};
                if (operation.data.relationships) {
                    const processedData = await this.processRelationships(
                        updateData,
                        operation.data.relationships,
                        tx,
                        modelName,
                    );
                    Object.assign(updateData, processedData);
                }

                const updated = await tx[modelName].update({
                    where: { id: operation.ref.id },
                    data: updateData,
                });
                return JsonApiTransformer.transformToResource(updated, { resourceType: modelName });
            }

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
                        data: relationshipData,
                    });
                } else {
                    // 리소스 제거
                    await tx[modelName].delete({
                        where: { id: operation.ref.id },
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
    private validateJsonApiResource(
        data: any,
        expectedType: string,
        req: any,
        res: any,
        isUpdate: boolean = false,
    ): boolean {
        // 리소스 객체 구조 검증
        if (!data || typeof data !== 'object') {
            const errorResponse = this.formatJsonApiError(
                new Error('Resource must be an object'),
                'INVALID_RESOURCE_STRUCTURE',
                400,
                req.path,
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
                    req.path,
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
                    req.path,
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
                req.path,
            );
            res.status(400).json(errorResponse);
            return false;
        }

        if (data.relationships && typeof data.relationships !== 'object') {
            const errorResponse = this.formatJsonApiError(
                new Error('Resource relationships must be an object'),
                'INVALID_RELATIONSHIPS',
                400,
                req.path,
            );
            res.status(400).json(errorResponse);
            return false;
        }

        return true;
    }

    /**
     * PATCH 부분 업데이트 전략 처리
     */
    private async applyPatchStrategy(
        existingData: any,
        newData: any,
        strategy: 'merge' | 'replace' = 'merge',
    ): Promise<any> {
        if (strategy === 'replace') {
            return newData;
        }

        // merge 전략: 기존 데이터와 새 데이터를 병합
        const mergedData = { ...existingData };

        Object.keys(newData).forEach((key) => {
            if (newData[key] !== undefined) {
                if (
                    typeof newData[key] === 'object' &&
                    newData[key] !== null &&
                    !Array.isArray(newData[key])
                ) {
                    // 객체인 경우 재귀적으로 병합
                    mergedData[key] = {
                        ...(mergedData[key] || {}),
                        ...newData[key],
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
     * JSON:API 관계 데이터 처리 - 최신 JSON:API 명세 준수
     * PATCH 요청 시 relationships는 "replace" 동작 (기존 관계를 완전히 대체)
     * 생성/수정 시 관계 데이터를 Prisma 형식으로 변환
     * 기존 리소스 연결과 새 리소스 생성을 모두 지원
     *
     * @param data 기존 데이터
     * @param relationships JSON:API relationships 객체
     * @param client Prisma 클라이언트
     * @param modelName 모델명
     * @param isUpdate 업데이트 여부
     * @param options CRUD 옵션 (softDelete 등)
     * @param parentId 부모 리소스 ID (관계 삭제 시 필요)
     * @param parentIdField 부모 ID 필드명 (기본값: 'id')
     */
    private async processRelationships(
        data: any,
        relationships: Record<string, JsonApiRelationship>,
        client: any,
        modelName: string,
        isUpdate: boolean = false,
        options?: any,
        parentId?: any,
        parentIdField: string = DEFAULT_PRIMARY_KEY,
    ): Promise<any> {
        const processedData = { ...data };

        // softDelete 옵션 확인
        const isSoftDelete = options?.softDelete?.enabled;
        const softDeleteField = options?.softDelete?.field || DEFAULT_SOFT_DELETE_FIELD;

        for (const [relationName, relationshipData] of Object.entries(relationships)) {
            if (relationshipData.data !== undefined) {
                // null인 경우 - 관계 제거 (업데이트 시에만)
                if (relationshipData.data === null) {
                    if (isUpdate) {
                        // softDelete인 경우 관계된 레코드를 soft delete
                        if (isSoftDelete && parentId) {
                            await this.softDeleteRelatedRecords(
                                client,
                                modelName,
                                relationName,
                                parentId,
                                parentIdField,
                                softDeleteField,
                            );
                            // Prisma 관계는 disconnect하지 않음 (soft delete된 레코드 유지)
                        } else {
                            processedData[relationName] = {
                                disconnect: true,
                            };
                        }
                    }
                    // 생성 시에는 null 관계를 무시
                }
                // 배열인 경우 - 일대다 관계
                else if (Array.isArray(relationshipData.data)) {
                    if (relationshipData.data.length === 0) {
                        // 빈 배열 - 모든 관계 제거 (업데이트 시에만)
                        if (isUpdate) {
                            if (isSoftDelete && parentId) {
                                // 기존 모든 관계를 soft delete
                                await this.softDeleteRelatedRecords(
                                    client,
                                    modelName,
                                    relationName,
                                    parentId,
                                    parentIdField,
                                    softDeleteField,
                                );
                            } else {
                                processedData[relationName] = {
                                    set: [],
                                };
                            }
                        }
                    } else {
                        // 관계 데이터 처리 - JSON:API 표준 준수
                        // relationships.data는 Resource Identifier Objects만 포함
                        // (type과 id만 있어야 함, attributes는 허용하지 않음)
                        const connectIds: any[] = [];
                        let relatedResourceType: string | null = null;

                        for (const item of relationshipData.data) {
                            if (!item.type) {
                                throw new Error(
                                    `Invalid relationship data: missing type in ${relationName}`,
                                );
                            }

                            // 첫 번째 아이템의 type을 저장 (soft delete 시 사용)
                            if (!relatedResourceType) {
                                relatedResourceType = item.type;
                            }

                            // JSON:API 표준: id가 반드시 있어야 함
                            if (!item.id) {
                                throw new Error(
                                    `Invalid relationship data: missing id in ${relationName}. JSON:API requires resource identifier objects to have both type and id.`,
                                );
                            }

                            connectIds.push({ id: this.parseRelationshipId(item.id) });
                        }

                        // JSON:API 스펙: UPDATE 시 relationships는 "replace" 동작
                        if (isUpdate) {
                            if (isSoftDelete && parentId && relatedResourceType) {
                                // 1. 기존 관계 중 새 목록에 없는 것들을 soft delete
                                // relatedResourceType (요청의 type)에서 모델명 추출
                                await this.replaceRelationshipsWithSoftDelete(
                                    client,
                                    modelName,
                                    relatedResourceType, // relationName 대신 실제 type 사용
                                    parentId,
                                    parentIdField,
                                    connectIds.map((c) => c.id),
                                    softDeleteField,
                                );

                                // 2. 새 연결 처리
                                if (connectIds.length > 0) {
                                    processedData[relationName] = {
                                        connect: connectIds,
                                    };
                                }
                            } else {
                                // Hard delete: set으로 완전 대체
                                processedData[relationName] = {
                                    set: connectIds,
                                };
                            }
                        } else {
                            // CREATE 시에는 connect 사용
                            if (connectIds.length > 0) {
                                processedData[relationName] = {
                                    connect: connectIds,
                                };
                            }
                        }
                    }
                }
                // 단일 객체인 경우 - 일대일 관계
                else if (typeof relationshipData.data === 'object') {
                    if (!relationshipData.data.type) {
                        throw new Error(
                            `Invalid relationship data: missing type in ${relationName}`,
                        );
                    }

                    // JSON:API 표준: id가 반드시 있어야 함
                    if (!relationshipData.data.id) {
                        throw new Error(
                            `Invalid relationship data: missing id in ${relationName}. JSON:API requires resource identifier objects to have both type and id.`,
                        );
                    }

                    // 기존 리소스 연결
                    processedData[relationName] = {
                        connect: { id: this.parseRelationshipId(relationshipData.data.id) },
                    };
                }
            }
        }

        return processedData;
    }

    /**
     * 관계 ID 파싱 (문자열 숫자는 숫자로 변환)
     */
    private parseRelationshipId(id: any): any {
        if (typeof id === 'string') {
            // UUID 형식인지 확인 (UUID_REGEX 단일 출처)
            if (UUID_REGEX.test(id)) {
                return id; // UUID는 문자열 그대로
            }
            // 숫자 문자열인 경우
            const numId = parseInt(id, 10);
            if (!isNaN(numId)) {
                return numId;
            }
        }
        return id;
    }

    /**
     * 관련 레코드들을 soft delete 처리
     * @param resourceType 요청에서 전달된 리소스 타입 (예: "UserRole", "userRole")
     */
    private async softDeleteRelatedRecords(
        client: any,
        modelName: string,
        resourceType: string,
        parentId: any,
        parentIdField: string,
        softDeleteField: string,
    ): Promise<void> {
        try {
            // 리소스 타입에서 모델명 추론 (예: UserRole -> UserRole, userRole -> UserRole)
            const relatedModelName = this.getModelNameFromResourceType(resourceType);
            if (!relatedModelName || !client[relatedModelName]) {
                log.Warn(
                    `Could not find model for resourceType: ${resourceType} (tried: ${relatedModelName})`,
                );
                return;
            }

            // 부모 참조 필드명 추론 (예: User -> userUuid, userId 등)
            const parentRefField = this.inferParentReferenceField(modelName, parentIdField);

            // 관련 레코드들을 soft delete
            await client[relatedModelName].updateMany({
                where: {
                    [parentRefField]: parentId,
                    [softDeleteField]: null, // 아직 삭제되지 않은 것만
                },
                data: {
                    [softDeleteField]: new Date(),
                },
            });
        } catch (error) {
            // 호출자(destroy 핸들러)가 데이터 일관성을 인지할 수 있도록 재던진다.
            // 예전에는 Warn 로그만 남기고 부모 삭제는 성공(204) 응답을 보냈는데, 이는 orphan 관계를 만들고
            // 클라이언트가 "성공" 으로 오해하게 한다.
            log.Error(`Failed to soft delete related records for ${resourceType}`, {
                error: error instanceof Error ? error.message : String(error),
                parentId,
            });
            throw error;
        }
    }

    /**
     * 관계를 soft delete 방식으로 대체 (replace)
     * 새 목록에 없는 기존 관계만 soft delete
     * @param resourceType 요청에서 전달된 리소스 타입 (예: "UserRole", "userRole")
     */
    private async replaceRelationshipsWithSoftDelete(
        client: any,
        modelName: string,
        resourceType: string,
        parentId: any,
        parentIdField: string,
        newIds: any[],
        softDeleteField: string,
    ): Promise<void> {
        try {
            // 리소스 타입에서 모델명 추론 (예: UserRole -> UserRole, userRole -> UserRole)
            const relatedModelName = this.getModelNameFromResourceType(resourceType);
            if (!relatedModelName || !client[relatedModelName]) {
                log.Warn(
                    `Could not find model for resourceType: ${resourceType} (tried: ${relatedModelName})`,
                );
                return;
            }

            const parentRefField = this.inferParentReferenceField(modelName, parentIdField);

            // 새 목록에 없는 기존 관계만 soft delete
            const whereClause: any = {
                [parentRefField]: parentId,
                [softDeleteField]: null,
            };

            // newIds가 있으면 해당 ID들은 제외
            if (newIds.length > 0) {
                whereClause.id = { notIn: newIds };
            }

            await client[relatedModelName].updateMany({
                where: whereClause,
                data: {
                    [softDeleteField]: new Date(),
                },
            });

            // soft delete된 레코드 중 다시 연결해야 할 것들 복원
            if (newIds.length > 0) {
                await client[relatedModelName].updateMany({
                    where: {
                        [parentRefField]: parentId,
                        id: { in: newIds },
                        [softDeleteField]: { not: null },
                    },
                    data: {
                        [softDeleteField]: null,
                    },
                });
            }
        } catch (error) {
            // 부모 update 가 성공한 뒤 자식 관계 갱신만 실패하면 데이터 일관성이 깨진다 — 호출자가 인지하도록 재던진다.
            log.Error(`Failed to replace relationships with soft delete for ${resourceType}`, {
                error: error instanceof Error ? error.message : String(error),
                parentId,
                newIdsCount: newIds.length,
            });
            throw error;
        }
    }

    /**
     * 부모 모델의 참조 필드명 추론
     */
    private inferParentReferenceField(modelName: string, parentIdField: string): string {
        // 모델명을 camelCase로 변환 후 ID 필드 추가
        const camelModelName = modelName.charAt(0).toLowerCase() + modelName.slice(1);

        // parentIdField가 'uuid'면 'userUuid' 형태, 'id'면 'userId' 형태
        if (parentIdField === 'uuid') {
            return `${camelModelName}Uuid`;
        } else if (parentIdField === DEFAULT_PRIMARY_KEY) {
            return `${camelModelName}Id`;
        }

        // 기본값: camelCase + 첫글자 대문자 parentIdField
        return `${camelModelName}${parentIdField.charAt(0).toUpperCase()}${parentIdField.slice(1)}`;
    }

    /**
     * 리소스 타입에서 Prisma 모델명을 추론하는 헬퍼 메서드
     * - userRole, userrole, user-role, user_role -> UserRole
     * - users -> User
     */
    private getModelNameFromResourceType(resourceType: string): string | null {
        // 1. 먼저 kebab-case나 snake_case를 분리
        let parts: string[];

        if (resourceType.includes('-') || resourceType.includes('_')) {
            // kebab-case 또는 snake_case
            parts = resourceType.split(/[-_]/);
        } else {
            // camelCase 또는 lowercase 처리
            // userRole -> ['user', 'Role'] -> ['user', 'role']
            // userrole -> ['userrole']
            parts = resourceType.split(/(?=[A-Z])/).map((p) => p.toLowerCase());

            // 전부 소문자인 경우 (userrole) 일반적인 패턴으로 분리 시도
            if (parts.length === 1 && parts[0] === resourceType.toLowerCase()) {
                // 알려진 패턴들을 체크
                const knownPatterns = [
                    { pattern: /^user(role|permission|session|token)s?$/i, split: ['user', '$1'] },
                    { pattern: /^role(permission)s?$/i, split: ['role', '$1'] },
                    { pattern: /^(.+)(item|detail|log|history)s?$/i, split: ['$1', '$2'] },
                ];

                for (const { pattern, split } of knownPatterns) {
                    const match = resourceType.match(pattern);
                    if (match) {
                        parts = split.map((s) => (s.startsWith('$') ? match[parseInt(s[1])] : s));
                        break;
                    }
                }
            }
        }

        // 2. 각 부분을 PascalCase로 변환
        let pascalCase = parts
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');

        // 3. 복수형 -> 단수형 변환
        if (pascalCase.endsWith('ies')) {
            pascalCase = pascalCase.slice(0, -3) + 'y'; // Categories -> Category
        } else if (pascalCase.endsWith('s') && !pascalCase.endsWith('ss')) {
            pascalCase = pascalCase.slice(0, -1); // Users -> User, Orders -> Order
        }

        return pascalCase;
    }

    /**
     * UPDATE 라우트 설정 (PUT /:identifier, PATCH /:identifier) - JSON:API 준수
     */
    private setupUpdateRoute(
        client: any,
        modelName: string,
        options?: any,
        primaryKey: string = DEFAULT_PRIMARY_KEY,
        primaryKeyParser: (value: string) => any = parseStringImpl,
    ): void {
        const middlewares = options?.middleware?.update || [];

        const handler: HandlerFunction = async (req, res, _injected, _repo, _db) => {
            try {
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', JSON_API_CONTENT_TYPE);

                // 쿼리 파라미터 파싱 + include 정책 적용 (응답 included 지원)
                const queryParams = this.parseQueryWithIncludePolicy(req, res, modelName, options);
                if (!queryParams) return; // 에러 응답은 이미 헬퍼에서 전송됨

                // Content Negotiation 검증
                // if (!this.validateJsonApiContentType(req, res)) {
                //     return;
                // }

                // 파라미터 추출 검사
                const extractResult = this.extractAndParsePrimaryKey(
                    req,
                    res,
                    primaryKey,
                    primaryKeyParser,
                    modelName,
                );
                // 파라미터 추출 및 검증

                const { parsedIdentifier } = extractResult;

                // JSON:API 요청 형식 검증
                if (!req.body || !req.body.data) {
                    // 리소스 타입을 동적으로 결정
                    const routeResourceType =
                        req.baseUrl.split('/').filter(Boolean).pop() || modelName.toLowerCase();
                    const resourceType = options?.resourceType || routeResourceType;

                    const exampleRequest = {
                        data: {
                            type: resourceType,
                            id: String(parsedIdentifier),
                            attributes: {},
                        },
                    };

                    const errorDetail = `Request must contain a data object following JSON:API specification. Expected format: ${JSON.stringify(exampleRequest, null, 2)}`;
                    const errorResponse = this.formatJsonApiError(
                        new Error(errorDetail),
                        ERROR_CODES.INVALID_REQUEST,
                        400,
                        req.path,
                    );
                    return res.status(400).json(errorResponse);
                }

                const { data: requestData } = req.body;

                // 리소스 타입 검증 (라우트 경로에서 추출 또는 옵션 사용)
                const routeResourceType =
                    req.baseUrl.split('/').filter(Boolean).pop() || modelName.toLowerCase();
                const expectedType = options?.resourceType || routeResourceType;

                // JSON:API 리소스 구조 검증
                if (!this.validateJsonApiResource(requestData, expectedType, req, res, true)) {
                    return;
                }

                // attributes에서 데이터 추출
                let data = requestData.attributes || {};

                // 관계 데이터 처리 (relationships가 있는 경우)
                if (requestData.relationships) {
                    try {
                        data = await this.processRelationships(
                            data,
                            requestData.relationships,
                            client,
                            modelName,
                            true, // 업데이트 모드
                            options, // softDelete 옵션 전달
                            parsedIdentifier, // 부모 ID
                            primaryKey, // 부모 ID 필드명
                        );
                    } catch (relationshipError: any) {
                        const errorResponse = this.formatJsonApiError(
                            relationshipError,
                            ERROR_CODES.INVALID_RELATIONSHIP,
                            422,
                            req.path,
                        );
                        return res.status(422).json(errorResponse);
                    }
                }

                // 빈 값이나 null 값들 정리만 수행
                data = this.cleanEmptyValues(data);

                // Before hook 실행
                if (options?.hooks?.beforeUpdate) {
                    data = await options.hooks.beforeUpdate(data, req);
                }

                // include 옵션 빌드 (?include= 또는 defaultIncludes 적용 시)
                const updateIncludeOptions =
                    queryParams.include && queryParams.include.length > 0
                        ? PrismaQueryBuilder['buildIncludeOptions'](queryParams.include)
                        : undefined;

                const result = await client[modelName].update({
                    where: { [primaryKey]: parsedIdentifier },
                    data,
                    ...(updateIncludeOptions && { include: updateIncludeOptions }),
                });

                // After hook 실행
                if (options?.hooks?.afterUpdate) {
                    await options.hooks.afterUpdate(result, req);
                }

                const serializedResult = await applyCrudSerializers(
                    result,
                    options?.serialize,
                    options?.serializeIncludes,
                    req,
                    { primaryKey },
                );

                // JSON:API 단일 리소스 응답 조립 + 직렬화
                const serializedResponse = this.buildUpdateResponse(
                    serializedResult,
                    queryParams,
                    req,
                    modelName,
                    options,
                    primaryKey,
                );

                res.json(serializedResponse);
            } catch (error: any) {
                log.Error(`CRUD Update Error for ${modelName}:`, error);

                this.sendMappedCrudError(res, error, req);
            }
        };

        // PUT과 PATCH 모두 등록
        const routePath = `/:${primaryKey}`;
        const registerMethod = (method: 'put' | 'patch') => {
            if (options?.validation?.update) {
                const validationMiddlewares = CustomRequestHandler.withValidation(
                    options.validation.update,
                    handler,
                );

                if (middlewares.length > 0) {
                    this.ctx.router[method](routePath, ...middlewares, ...validationMiddlewares);
                } else {
                    this.ctx.router[method](routePath, ...validationMiddlewares);
                }
            } else {
                if (middlewares.length > 0) {
                    const wrappedMiddlewares = middlewares.map((mw: MiddlewareHandlerFunction) =>
                        this.ctx.wrapMiddleware(mw),
                    );
                    this.ctx.router[method](
                        routePath,
                        ...wrappedMiddlewares,
                        this.ctx.wrapHandler(handler),
                    );
                } else {
                    this.ctx.router[method](routePath, this.ctx.wrapHandler(handler));
                }
            }
        };

        registerMethod('put');
        registerMethod('patch');

        // 문서화 등록 (PUT/PATCH 동일) - JSON:API ref
        ['PUT', 'PATCH'].forEach((method) => {
            this.ctx.registerDocumentation(method, routePath, {
                summary: `Update ${modelName} by ${primaryKey} (JSON:API)`,
                parameters: {
                    params: {
                        [primaryKey]: {
                            type: 'string',
                            required: true,
                            description: `${modelName} ${primaryKey}`,
                        },
                    },
                    body: jsonApiBody(modelName, 'update'),
                },
                responses: {
                    200: jsonApiResponse(modelName, 200),
                    400: jsonApiErrorResponse(400),
                    404: jsonApiErrorResponse(404),
                    422: jsonApiErrorResponse(422),
                },
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
        primaryKey: string = DEFAULT_PRIMARY_KEY,
        primaryKeyParser: (value: string) => any = parseStringImpl,
    ): void {
        const middlewares = options?.middleware?.destroy || [];
        const isSoftDelete = options?.softDelete?.enabled;
        const softDeleteField = options?.softDelete?.field || DEFAULT_SOFT_DELETE_FIELD;

        const handler: HandlerFunction = async (req, res, _injected, _repo, _db) => {
            try {
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', JSON_API_CONTENT_TYPE);

                // Content Negotiation 검증 (DELETE 요청에 본문이 있는 경우)
                if (req.body && Object.keys(req.body).length > 0) {
                    // if (!this.validateJsonApiContentType(req, res)) {
                    //     return;
                    // }
                }

                // 파라미터 추출 및 파싱
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req,
                    res,
                    primaryKey,
                    primaryKeyParser,
                    modelName,
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
                        data: { [softDeleteField]: new Date() },
                    });

                    // After hook 실행
                    if (options?.hooks?.afterDestroy) {
                        await options.hooks.afterDestroy(parsedIdentifier, req);
                    }

                    // metadata 객체 생성 - 기존 헬퍼 함수 사용
                    const metadata = CrudResponseFormatter.createPaginationMeta(
                        [result], // 삭제된 단일 항목을 배열로 감싸서 전달
                        1, // total count??1
                        undefined, // page 파라미터 없음 (단일 삭제)
                        'soft_delete',
                        undefined, // includedRelations 없음
                        undefined, // includedRelations 없음
                    );

                    metadata.wasSoftDeleted = false; // 이전에는 삭제되지 않았음

                    // JSON:API 준수 - 성공적인 soft delete 응답 (200 OK with meta)
                    const response = {
                        jsonapi: {
                            version: JSON_API_VERSION,
                        },
                        meta: {
                            operation: 'soft_delete',
                            timestamp: metadata.timestamp,
                            [softDeleteField]: result[softDeleteField],
                        },
                        metadata,
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
                            ERROR_CODES.NOT_FOUND,
                            404,
                            req.path,
                        );
                        return res.status(404).json(errorResponse);
                    }

                    // Hard Delete: 완전 삭제
                    await client[modelName].delete({
                        where: { [primaryKey]: parsedIdentifier },
                    });

                    // After hook 실행
                    if (options?.hooks?.afterDestroy) {
                        await options.hooks.afterDestroy(parsedIdentifier, req);
                    }

                    // JSON:API 삭제 성공 응답 (204 No Content)
                    res.status(204).end();
                }
            } catch (error: any) {
                log.Error(`CRUD Destroy Error for ${modelName}:`, error);

                this.sendMappedCrudError(res, error, req);
            }
        };

        // 미들웨어 등록 - 동적 경로 사용
        const routePath = `/:${primaryKey}`;
        if (middlewares.length > 0) {
            const wrappedMiddlewares = middlewares.map((mw: MiddlewareHandlerFunction) =>
                this.ctx.wrapMiddleware(mw),
            );
            this.ctx.router.delete(routePath, ...wrappedMiddlewares, this.ctx.wrapHandler(handler));
        } else {
            this.ctx.router.delete(routePath, this.ctx.wrapHandler(handler));
        }

        // 문서화 등록 - JSON:API 형식
        const deleteDescription = isSoftDelete
            ? `Soft delete ${modelName} by ${primaryKey} (JSON:API)`
            : `Delete ${modelName} by ${primaryKey} (JSON:API)`;

        const deleteResponses: any = isSoftDelete
            ? {
                  200: {
                      type: 'object',
                      required: ['meta'],
                      properties: {
                          meta: { type: 'object' },
                      },
                  },
                  404: jsonApiErrorResponse(404),
              }
            : {
                  204: {
                      type: 'object',
                      description: 'Successfully deleted (no content)',
                  },
                  404: jsonApiErrorResponse(404),
              };

        this.ctx.registerDocumentation('DELETE', routePath, {
            summary: deleteDescription,
            parameters: {
                params: {
                    [primaryKey]: {
                        type: 'string',
                        required: true,
                        description: `${modelName} ${primaryKey}`,
                    },
                },
            },
            responses: deleteResponses,
        });
    }

    /**
     * RECOVER 라우트 설정 (POST /:identifier/recover) - JSON:API 준수
     */
    private setupRecoverRoute(
        client: any,
        modelName: string,
        options?: any,
        primaryKey: string = DEFAULT_PRIMARY_KEY,
        primaryKeyParser: (value: string) => any = parseStringImpl,
    ): void {
        const middlewares = options?.middleware?.recover || [];
        // P0-3: 형제 핸들러(index/destroy)와 동일하게 설정된 soft-delete 필드를 해석한다.
        // (과거 'deletedAt' 을 하드코딩하여 커스텀 softDelete.field 설정 시 복구가 깨졌다.)
        const softDeleteField = options?.softDelete?.field || DEFAULT_SOFT_DELETE_FIELD;

        const handler: HandlerFunction = async (req, res, _injected, _repo, _db) => {
            try {
                // JSON:API Content-Type 헤더 설정
                res.setHeader('Content-Type', JSON_API_CONTENT_TYPE);

                // 파라미터 추출 및 파싱
                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req,
                    res,
                    primaryKey,
                    primaryKeyParser,
                    modelName,
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
                        [softDeleteField]: { not: null }, // 소프트 삭제된 항목만 조회
                    },
                });

                if (!existingItem) {
                    // 이미 삭제되지 않은 복구할 상태
                    const activeItem = await client[modelName].findUnique({
                        where: { [primaryKey]: parsedIdentifier },
                    });

                    if (activeItem) {
                        const errorResponse = this.formatJsonApiError(
                            new Error(`${modelName} is already active (not deleted)`),
                            'CONFLICT',
                            409,
                            req.path,
                        );
                        return res.status(409).json(errorResponse);
                    } else {
                        const errorResponse = this.formatJsonApiError(
                            new Error(`${modelName} not found`),
                            ERROR_CODES.NOT_FOUND,
                            404,
                            req.path,
                        );
                        return res.status(404).json(errorResponse);
                    }
                }

                // 복구 실행 (soft-delete 필드를 null로 설정)
                const result = await client[modelName].update({
                    where: { [primaryKey]: parsedIdentifier },
                    data: { [softDeleteField]: null },
                });

                // After hook 실행
                if (options?.hooks?.afterRecover) {
                    await options.hooks.afterRecover(result, req);
                }

                const serializedResult = await applyCrudSerializers(
                    result,
                    options?.serialize,
                    options?.serializeIncludes,
                    req,
                    { primaryKey },
                );

                // metadata 객체 생성 - 기존 헬퍼 함수 사용
                const metadata = CrudResponseFormatter.createPaginationMeta(
                    [result], // 단일 항목을 배열로 감싸서 전달
                    1, // total count = 1
                    undefined, // page 파라미터 없음 (단일 복구)
                    'recover',
                    undefined, // includedRelations 없음
                    undefined, // includedRelations 없음
                );

                // recover 전용 필드 추가
                metadata.wasSoftDeleted = true;

                // JSON:API 응답 포맷
                const response = {
                    data: this.transformToJsonApiResource(serializedResult, modelName, req, primaryKey),
                    jsonapi: {
                        version: JSON_API_VERSION,
                    },
                    meta: {
                        operation: 'recover',
                        timestamp: metadata.timestamp,
                    },
                    metadata,
                };

                // BigInt와 DATE 타입 직렬화 처리
                const serializedResponse = serialize(response);

                res.json(serializedResponse);
            } catch (error: any) {
                log.Error(`CRUD Recover Error for ${modelName}:`, error);

                this.sendMappedCrudError(res, error, req);
            }
        };

        // Validation이 있는 경우
        const routePath = `/:${primaryKey}/recover`;
        if (options?.validation?.recover) {
            const validationMiddlewares = CustomRequestHandler.withValidation(
                options.validation.recover,
                handler,
            );

            if (middlewares.length > 0) {
                this.ctx.router.post(routePath, ...middlewares, ...validationMiddlewares);
            } else {
                this.ctx.router.post(routePath, ...validationMiddlewares);
            }
        } else {
            // 일반 핸들러
            if (middlewares.length > 0) {
                const wrappedMiddlewares = middlewares.map((mw: MiddlewareHandlerFunction) =>
                    this.ctx.wrapMiddleware(mw),
                );
                this.ctx.router.post(
                    routePath,
                    ...wrappedMiddlewares,
                    this.ctx.wrapHandler(handler),
                );
            } else {
                this.ctx.router.post(routePath, this.ctx.wrapHandler(handler));
            }
        }

        // 문서화 등록 - JSON:API ref
        this.ctx.registerDocumentation('POST', routePath, {
            summary: `Recover soft-deleted ${modelName} by ${primaryKey} (JSON:API)`,
            parameters: {
                params: {
                    [primaryKey]: {
                        type: 'string',
                        required: true,
                        description: `${modelName} ${primaryKey}`,
                    },
                },
                body: options?.validation?.recover?.body || undefined,
            },
            responses: {
                200: jsonApiResponse(modelName, 200),
                404: jsonApiErrorResponse(404),
                409: jsonApiErrorResponse(409),
            },
        });
    }

    /**
     * JSON:API 리소스 객체로 변환하는 헬퍼 메서드
     */
    private transformToJsonApiResource(
        item: any,
        modelName: string,
        req: any,
        primaryKey: string = DEFAULT_PRIMARY_KEY,
    ): any {
        const resourceType = modelName.toLowerCase();
        const baseUrl = this.buildBaseUrl(req);

        // Primary key 값 추출
        const id = item[primaryKey] || item.id || item.uuid || item._id || Object.values(item)[0];

        // attributes에서 primary key와 관계 필드 제외
        const attributes = { ...item };
        delete attributes[primaryKey];

        // primaryKey가 'id'가 아닌 경우, 기존 'id' 필드를 attributes에 유지
        // 다른 기본 ID 필드들은 제거 (중복 방지)
        if (primaryKey !== 'uuid') delete attributes.uuid;
        if (primaryKey !== '_id') delete attributes._id;

        // 관계 필드 분리
        const relationships: any = {};
        const resourceAttributes: any = {};

        Object.keys(attributes).forEach((key) => {
            const value = attributes[key];
            // 배열이거나 객체이면서 id를 가진 경우 관계로 처리
            if (Array.isArray(value) || (value && typeof value === 'object' && value.id)) {
                relationships[key] = {
                    links: {
                        self: `${baseUrl}/${id}/relationships/${key}`,
                        related: `${baseUrl}/${id}/${key}`,
                    },
                };

                // 관계 데이터가 포함된 경우
                if (Array.isArray(value)) {
                    relationships[key].data = value.map((relItem: any) => ({
                        type: key.slice(0, -1), // 복수형에서 단수형으로(간단한 변환)
                        id: relItem.id || relItem.uuid || relItem._id,
                    }));
                } else if (value.id) {
                    relationships[key].data = {
                        type: key,
                        id: value.id || value.uuid || value._id,
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
                self: `${baseUrl}/${id}`,
            },
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
        Object.keys(query).forEach((key) => {
            if (!key.startsWith('page[')) {
                const value = query[key];
                // 객체나 배열인 경우 JSON.stringify로 직렬화하거나 무시
                if (
                    typeof value === 'string' ||
                    typeof value === 'number' ||
                    typeof value === 'boolean'
                ) {
                    params.append(key, String(value));
                } else if (Array.isArray(value)) {
                    // 배열인 경우 각 요소를 개별적으로 추가
                    value.forEach((item) => {
                        if (
                            typeof item === 'string' ||
                            typeof item === 'number' ||
                            typeof item === 'boolean'
                        ) {
                            params.append(key, String(item));
                        }
                    });
                }
                // 객체??경우??무시 (page 객체 ??
            }
        });

        // 페이지네이션 파라미터 추가
        params.append('page[number]', String(page));
        params.append('page[size]', String(size));

        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * INDEX 라우트의 페이지네이션 파라미터 검증.
     * 페이지네이션 미지정/잘못된 파라미터/잘못된 page[size] 의 세 가지를 순서대로 검사하며,
     * 위반 시 기존과 동일한 400 JSON:API 에러를 전송하고 `true` 를 반환한다.
     * 호출자는 `true` 인 경우 그대로 `return` 하여 기존 early-return 제어 흐름을 보존한다.
     * (기존 setupIndexRoute 의 3개 인라인 검증 블록과 byte-identical)
     */
    private validateIndexPagination(req: any, res: any, queryParams: any): boolean {
        // 페이지네이션 방식 검증 - 반드시 지정되어야 함
        if (!queryParams.page) {
            const errorResponse = this.formatJsonApiError(
                new Error(
                    'Pagination is required. You must specify either page-based pagination (page[number] & page[size]) or cursor-based pagination (page[cursor] & page[size])',
                ),
                ERROR_CODES.PAGINATION_REQUIRED,
                400,
                req.path,
                req.method,
            );
            res.status(400).json(errorResponse);
            return true;
        }

        // 페이지네이션 파라미터 세부 검증
        if (!queryParams.page.number && !queryParams.page.cursor) {
            const errorResponse = this.formatJsonApiError(
                new Error(
                    'Invalid pagination parameters. Specify either page[number] for offset-based pagination or page[cursor] for cursor-based pagination',
                ),
                ERROR_CODES.INVALID_PAGINATION_PARAMS,
                400,
                req.path,
                req.method,
            );
            res.status(400).json(errorResponse);
            return true;
        }

        // 페이지 크기 검증
        if (!queryParams.page.size || queryParams.page.size <= 0) {
            const errorResponse = this.formatJsonApiError(
                new Error('page[size] parameter is required and must be greater than 0'),
                ERROR_CODES.INVALID_PAGE_SIZE,
                400,
                req.path,
                req.method,
            );
            res.status(400).json(errorResponse);
            return true;
        }

        return false;
    }

    /**
     * INDEX 라우트의 beforeIndex 훅 실행.
     * 훅이 없으면 전달받은 findManyOptions 를 그대로, 훅이 결과를 반환하면 그 결과를 담은 객체를 반환한다.
     * 훅 실행 중 에러가 발생하면 기존과 동일한 500 JSON:API 에러를 전송하고 `null` 을 반환한다.
     * 호출자는 `null` 인 경우 그대로 `return` 하여 기존 early-return 제어 흐름을 보존한다.
     * (기존 setupIndexRoute 의 beforeIndex 훅 블록과 byte-identical)
     */
    private async runBeforeIndexHook(
        findManyOptions: any,
        req: any,
        res: any,
        options: any,
    ): Promise<{ findManyOptions: any } | null> {
        if (options?.hooks?.beforeIndex) {
            try {
                const hookResult = await options.hooks.beforeIndex(findManyOptions, req);
                if (hookResult) {
                    findManyOptions = hookResult;
                }
            } catch (hookError) {
                const errorResponse = this.formatJsonApiError(
                    hookError instanceof Error ? hookError : new Error('Hook execution failed'),
                    ERROR_CODES.INTERNAL_SERVER_ERROR,
                    500,
                    req.path,
                    req.method,
                );
                res.status(500).json(errorResponse);
                return null;
            }
        }
        return { findManyOptions };
    }

    /**
     * INDEX 라우트의 Soft Delete where 필터 병합.
     * include_deleted=true 가 아니면 softDeleteField IS NULL 조건을 기존 where 와 AND 로 병합한다.
     * findManyOptions 를 제자리에서 변형(mutate)한 뒤 그대로 반환한다.
     * (기존 setupIndexRoute 의 soft delete 필터 블록과 byte-identical)
     */
    private applyIndexSoftDeleteFilter(
        findManyOptions: any,
        req: any,
        isSoftDelete: boolean,
        softDeleteField: string,
    ): any {
        if (isSoftDelete) {
            // include_deleted 쿼리 파라미터가 true가 아닌 경우 삭제된 것들 제외
            const includeDeleted = req.query.include_deleted === 'true';

            if (!includeDeleted) {
                // 기존 where 조건이 있는 경우 AND 조건으로 추가
                if (findManyOptions.where) {
                    findManyOptions.where = {
                        AND: [findManyOptions.where, { [softDeleteField]: null }],
                    };
                } else {
                    // where 조건이 없는 경우 새로 생성
                    findManyOptions.where = { [softDeleteField]: null };
                }
            }
        }
        return findManyOptions;
    }

    /**
     * INDEX 라우트의 JSON:API 응답 엔벨로프(included/links/meta/response/metadata) 조립 + 직렬화.
     * 조회 결과(items/total)를 받아 최종 직렬화된 응답 객체를 반환한다. 제어 흐름(early-return) 없음.
     * (기존 setupIndexRoute 의 응답 조립 블록과 byte-identical)
     */
    private buildIndexResponse(
        items: any[],
        total: number,
        queryParams: any,
        req: any,
        modelName: string,
        options: any,
        primaryKey: string,
    ): any {
        // Base URL 생성
        const baseUrl = this.buildBaseUrl(req);

        // 포함된 리소스 생성 (include 파라미터가 있는 경우)
        let included: JsonApiResource[] | undefined;
        if (queryParams.include && queryParams.include.length > 0 && !options?.includeMerge) {
            included = JsonApiTransformer.createIncludedResources(
                items,
                queryParams.include,
                queryParams.fields,
                baseUrl,
            );
        }

        // 페이지네이션 링크 생성
        let links: any;
        if (queryParams.page) {
            const pageSize = queryParams.page.size || DEFAULT_PAGE_SIZE;
            const currentPage = queryParams.page.number || 1;
            const totalPages = Math.ceil(total / pageSize);

            links = {
                self: this.buildPaginationUrl(baseUrl, req.query, currentPage, pageSize),
                first: this.buildPaginationUrl(baseUrl, req.query, 1, pageSize),
                last: this.buildPaginationUrl(baseUrl, req.query, totalPages, pageSize),
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
            total: total, // 전체 레코드 수(JSON:API에서 일반적으로 사용)
            count: items.length, // 현재 응답 레코드 수
        };

        // 페이지네이션이 설정된 경우에만 페이지 정보 추가
        if (queryParams.page) {
            const pageSize = queryParams.page.size || DEFAULT_PAGE_SIZE;
            const currentPage = queryParams.page.number || 1;
            const totalPages = Math.ceil(total / pageSize);

            meta.page = {
                current: currentPage,
                size: pageSize,
                total: totalPages, // 전체 페이지 수
            };
        }

        // Json 타입 필드 목록 가져오기
        const jsonFields = this.getJsonFieldSet(modelName);

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
                included,
                includeMerge: options?.includeMerge || false,
                jsonFields,
            },
        );

        // metadata 생성 - 기존 헬퍼 함수 사용
        const metadata = CrudResponseFormatter.createPaginationMeta(
            items,
            total,
            queryParams.page,
            'index',
            queryParams.include,
            queryParams,
        );

        // BigInt와 DATE 타입 직렬화 처리
        return serialize({ ...response, metadata });
    }

    /**
     * UPDATE 라우트의 단일 리소스 JSON:API 응답(included/response/metadata) 조립 + 직렬화.
     * 수정 결과(result)를 받아 최종 직렬화된 응답 객체를 반환한다. 제어 흐름(early-return) 없음.
     * (기존 setupUpdateRoute 의 응답 조립 블록과 byte-identical)
     */
    private buildUpdateResponse(
        result: any,
        queryParams: any,
        req: any,
        modelName: string,
        options: any,
        primaryKey: string,
    ): any {
        // Base URL 생성
        const baseUrl = this.buildBaseUrl(req);

        // 포함된 리소스 생성 (include 파라미터가 있는 경우)
        let updateIncluded: JsonApiResource[] | undefined;
        if (queryParams.include && queryParams.include.length > 0 && !options?.includeMerge) {
            updateIncluded = JsonApiTransformer.createIncludedResources(
                [result],
                queryParams.include,
                queryParams.fields,
                baseUrl,
            );
        }

        // Json 타입 필드 목록 가져오기
        const jsonFields = this.getJsonFieldSet(modelName);

        // JSON:API 응답 생성
        const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
            result,
            modelName,
            {
                primaryKey,
                fields: queryParams.fields,
                baseUrl,
                included: updateIncluded,
                includeMerge: options?.includeMerge || false,
                jsonFields,
            },
        );

        // metadata 객체 생성 - 기존 헬퍼 함수 사용
        const metadata = CrudResponseFormatter.createPaginationMeta(
            [result], // 단일 항목을 배열로 감싸서 전달
            1, // total count = 1
            undefined, // page 파라미터 없음 (단일 수정)
            'update',
            queryParams.include,
            queryParams,
        );

        // BigInt와 DATE 타입 직렬화 처리
        return serialize({ ...response, metadata });
    }

    /**
     * JSON:API 에러 형식으로 포맷하는 헬퍼 메서드 (통합 ErrorHandler 사용)
     */
    private formatJsonApiError(
        error: Error | unknown,
        code: string,
        status: number,
        path: string,
        method?: string,
    ): JsonApiErrorResponse {
        return ErrorHandler.handleError(error, {
            format: ErrorResponseFormat.JSON_API,
            context: {
                code,
                status,
                path,
                method: method || 'UNKNOWN',
                source: {
                    pointer: path,
                },
            },
            security: {
                isDevelopment: process.env.NODE_ENV === 'development',
                sanitizeDetails: process.env.NODE_ENV !== 'development',
                maxDetailLength: 500,
            },
        });
    }

    /**
     * 요청으로부터 JSON:API 응답에 사용할 base URL 을 생성한다.
     * (기존 인라인 `${req.protocol}://${req.get('host')}${req.baseUrl}` 표현식과 byte-identical)
     */
    private buildBaseUrl(req: any): string {
        return `${req.protocol}://${req.get('host')}${req.baseUrl}`;
    }

    /**
     * 주어진 리소스 타입의 Json 타입 필드 집합을 반환한다.
     * (기존 `getJsonFields(...) || []` → `new Set(...)` 2-라인과 byte-identical)
     */
    private getJsonFieldSet(typeName: string): Set<string> {
        const jsonFieldsArray = this.ctx.schemaAnalyzer?.getJsonFields(typeName) || [];
        return new Set(jsonFieldsArray);
    }

    /**
     * 핸들러 catch 블록의 공통 에러 응답 전송 로직.
     * Prisma 에러를 매핑하고 JSON:API 에러로 포맷한 뒤 동일 status 로 전송한다.
     * (기존 catch 블록의 mapPrismaError → formatJsonApiError → res.status().json() 3-라인과 byte-identical)
     */
    private sendMappedCrudError(res: any, error: any, req: any): void {
        const { code, status } = ErrorFormatter.mapPrismaError(error);
        const errorResponse = this.formatJsonApiError(error, code, status, req.path, req.method);
        res.status(status).json(errorResponse);
    }

    /**
     * relationship 변경 라우트(POST/PATCH/DELETE)의 Content-Type 검증.
     * Content-Type 이 존재하지만 JSON:API 타입을 포함하지 않으면 415 를 전송하고 `true` 를 반환한다.
     * 호출자는 `true` 인 경우 그대로 `return` 하여 기존 early-return 제어 흐름을 보존한다.
     * (기존 인라인 415 검증 블록과 byte-identical)
     */
    private rejectInvalidJsonApiContentType(req: any, res: any): boolean {
        const contentType = req.get('Content-Type');
        if (contentType && !contentType.includes(JSON_API_CONTENT_TYPE)) {
            const errorResponse = this.formatJsonApiError(
                new Error(`Content-Type must be ${JSON_API_CONTENT_TYPE}`),
                'INVALID_CONTENT_TYPE',
                415,
                req.path,
            );
            res.status(415).json(errorResponse);
            return true;
        }
        return false;
    }

    /**
     * 쿼리 파라미터를 파싱하고 include 정책(검증/기본값 병합)을 적용한다.
     * index/show/create/update 핸들러의 공통 진입 블록을 추출한 것으로 동작은 byte-identical.
     *
     * 성공 시 가공된 queryParams 를 반환한다.
     * 파싱/검증 실패 시 기존과 동일한 400 (또는 parseError.statusCode) JSON:API 에러를 즉시 전송하고
     * `null` 을 반환한다. 호출자는 `null` 인 경우 그대로 `return` 하여 기존 early-return 제어 흐름을 보존한다.
     */
    private parseQueryWithIncludePolicy(
        req: any,
        res: any,
        modelName: string,
        options?: any,
    ): any | null {
        try {
            const queryParams = CrudQueryParser.parseQuery(req, modelName, this.ctx.schemaAnalyzer);
            CrudQueryParser.validateIncludes(queryParams.include, {
                maxCount: options?.maxIncludeCount,
                maxDepth: options?.maxIncludeDepth,
                allowed: options?.allowedIncludes,
            });
            queryParams.include = CrudQueryParser.mergeDefaultIncludes(
                queryParams.include,
                options?.defaultIncludes,
            );
            return queryParams;
        } catch (parseError: any) {
            // UUID 검증 실패 등의 에러를 400으로 응답
            const errorResponse = this.formatJsonApiError(
                parseError,
                parseError.code || ERROR_CODES.VALIDATION_ERROR,
                parseError.statusCode || 400,
                req.path,
                req.method,
            );
            res.status(parseError.statusCode || 400).json(errorResponse);
            return null;
        }
    }

    /**
     * include 정책을 적용하지 않고 쿼리 파라미터만 파싱한다.
     * 관계 리소스 조회 라우트(?include= 를 소비하지 않는 라우트)의 공통 진입 블록을 추출한 것으로
     * 동작은 byte-identical.
     *
     * 성공 시 queryParams 를, 파싱 실패 시 기존과 동일한 400 JSON:API 에러를 전송하고 `null` 을 반환한다.
     * 호출자는 `null` 인 경우 그대로 `return` 하여 기존 early-return 제어 흐름을 보존한다.
     */
    private parseQueryOrSendError(req: any, res: any, modelName: string): any | null {
        try {
            return CrudQueryParser.parseQuery(req, modelName, this.ctx.schemaAnalyzer);
        } catch (parseError: any) {
            // UUID 검증 실패 등의 에러를 400으로 응답
            const errorResponse = this.formatJsonApiError(
                parseError,
                parseError.code || ERROR_CODES.VALIDATION_ERROR,
                parseError.statusCode || 400,
                req.path,
                req.method,
            );
            res.status(parseError.statusCode || 400).json(errorResponse);
            return null;
        }
    }

    /**
     * 빈 값들 정리 (undefined, 빈 객체, 빈 배열 등)
     */
    private cleanEmptyValues(data: any): any {
        const cleanedData = { ...data };

        Object.keys(cleanedData).forEach((key) => {
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
     * 요청에서 primary key 파라미터를 추출하고 파싱하는 헬퍼 메서드 - JSON:API 대응
     */
    private extractAndParsePrimaryKey(
        req: any,
        res: any,
        primaryKey: string,
        primaryKeyParser: (value: string) => any,
        _modelName: string,
    ): { success: boolean; parsedIdentifier?: any } {
        // 파라미터 추출
        let identifier: string;

        if (primaryKey !== DEFAULT_PRIMARY_KEY && req.params[primaryKey]) {
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
                    ERROR_CODES.VALIDATION_ERROR,
                    400,
                    req.path,
                );
                res.status(400).json(errorResponse);
                return { success: false };
            }
        }

        // 파라미터 유효성 검사
        if (!identifier || identifier.trim() === '') {
            const errorResponse = this.formatJsonApiError(
                new Error(`Invalid ${primaryKey} parameter`),
                ERROR_CODES.VALIDATION_ERROR,
                400,
                req.path,
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
            const errorResponse = this.formatJsonApiError(
                parseError,
                code,
                status,
                req.path,
                req.method,
            );
            res.status(status).json(errorResponse);
            return { success: false };
        }
    }

    /**
     * 관계 라우트 설정.
     * 관계 자체를 관리하는 라우트와 관련 리소스를 조회하는 라우트를 생성
     */
    private setupRelationshipRoutes(
        client: any,
        modelName: string,
        options?: any,
        primaryKey: string = DEFAULT_PRIMARY_KEY,
        primaryKeyParser: (value: string) => any = parseStringImpl,
    ): void {
        // 현재는 기본적인 관계 조회 라우트만 구현
        // 향후 확장 가능: POST, PATCH, DELETE for relationships

        // GET /:identifier/:relationName - 관??리소??직접 조회
        this.ctx.router.get(`/:${primaryKey}/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', JSON_API_CONTENT_TYPE);

                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req,
                    res,
                    primaryKey,
                    primaryKeyParser,
                    modelName,
                );
                if (!success) return;

                const relationName = req.params.relationName;

                // 쿼리 파라미터 파싱 (include, fields, sort, pagination 지원) (UUID 검증 등의 에러 발생 가능)
                // NOTE: 이 라우트는 클라이언트의 ?include= 를 소비하지 않으므로 include 정책 적용 생략.
                const queryParams = this.parseQueryOrSendError(req, res, modelName);
                if (!queryParams) return; // 에러 응답은 이미 헬퍼에서 전송됨

                // 기본 리소??조회
                const item = await client[modelName].findUnique({
                    where: { [primaryKey]: parsedIdentifier },
                    include: { [relationName]: true },
                });

                if (!item) {
                    const errorResponse = this.formatJsonApiError(
                        new Error(`${modelName} not found`),
                        ERROR_CODES.NOT_FOUND,
                        404,
                        req.path,
                    );
                    return res.status(404).json(errorResponse);
                }

                const relationData = item[relationName];

                if (!relationData) {
                    const errorResponse = this.formatJsonApiError(
                        new Error(`Relationship '${relationName}' not found`),
                        ERROR_CODES.RELATIONSHIP_NOT_FOUND,
                        404,
                        req.path,
                    );
                    return res.status(404).json(errorResponse);
                }

                // Base URL 생성
                const baseUrl = this.buildBaseUrl(req);

                // 관계 리소스 타입 추론 (실제 데이터 기반)
                const isArray = Array.isArray(relationData);
                const sampleData = isArray ? relationData[0] : relationData;
                const relationResourceType = JsonApiTransformer.inferResourceTypeFromData(
                    sampleData,
                    relationName,
                    isArray,
                );

                // Json 타입 필드 목록 가져오기 (관계 리소스 타입 기준)
                const jsonFields = this.getJsonFieldSet(relationResourceType);

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
                            related: `${baseUrl}/${modelName.toLowerCase()}/${parsedIdentifier}/relationships/${relationName}`,
                        },
                        jsonFields,
                    },
                );

                res.json(serialize(response));
            } catch (error: any) {
                log.Error(`Related Resource Error for ${modelName}:`, error);
                this.sendMappedCrudError(res, error, req);
            }
        });

        // GET /:identifier/relationships/:relationName - 관계 자체 조회
        this.ctx.router.get(`/:${primaryKey}/relationships/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', JSON_API_CONTENT_TYPE);

                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req,
                    res,
                    primaryKey,
                    primaryKeyParser,
                    modelName,
                );
                if (!success) return;

                const relationName = req.params.relationName;

                // 기본 리소??조회
                const item = await client[modelName].findUnique({
                    where: { [primaryKey]: parsedIdentifier },
                    include: { [relationName]: true },
                });

                if (!item) {
                    const errorResponse = this.formatJsonApiError(
                        new Error(`${modelName} not found`),
                        ERROR_CODES.NOT_FOUND,
                        404,
                        req.path,
                    );
                    return res.status(404).json(errorResponse);
                }

                const relationData = item[relationName];

                // 관계 데이터를 JSON:API 형식으로 변환
                let data = null;
                if (relationData) {
                    if (Array.isArray(relationData)) {
                        data = relationData.map((relItem) => ({
                            type: JsonApiTransformer.inferResourceTypeFromData(
                                relItem,
                                relationName,
                                true,
                            ),
                            id: String(relItem.id || relItem.uuid || relItem._id),
                        }));
                    } else {
                        data = {
                            type: JsonApiTransformer.inferResourceTypeFromData(
                                relationData,
                                relationName,
                                false,
                            ),
                            id: String(relationData.id || relationData.uuid || relationData._id),
                        };
                    }
                }

                const baseUrl = this.buildBaseUrl(req);
                const response = {
                    data,
                    links: {
                        self: `${baseUrl}/${modelName.toLowerCase()}/${parsedIdentifier}/relationships/${relationName}`,
                        related: `${baseUrl}/${modelName.toLowerCase()}/${parsedIdentifier}/${relationName}`,
                    },
                    jsonapi: {
                        version: JSON_API_VERSION,
                    },
                };

                res.json(serialize(response));
            } catch (error: any) {
                log.Error(`Relationship Error for ${modelName}:`, error);
                this.sendMappedCrudError(res, error, req);
            }
        });

        // POST /:identifier/relationships/:relationName - 관계 추가
        this.ctx.router.post(`/:${primaryKey}/relationships/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', JSON_API_CONTENT_TYPE);

                // Content-Type 검증
                if (this.rejectInvalidJsonApiContentType(req, res)) return;

                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req,
                    res,
                    primaryKey,
                    primaryKeyParser,
                    modelName,
                );
                if (!success) return;

                const relationName = req.params.relationName;

                if (!req.body || !req.body.data) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Request must contain data field with relationship identifiers'),
                        ERROR_CODES.INVALID_REQUEST,
                        400,
                        req.path,
                    );
                    return res.status(400).json(errorResponse);
                }

                const relationshipData = req.body.data;
                let connectData;

                if (Array.isArray(relationshipData)) {
                    connectData = {
                        [relationName]: {
                            connect: relationshipData.map((item: any) => ({ id: item.id })),
                        },
                    };
                } else {
                    connectData = { [relationName]: { connect: { id: relationshipData.id } } };
                }

                await client[modelName].update({
                    where: { [primaryKey]: parsedIdentifier },
                    data: connectData,
                });

                res.status(204).end();
            } catch (error: any) {
                log.Error(`Relationship Update Error for ${modelName}:`, error);
                this.sendMappedCrudError(res, error, req);
            }
        });

        // PATCH /:identifier/relationships/:relationName - 관계 완전 교체
        this.ctx.router.patch(`/:${primaryKey}/relationships/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', JSON_API_CONTENT_TYPE);

                // Content-Type 검증
                if (this.rejectInvalidJsonApiContentType(req, res)) return;

                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req,
                    res,
                    primaryKey,
                    primaryKeyParser,
                    modelName,
                );
                if (!success) return;

                const relationName = req.params.relationName;

                if (!req.body || req.body.data === undefined) {
                    const errorResponse = this.formatJsonApiError(
                        new Error('Request must contain data field'),
                        ERROR_CODES.INVALID_REQUEST,
                        400,
                        req.path,
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
                            set: relationshipData.map((item: any) => ({ id: item.id })),
                        },
                    };
                } else {
                    // 일대일 관계 교체
                    updateData = { [relationName]: { connect: { id: relationshipData.id } } };
                }

                await client[modelName].update({
                    where: { [primaryKey]: parsedIdentifier },
                    data: updateData,
                });

                res.status(204).end();
            } catch (error: any) {
                log.Error(`Relationship Replace Error for ${modelName}:`, error);
                this.sendMappedCrudError(res, error, req);
            }
        });

        // DELETE /:identifier/relationships/:relationName - 관계 제거
        this.ctx.router.delete(`/:${primaryKey}/relationships/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', JSON_API_CONTENT_TYPE);

                // Content-Type 검증
                if (this.rejectInvalidJsonApiContentType(req, res)) return;

                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req,
                    res,
                    primaryKey,
                    primaryKeyParser,
                    modelName,
                );
                if (!success) return;

                const relationName = req.params.relationName;

                if (!req.body || !req.body.data) {
                    const errorResponse = this.formatJsonApiError(
                        new Error(
                            'Request must contain data field with relationship identifiers to remove',
                        ),
                        ERROR_CODES.INVALID_REQUEST,
                        400,
                        req.path,
                    );
                    return res.status(400).json(errorResponse);
                }

                const relationshipData = req.body.data;
                let disconnectData;

                if (Array.isArray(relationshipData)) {
                    disconnectData = {
                        [relationName]: {
                            disconnect: relationshipData.map((item: any) => ({ id: item.id })),
                        },
                    };
                } else {
                    disconnectData = {
                        [relationName]: { disconnect: { id: relationshipData.id } },
                    };
                }

                await client[modelName].update({
                    where: { [primaryKey]: parsedIdentifier },
                    data: disconnectData,
                });

                res.status(204).end();
            } catch (error: any) {
                log.Error(`Relationship Delete Error for ${modelName}:`, error);
                this.sendMappedCrudError(res, error, req);
            }
        });

        // GET /:identifier/:relationName - 관??리소??조회
        this.ctx.router.get(`/:${primaryKey}/:relationName`, async (req, res) => {
            try {
                res.setHeader('Content-Type', JSON_API_CONTENT_TYPE);

                const { success, parsedIdentifier } = this.extractAndParsePrimaryKey(
                    req,
                    res,
                    primaryKey,
                    primaryKeyParser,
                    modelName,
                );
                if (!success) return;

                const relationName = req.params.relationName;

                // 쿼리 파라미터 파싱 (UUID 검증 등의 에러 발생 가능)
                // NOTE: 이 라우트는 클라이언트의 ?include= 를 소비하지 않으므로 include 정책 적용 생략.
                const queryParams = this.parseQueryOrSendError(req, res, modelName);
                if (!queryParams) return; // 에러 응답은 이미 헬퍼에서 전송됨

                // 기본 리소??조회
                const item = await client[modelName].findUnique({
                    where: { [primaryKey]: parsedIdentifier },
                    include: { [relationName]: true },
                });

                if (!item) {
                    const errorResponse = this.formatJsonApiError(
                        new Error(`${modelName} not found`),
                        ERROR_CODES.NOT_FOUND,
                        404,
                        req.path,
                    );
                    return res.status(404).json(errorResponse);
                }

                const relationData = item[relationName];

                if (!relationData) {
                    // 관계가 없는 경우 빈 데이터 반환
                    const response = {
                        data: Array.isArray(relationData) ? [] : null,
                        jsonapi: {
                            version: JSON_API_VERSION,
                        },
                    };
                    return res.json(response);
                }

                // Base URL 생성
                const baseUrl = this.buildBaseUrl(req);
                const isArrayRelation = Array.isArray(relationData);
                const sampleRelationData = isArrayRelation ? relationData[0] : relationData;
                const resourceType = JsonApiTransformer.inferResourceTypeFromData(
                    sampleRelationData,
                    relationName,
                    isArrayRelation,
                );

                // Json 타입 필드 목록 가져오기 (관계 리소스 타입 기준)
                const jsonFields = this.getJsonFieldSet(resourceType);

                // JSON:API 응답 생성
                const response: JsonApiResponse = JsonApiTransformer.createJsonApiResponse(
                    relationData,
                    resourceType,
                    {
                        primaryKey: 'id', // 관련 리소스는 기본적으로 id 사용
                        fields: queryParams.fields,
                        baseUrl,
                        jsonFields,
                    },
                );

                res.json(serialize(response));
            } catch (error: any) {
                log.Error(`Related Resource Error for ${modelName}:`, error);
                this.sendMappedCrudError(res, error, req);
            }
        });
    }
}
