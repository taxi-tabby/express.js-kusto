import { Express } from 'express';
import { Server } from 'http';
import { config } from 'dotenv';
import { log } from './external/winston';
import { getElapsedTimeInString } from './external/util';
import loadRoutes from './lib/loadRoutes_V6_Clean';
import expressApp from './lib/expressAppSingleton';

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
    public initialize(customConfig?: Partial<CoreConfig>): Core {
        if (this._isInitialized) {
            log.Warn('Core is already initialized');
            return this;
        }

        // Merge custom config with defaults
        if (customConfig) {
            this._config = { ...this._config, ...customConfig };
        }

        this.setupExpress();
        this.loadRoutes();
        this.setupViews();

        this._isInitialized = true;
        log.Info('Core initialized successfully', { config: this._config });
        
        return this;
    }

    private setupExpress(): void {
        // Set trust proxy
        this._app.set('trust proxy', this._config.trustProxy ? 1 : 0);
        
        log.Debug('Express app configured');
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
    }

    /**
     * Stop the server gracefully
     */
    public stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this._server) {
                log.Info('Server is not running');
                resolve();
                return;
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
}

// Export singleton instance
export default Core.getInstance();
