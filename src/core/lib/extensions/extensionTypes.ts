import type { Express, RequestHandler } from 'express';
import type { log } from '@ext/winston';
import type { RouterContext, RouterMethodImpl } from '@lib/http/routing/expressRouter';

// Re-export the router context types so extension authors import everything from one place.
export type { RouterContext, RouterMethodImpl };

/**
 * Minimal read-only view of the boot configuration an extension may read.
 * Declared here (rather than importing CoreConfig from the bootstrap tier) so the
 * extensions tier keeps a one-way dependency direction. CoreConfig satisfies it structurally.
 */
export interface ExtensionRuntimeConfig {
    readonly basePath?: string;
    readonly routesPath?: string;
    readonly viewsPath?: string;
    readonly viewEngine?: string;
    readonly port?: number;
    readonly host?: string;
    readonly trustProxy?: boolean;
}

/**
 * Context passed to {@link KustoExtension.onInit}. Runs during Core init, after Express
 * setup and before routes load, so an extension can register middleware, static asset
 * routes, or services that routes then rely on.
 */
export interface ExtensionInitContext {
    /** The Express application; register middleware / static routes / services here. */
    app: Express;
    /** Read-only boot configuration. */
    config: ExtensionRuntimeConfig;
    /** Convenience wrapper over `app.use(mw)`. */
    registerMiddleware(mw: RequestHandler): void;
    /** Framework logger. */
    log: typeof log;
}

/**
 * Context passed to {@link KustoExtension.onBuild}. Runs from the `kusto` CLI
 * generate/build path so an extension can participate in the build (e.g. bundle assets).
 */
export interface ExtensionBuildContext {
    /** Repository root (`process.cwd()`). */
    rootDir: string;
    /** Application workspace dir (`src/app`). */
    appDir: string;
    /** Whether this is a production build. */
    isProduction: boolean;
    /** Framework logger. */
    log: typeof log;
}

/**
 * A Kusto framework extension. Shipped by a separate npm package and activated by a thin
 * file under `src/app/extensions/` that default-exports it. All hooks are optional.
 */
export interface KustoExtension {
    /** Unique identifier, e.g. '@kusto/react'. */
    name: string;
    /** Optional version string (informational). */
    version?: string;
    /** New ExpressRouter methods to register (method name -> implementation). */
    routerMethods?: Record<string, RouterMethodImpl>;
    /** Lifecycle hook run during Core init (after Express setup, before routes). */
    onInit?(ctx: ExtensionInitContext): void | Promise<void>;
    /** Build hook run from the `kusto` CLI (e.g. bundle client assets). */
    onBuild?(ctx: ExtensionBuildContext): void | Promise<void>;
}

/** Identity helper for authoring extensions with full type-checking and inference. */
export function defineExtension(extension: KustoExtension): KustoExtension {
    return extension;
}

/** Runtime shape validation; the loader uses it to reject malformed default exports. */
export function isKustoExtension(value: unknown): value is KustoExtension {
    if (!value || typeof value !== 'object') return false;
    const e = value as Record<string, unknown>;
    if (typeof e.name !== 'string' || e.name.length === 0) return false;
    if (e.routerMethods !== undefined) {
        if (typeof e.routerMethods !== 'object' || e.routerMethods === null) return false;
        if (Object.values(e.routerMethods).some((v) => typeof v !== 'function')) return false;
    }
    if (e.onInit !== undefined && typeof e.onInit !== 'function') return false;
    if (e.onBuild !== undefined && typeof e.onBuild !== 'function') return false;
    return true;
}
