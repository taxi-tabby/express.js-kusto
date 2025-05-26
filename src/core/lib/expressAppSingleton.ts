import express, { Express } from 'express';
import http from 'http';
import { log } from '../external/winston';

/**
 * @deprecated Use Core class instead. This is kept for backward compatibility.
 * 
 * Express Application Singleton
 * This class is now a simple wrapper around Express for legacy support.
 * 
 * @example
 * ```typescript
 * // Legacy usage (deprecated)
 * import expressApp from './expressAppSingleton';
 * const app = expressApp.getApp();
 * 
 * // New recommended usage
 * import { Core, Application } from '../Core';
 * const app = new Application();
 * ```
 */
class AppSingleton {
    private static instance: AppSingleton;

    public app: Express;
    private server?: http.Server;

    private constructor() {
        this.app = express();
        this.app.set('trust proxy', 1);
        
        log.Warn('ExpressAppSingleton is deprecated. Please use Core.Application class instead.');
    }

    public static getInstance(): AppSingleton {
        if (!AppSingleton.instance) {
            AppSingleton.instance = new AppSingleton();
        }
        return AppSingleton.instance;
    }

    public getApp(): Express {
        return this.app;
    }

    public getServer(): http.Server {
        if (!this.server) {
            throw new Error('Server is not started yet. Call start() first.');
        }
        return this.server;
    }

    /**
     * Start the server
     * @deprecated Use Application.start() instead
     */
    public start(port: number, host: string = '0.0.0.0'): Promise<http.Server> {
        return new Promise((resolve, reject) => {
            if (this.server) {
                log.Warn('Server is already running');
                resolve(this.server);
                return;
            }

            this.server = this.app.listen(port, host, () => {
                log.Info(`🚀 Server started on ${host}:${port}`, {
                    port,
                    host,
                    deprecated: true
                });
                resolve(this.server!);
            });

            this.server.on('error', (error) => {
                log.Error('Server failed to start', { error, port, host });
                reject(error);
            });
        });
    }

    /**
     * Stop the server gracefully
     * @deprecated Use Application.stop() instead
     */
    public stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.server) {
                log.Info('Server is not running');
                resolve();
                return;
            }

            this.server.close(() => {
                log.Info('🛑 Server stopped gracefully');
                this.server = undefined;
                resolve();
            });
        });
    }

    /**
     * Check if server is running
     */
    public get isRunning(): boolean {
        return !!this.server;
    }
}

const instance = AppSingleton.getInstance();

export default instance;