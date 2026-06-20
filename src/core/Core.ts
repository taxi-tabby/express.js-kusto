import { Express } from 'express';
import express from 'express';
import { Server } from 'http';
import * as path from 'path';
import { log } from '@ext/winston';
import { getElapsedTimeInString } from '@ext/util';
import loadRoutes from './lib/loadRoutes_V6_Clean';
import expressApp from './lib/expressAppSingleton';
import { DocumentationGenerator } from './lib/documentationGenerator';
import { StaticFileMiddleware } from './lib/staticFileMiddleware';
import { prismaManager } from './lib/prismaManager';
import { DependencyInjector } from './lib/dependencyInjector';
import { repositoryManager } from './lib/repositoryManager';
import { SchemaApiSetup } from '@lib/schemaApiSetup';

export interface CoreConfig {
    basePath?: string;
    routesPath?: string;
    viewsPath?: string;
    viewEngine?: string;
    port?: number;
    host?: string;
    trustProxy?: boolean;
}

/**
 * 서버 바인딩 기본값(port/host)을 `process.env` 에서 해석한다.
 *
 * 부트스트랩 설정 중복 제거: 이전에는 동일한 fallback('3000'/'0.0.0.0')이
 * `Core.getDefaultConfig()` 와 `src/index.ts` 양쪽에 각각 하드코딩되어 있었다.
 * 이 함수가 단일 출처가 되어 양쪽에서 호출된다.
 *
 * 주의: 호출 시점의 `process.env` 를 그대로 읽으므로, 호출 타이밍별 결과는
 * 기존 코드와 동일하다(index.ts 는 .env 로드 이후, Core 기본값은 로드 이전).
 */
export function resolveServerDefaults(): { port: number; host: string } {
    return {
        port: parseInt(process.env.PORT || '3000'),
        host: process.env.HOST || '0.0.0.0'
    };
}

export class Core {
    private static instance: Core;
    private _app: Express;
    private _server?: Server;
    private _config: Required<CoreConfig>;
    private _isInitialized = false;
    // P0-1: DB 연결 실패는 서버리스 lazy-reconnect 를 위해 부팅을 막지 않되(non-fatal),
    // degraded 상태로 기록하여 /healthz 와 health status 가 정직하게 노출하도록 한다.
    private _degraded: { prisma?: string } = {};

    private constructor() {
        this._app = expressApp.getApp();
        this._config = this.getDefaultConfig();
    }

    public static getInstance(): Core {
        if (!Core.instance) {
            Core.instance = new Core();
        }
        return Core.instance;
    }

    private getDefaultConfig(): Required<CoreConfig> {
        const basePath = process.env.CORE_APP_BASEPATH || './app';
        const { port, host } = resolveServerDefaults();
        return {
            basePath,
            routesPath: `${basePath}/routes`,
            viewsPath: `${basePath}/views`,
            viewEngine: 'ejs',
            port,
            host,
            trustProxy: process.env.TRUST_PROXY === 'true'
        };
    }
    
    
    /**
     * Initialize the core with custom configuration
     */
    public async initialize(customConfig?: Partial<CoreConfig>): Promise<Core> {
        if (this._isInitialized) {
            if (process.env.NODE_ENV === 'development') {
                log.Debug('Core is already initialized');
            }
            return this;
        }

        // Merge custom config with defaults
        if (customConfig) {
            this._config = { ...this._config, ...customConfig };
        }

        // 재초기화 시 이전 degraded 사유가 남지 않도록 초기화
        this._degraded = {};

        // Initialize PrismaManager before setting up routes
        await this.initializePrismaManager();
        
        // Initialize Repository Manager
        await this.initializeRepositoryManager();
        
        // Initialize Dependency Injector
        await this.initializeDependencyInjector();


        
        this.setupExpress();
        this.setupHealthCheck(); // /healthz readiness (글로벌 라우트보다 먼저)
        this.setupDocumentationRoutes(); // 문서화 라우트를 먼저 등록
        this.loadRoutes();
        this.setupViews();

        // 스키마 API 등록 (개발 모드에서만)
        try {
            SchemaApiSetup.registerSchemaApi(this._app, '/api/schema');
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                log.Warn('Error while registering Schema API:', error);
            }
        }


        this._isInitialized = true;
        if (process.env.NODE_ENV === 'development') {
            log.Info('Core initialized successfully', { config: this._config });
        }
        
