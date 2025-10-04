import { Express } from 'express';
import express from 'express';
import { Server } from 'http';
import { config } from 'dotenv';
import * as path from 'path';
import { log } from './external/winston';
import { getElapsedTimeInString } from './external/util';
import loadRoutes from './lib/loadRoutes_V6_Clean';
import expressApp from './lib/expressAppSingleton';
import { DocumentationGenerator } from './lib/documentationGenerator';
import { StaticFileMiddleware } from './lib/staticFileMiddleware';
import { prismaManager } from './lib/prismaManager';
import { DependencyInjector } from './lib/dependencyInjector';
import { repositoryManager } from './lib/repositoryManager';
import { SchemaApiSetup } from '@core/lib/schemaApiSetup';

export interface CoreConfig {
    basePath?: string;
    routesPath?: string;
    viewsPath?: string;
    viewEngine?: string;
    port?: number;
    host?: string;
    trustProxy?: boolean;
}

export class Core {
    private static instance: Core;
    private _app: Express;
    private _server?: Server;
    private _config: Required<CoreConfig>;
    private _isInitialized = false;

    private constructor() {
        // Load environment variables first
        config();
        
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
        return {
            basePath,
            routesPath: `${basePath}/routes`,
            viewsPath: `${basePath}/views`,
            viewEngine: 'ejs',
            port: parseInt(process.env.PORT || '3000'),
            host: process.env.HOST || '0.0.0.0',
            trustProxy: process.env.TRUST_PROXY === 'true' || true
        };
    }    
    
    
    /**
     * Initialize the core with custom configuration
     */
    public async initialize(customConfig?: Partial<CoreConfig>): Promise<Core> {
        if (this._isInitialized) {
            if (process.env.NODE_ENV === 'development') {
                log.Warn('Core is already initialized');
            }
            return this;
        }

        // Merge custom config with defaults
        if (customConfig) {
            this._config = { ...this._config, ...customConfig };
        }              // Initialize PrismaManager before setting up routes
        await this.initializePrismaManager();
        
        // Initialize Repository Manager
        await this.initializeRepositoryManager();
        
        // Initialize Dependency Injector
        await this.initializeDependencyInjector();


        
        this.setupExpress();
        // this.setupDbConnectionMiddleware(); // DB 연결 미들웨어 설정
        this.setupDocumentationRoutes(); // 문서화 라우트를 먼저 등록
        this.loadRoutes();
        this.setupViews();

        // 스키마 API 등록 (개발 모드에서만)
        try {
            SchemaApiSetup.registerSchemaApi(this._app, '/api/schema');
        } catch (error) {
            if (process.env.NODE_ENV === 'development') {
                log.Warn('스키마 API 등록 중 오류 발생:', error);
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

    /**
     * Setup database connection middleware for serverless environments
     * 서버리스 환경에서는 헬스체크 대신 on-demand 재연결 방식 사용
     */
    // private setupDbConnectionMiddleware(): void {
    //     try {
    //         // 서버리스 환경에서는 미들웨어 헬스체크를 사용하지 않음
    //         // 대신 PrismaManager에서 요청 시점에 연결 실패 시 재연결 처리
    //         log.Info('� Serverless-optimized DB connection: on-demand reconnection enabled');
    //         log.Info('✅ Database connection configured for serverless environment');
            
    //     } catch (error) {
    //         log.Error('❌ Failed to setup database connection middleware:', error);
    //         // Don't throw error - continue without middleware
    //     }
    // }

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
        
        
        // 테스트 리포트 HTML 페이지
        this._app.get('/docs/test-report', async (req, res) => {
            try {
                const testReport = await DocumentationGenerator.generateTestReport();
                res.type('html').send(testReport);
            } catch (error) {
                log.Error('Failed to generate test report', { error });
                res.status(500).json({ error: 'Failed to generate test report' });
            }
        });

        // 테스트 케이스 JSON
        this._app.get('/docs/test-cases.json', (req, res) => {
            try {
                const testCases = DocumentationGenerator.generateTestCasesJSON();
                res.json(testCases);
            } catch (error) {
                log.Error('Failed to generate test cases JSON', { error });
                res.status(500).json({ error: 'Failed to generate test cases' });
            }
        });

        // Postman Collection JSON
        this._app.get('/docs/postman-collection.json', (req, res) => {
            try {
                const postmanCollection = DocumentationGenerator.generatePostmanCollection();
                res.json(postmanCollection);
            } catch (error) {
                log.Error('Failed to generate Postman collection', { error });
                res.status(500).json({ error: 'Failed to generate Postman collection' });
            }
        });

        log.Info('📚 Documentation routes enabled at /docs');
    }

    /**
     * Start the server
     */
    public start(port?: number, host?: string): Promise<Server> {
        return new Promise((resolve, reject) => {
            if (this._server) {
                log.Warn('Server is already running');
                resolve(this._server);
                return;
            }

            if (!this._isInitialized) {
                this.initialize();
            }

            const serverPort = port || this._config.port;
            const serverHost = host || this._config.host;

            this._server = this._app.listen(serverPort, serverHost, () => {
                log.Info(`🚀 Server started successfully`, {
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
    }    /**
     * Stop the server gracefully
     */
    public async stop(): Promise<void> {
        return new Promise(async (resolve) => {
            if (!this._server) {
                log.Info('Server is not running');
                resolve();
                return;
            }

            // Disconnect all Prisma clients first
            try {
                log.Info('🗄️ Disconnecting Prisma Manager...');
                await prismaManager.disconnectAll();
                log.Info('Prisma Manager disconnected successfully');
            } catch (error) {
                log.Error('Error disconnecting Prisma Manager', { error });
            }

            this._server.close(() => {
                log.Info('🛑 Server stopped gracefully');
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
            log.Info('🗄️ Initializing Prisma Manager...');
            await prismaManager.initialize();
            
            const status = prismaManager.getStatus();
            log.Info('Prisma Manager initialization complete', {
                initialized: status.initialized,
                connectedDatabases: status.connectedDatabases,
                totalDatabases: status.totalDatabases,
                databases: status.databases
            });

            // Log each database connection status
            status.databases.forEach(db => {
                if (db.connected) {
                    log.Info(`✅ Database '${db.name}' connected successfully`);
                } else if (!db.generated) {
                    log.Warn(`⚠️ Database '${db.name}' skipped - Prisma client not generated`);
                } else {
                    log.Error(`❌ Database '${db.name}' failed to connect`);
                }
            });        } catch (error) {
            log.Error('Failed to initialize Prisma Manager', { error });
            // Don't throw error here to allow application to continue without database
            log.Warn('Application will continue without database connections');
        }
    }    /**
     * Initialize Repository Manager to handle repository loading and management
     */
    private async initializeRepositoryManager(): Promise<void> {
        try {
            log.Info('📦 Initializing Repository Manager...');
            await repositoryManager.initialize();
            
            const status = repositoryManager.getStatus();
            log.Info('Repository Manager initialization complete', {
                initialized: status.initialized,
                repositoryCount: status.repositoryCount,
                repositories: status.repositories
            });

            // Log each repository loading status
            status.repositories.forEach(repoName => {
                log.Info(`✅ Repository '${repoName}' loaded successfully`);
            });
        } catch (error) {
            log.Error('Failed to initialize Repository Manager', { error });
            // Don't throw error here to allow application to continue without repositories
            log.Warn('Application will continue without repository management');
        }
    }

    /**
     * Initialize Dependency Injector to load injectable modules
     */
    private async initializeDependencyInjector(): Promise<void> {
        try {
            log.Info('💉 Initializing Dependency Injector...');
            await DependencyInjector.getInstance().initialize();
            log.Info('Dependency Injector initialization complete');
        } catch (error) {
            log.Error('Failed to initialize Dependency Injector', { error });
            // Don't throw error here to allow application to continue without DI
            log.Warn('Application will continue without dependency injection');
        }
    }
}

// Export singleton instance
export default Core.getInstance();
