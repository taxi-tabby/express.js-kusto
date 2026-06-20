import express, { Express } from 'express';
import { log } from '@ext/winston';

/**
 * @deprecated Use Core class instead. This is kept for backward compatibility.
 * 
 * Express Application Singleton
 * This class is now a simple wrapper around Express for legacy support.
 * 
 * @example
 * ```typescript
 * // Legacy usage (deprecated)
 * import expressApp from '@core/bootstrap/expressAppSingleton';
 * const app = expressApp.getApp();
 * 
 * // New recommended usage
 * import { Core, Application } from '@core/bootstrap/Core';
 * const app = new Application();
 * ```
 */
class AppSingleton {
    private static instance: AppSingleton;

    public app: Express;

    private constructor() {
        this.app = express();

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
}

const instance = AppSingleton.getInstance();

export default instance;