        return this;
    }    
      private setupExpress(): void {
        // Set trust proxy
        this._app.set('trust proxy', this._config.trustProxy ? 1 : 0);
        
        // JSON parsing middleware is handled by global middleware.ts
        // No need to add express.json() here as it's already in src/app/routes/middleware.ts
        
        // Serve static files from public directory
        // In webpack build environment, use dist/public, otherwise use public
        const publicPath = process.env.WEBPACK_BUILD === 'true' 
            ? path.join(__dirname, 'public')  // dist/public in build environment
            : path.join(process.cwd(), 'public');  // public in development
        this._app.use(express.static(publicPath));
        
        // Serve development static files when AUTO_DOCS=true
        this._app.use(StaticFileMiddleware.serveStaticFiles());
        
        if (process.env.NODE_ENV === 'development') {
            log.Debug('Express app configured', { 
                trustProxy: this._config.trustProxy,
                staticPath: publicPath
            });
        }
    }

    private loadRoutes(): void {
        const startTime = process.hrtime();
        
        try {
            loadRoutes(this._app, this._config.routesPath);
            const elapsed = process.hrtime(startTime);
            log.Route(`Routes loaded successfully: ${getElapsedTimeInString(elapsed)}`);
        } catch (error) {
            log.Error('Failed to load routes', { error, routesPath: this._config.routesPath });
            throw error;
        }
    }    
    
    private setupViews(): void {
        this._app.set('view engine', this._config.viewEngine);
        this._app.set('views', this._config.viewsPath);
        
        log.Debug('Views configured', { 
            engine: this._config.viewEngine, 
            path: this._config.viewsPath 
        });
    }

    private setupDocumentationRoutes(): void {
        // 환경 변수 체크: development 모드이고 AUTO_DOCS가 true일 때만 활성화
        const isDevelopment = process.env.NODE_ENV !== 'production';
        const autoDocsEnabled = process.env.AUTO_DOCS === 'true';
        
        if (!isDevelopment || !autoDocsEnabled) {
            log.Debug('Documentation routes disabled', { 
                isDevelopment, 
                autoDocsEnabled 
            });
            return;
        }        
        
        
        // HTML 문서 페이지
        this._app.get('/docs', (req, res) => {
            try {
                const html = DocumentationGenerator.generateHTMLDocumentation();
                res.type('html').send(html);
            } catch (error) {
                log.Error('Failed to generate documentation HTML', { error });
                res.status(500).json({ error: 'Failed to generate documentation' });
            }
        });

        // OpenAPI JSON 스펙
        this._app.get('/docs/openapi.json', (req, res) => {
            try {
                const spec = DocumentationGenerator.generateOpenAPISpec();
                res.json(spec);
            } catch (error) {
                log.Error('Failed to generate OpenAPI spec', { error });
                res.status(500).json({ error: 'Failed to generate OpenAPI specification' });
            }
        });        
        
        // 개발 정보 페이지
        this._app.get('/docs/dev', (req, res) => {
            try {
                const devInfo = DocumentationGenerator.generateDevInfoPage();
                res.type('html').send(devInfo);
            } catch (error) {
                log.Error('Failed to generate dev info', { error });
                res.status(500).json({ error: 'Failed to generate development info' });
            }
        });        


        log.Debug('Documentation routes enabled at /docs');
    }

    /**
     * Start the server
     */
    public async start(port?: number, host?: string): Promise<Server> {
        if (this._server) {
            log.Debug('Server is already running');
            return this._server;
        }

        // 초기화 없이 직접 start 가 호출되면, listen 전에 반드시 초기화를 끝낸다.
        // (await 없이 진행하면 라우트/healthz 등록 전에 서버가 listen 하는 race 가 생긴다.)
        if (!this._isInitialized) {
            await this.initialize();
        }

        const serverPort = port || this._config.port;
        const serverHost = host || this._config.host;

        return new Promise<Server>((resolve, reject) => {
            this._server = this._app.listen(serverPort, serverHost, () => {
                log.Info('Server started successfully', {
                    port: serverPort,
                    host: serverHost,
                    environment: process.env.NODE_ENV || 'development'
                });
                resolve(this._server!);
            });

            this._server.on('error', (error) => {
                log.Error('Server failed to start', { error, port: serverPort, host: serverHost });
                reject(error);
            });
        });
    }

    /**
     * Stop the server gracefully
     */
    public async stop(): Promise<void> {
        if (!this._server) {
            log.Debug('Server is not running');
            return;
        }

        // Disconnect all Prisma clients first
        try {
            log.Debug('Disconnecting Prisma Manager...');
            await prismaManager.disconnectAll();
            log.Debug('Prisma Manager disconnected successfully');
        } catch (error) {
            log.Error('Error disconnecting Prisma Manager', { error });
        }

        return new Promise((resolve) => {
            this._server!.close(() => {
                log.Info('Server stopped gracefully');
                this._server = undefined;
                resolve();
            });
        });
    }

    /**
     * Restart the server
     */
    public async restart(port?: number, host?: string): Promise<Server> {
        await this.stop();
        return this.start(port, host);
    }

    /**
     * Get the Express app instance
     */
    public get app(): Express {
        return this._app;
    }

    /**
     * Get the HTTP server instance
     */
    public get server(): Server | undefined {
        return this._server;
    }

    /**
     * Get current configuration
     */
    public get config(): Required<CoreConfig> {
        return { ...this._config };
    }

    /**
     * Check if core is initialized
     */
    public get isInitialized(): boolean {
        return this._isInitialized;
    }

    /**
     * Check if server is running
     */
    public get isRunning(): boolean {
        return !!this._server;
    }

    /**
     * Initialize PrismaManager to handle multiple database connections
     */
    private async initializePrismaManager(): Promise<void> {
        try {
            log.Debug('Initializing Prisma Manager...');
            await prismaManager.initialize();
            
            const status = prismaManager.getStatus();
            log.Info('Prisma Manager initialization complete', {
                initialized: status.initialized,
                connectedDatabases: status.connectedDatabases,
                totalDatabases: status.totalDatabases,
                databases: status.databases
            });

        } catch (error) {
            // P0-1: DB 연결 실패는 의도적으로 non-fatal 이다 (서버리스 lazy-reconnect 전제).
            // 단, 부팅을 green 으로 위장하지 않도록 degraded 상태로 기록한다 → /healthz 503.
            const message = error instanceof Error ? error.message : String(error);
            this._degraded.prisma = message;
            log.Error('Failed to initialize Prisma Manager', { error });
            log.Warn('Application will continue in DEGRADED mode (no database connections)');
        }
    }

    /**
     * Initialize Repository Manager to handle repository loading and management
     */
    private async initializeRepositoryManager(): Promise<void> {
        try {
            log.Debug('Initializing Repository Manager...');
            await repositoryManager.initialize();
            
            const status = repositoryManager.getStatus();
            log.Info('Repository Manager initialization complete', {
                initialized: status.initialized,
                repositoryCount: status.repositoryCount,
                repositories: status.repositories
            });
        } catch (error) {
            // P0-1: Repository 매니저는 개별 repo 로드 실패를 내부 루프에서 이미 흡수한다.
            // 여기까지 올라온 top-level throw 는 레지스트리/코드 구조 결함이므로,
            // 부팅을 green 으로 위장하지 말고 fail-fast 한다 (요청 시점 500 대신 명확한 부팅 실패).
            log.Error('Failed to initialize Repository Manager — aborting startup', { error });
            throw error;
        }
    }

    /**
     * Initialize Dependency Injector to load injectable modules
     */
    private async initializeDependencyInjector(): Promise<void> {
        try {
            log.Debug('Initializing Dependency Injector...');
            await DependencyInjector.getInstance().initialize();
            log.Info('Dependency Injector initialization complete');
        } catch (error) {
            // P0-1: DI 컨테이너도 개별 모듈 로드 실패를 내부 루프에서 흡수한다.
            // top-level throw 는 구조 결함이므로 fail-fast 한다.
            log.Error('Failed to initialize Dependency Injector — aborting startup', { error });
            throw error;
        }
    }

    /**
     * 애플리케이션 readiness 상태를 계산한다 (P0-1).
     *
     * Repo/DI 초기화 실패는 부팅을 중단시키므로, 서버가 listen 중이라면 그 둘은 정상이다.
     * 따라서 degraded 여부는 DB 연결 상태(서버리스에서 의도적으로 tolerate 됨)에 달려 있다.
     *
     * 주의:
     * - 미생성(isGenerated=false) DB 폴더는 readiness 대상에서 제외한다 — 그렇지 않으면
     *   client 를 아직 generate 하지 않은 폴더 때문에 /healthz 가 영구 degraded 가 된다.
     * - 설정된 생성 DB 가 0개면(total=0) healthy 로 본다(DB 를 쓰지 않는 앱).
     * - prismaManager 는 개별 DB 연결 실패를 내부에서 흡수하므로, degraded 사유는
     *   주로 getStatus().databases 의 미연결 목록에서 도출한다(_degraded.prisma 는
     *   prismaManager.initialize() 전체가 throw 한 드문 경우에만 채워진다).
     */
    public getReadiness(): {
        ready: boolean;
        status: 'healthy' | 'degraded';
        prisma: { connected: number; total: number; unconnected: string[]; error?: string };
    } {
        const prismaStatus = prismaManager.getStatus();
        const generated = (prismaStatus.databases ?? []).filter(d => d.generated);
        const total = generated.length;
        const connected = generated.filter(d => d.connected).length;
        const unconnected = generated.filter(d => !d.connected).map(d => d.name);
        const dbDegraded = !!this._degraded.prisma || unconnected.length > 0;

        return {
            ready: !dbDegraded,
            status: dbDegraded ? 'degraded' : 'healthy',
            prisma: {
                connected,
                total,
                unconnected,
                error: this._degraded.prisma
                    ?? (unconnected.length ? `unconnected databases: ${unconnected.join(', ')}` : undefined),
            },
        };
    }

    /**
     * /healthz readiness 엔드포인트 등록 (P0-1).
     * 완전 정상일 때만 200, degraded 면 503 을 반환하여
     * 오케스트레이터(k8s/LB/서버리스 워머)가 트래픽을 게이팅할 수 있게 한다.
     * 글로벌 라우트 미들웨어(DB 의존)보다 먼저, 직접 app 에 등록한다.
     */
    private setupHealthCheck(): void {
        this._app.get('/healthz', (_req, res) => {
            const readiness = this.getReadiness();
            res.status(readiness.ready ? 200 : 503).json({
                status: readiness.ready ? 'ok' : 'degraded',
                ready: readiness.ready,
                prisma: readiness.prisma,
            });
        });
    }
}

// Export singleton instance
export default Core.getInstance();
