import { Express } from 'express';
import { Server } from 'http';
import { Core, CoreConfig } from '@core/bootstrap/Core';
import { log } from '@ext/winston';

/**
 * Application class - Simple and intuitive interface for the core functionality
 *
 * @example
 * ```typescript
 * import { Application } from '@core/core';
 *
 * const app = new Application({
 *   port: 3000,
 *   routesPath: './app/routes'
 * });
 *
 * app.start();
 * ```
 */
export class Application {
    private core: Core;
    private config: Partial<CoreConfig>;

    constructor(config?: Partial<CoreConfig>) {
        this.core = Core.getInstance();
        this.config = config || {};
    }

    /**
     * Initialize and start the application
     */
    public async start(): Promise<Server> {
        try {
            log.Info('Starting application...');

            // Initialize core with configuration (now async)
            await this.core.initialize(this.config);

            // Start server
            const server = await this.core.start(this.config.port, this.config.host);

            return server;
        } catch (error) {
            log.Error('Failed to start application', { error });
            throw error;
        }
    }

    /**
     * Stop the application gracefully
     */
    public async stop(): Promise<void> {
        log.Info('Stopping application...');
        await this.core.stop();
        log.Info('Application stopped successfully');
    }

    /**
     * Restart the application
     */
    public async restart(): Promise<Server> {
        log.Info('Restarting application...');
        await this.stop();
        return this.start();
    }

    /**
     * Get the Express app instance
     */
    public get express(): Express {
        return this.core.app;
    }

    /**
     * Get the HTTP server instance
     */
    public get server(): Server | undefined {
        return this.core.server;
    }

    /**
     * Get current configuration
     */
    public get configuration(): Required<CoreConfig> {
        return this.core.config;
    }

    /**
     * Check if application is running
     */
    public get isRunning(): boolean {
        return this.core.isRunning;
    }

    /**
     * Add custom middleware to the Express app
     */
    public use(...handlers: any[]): this {
        this.core.app.use(...handlers);
        return this;
    }

    /**
     * Get application health status
     *
     * P0-1: 단순히 서버 listen 여부만 보지 않고, Core 의 readiness(DB 연결 상태)를
     * 반영하여 degraded 를 정직하게 노출한다.
     */
    public getHealthStatus() {
        let status: 'healthy' | 'degraded' | 'stopped';
        let readiness: ReturnType<Core['getReadiness']> | undefined;

        if (!this.isRunning) {
            status = 'stopped';
        } else {
            readiness = this.core.getReadiness();
            status = readiness.ready ? 'healthy' : 'degraded';
        }

        return {
            status,
            readiness,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.version,
            config: this.configuration,
        };
    }
}

/**
 * Quick start function for simple use cases
 */
export function createApplication(config?: Partial<CoreConfig>): Application {
    return new Application(config);
}
