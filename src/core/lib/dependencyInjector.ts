import { log } from '../external/winston';
import { Injectable, Middleware, MODULE_REGISTRY, MIDDLEWARE_REGISTRY, ModuleName, MiddlewareName } from './types/generated-injectable-types';

export class DependencyInjector {
    private static instance: DependencyInjector;
    private modules: any = {};
    private middlewares: any = {};
    private initialized = false;

    private constructor() {}

    public static getInstance(): DependencyInjector {
        if (!DependencyInjector.instance) {
            DependencyInjector.instance = new DependencyInjector();
        }
        return DependencyInjector.instance;
    }

    /**
     * Initialize the dependency injector by loading all modules from the module registry
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }        try {
            await this.loadModules();
            await this.loadMiddlewares();
            this.initialized = true;
            log.Info(`Dependency injection initialized with ${Object.keys(this.modules).length} modules and ${Object.keys(this.middlewares).length} middlewares`);
        } catch (error) {
            log.Error('Failed to initialize dependency injection:', error);
            throw error;
        }
    }    
    
    
    /**
     * Load all modules from the module registry
     */
    private async loadModules(): Promise<void> {
        const moduleNames = Object.keys(MODULE_REGISTRY) as ModuleName[];

        for (const moduleName of moduleNames) {
            try {
                // Dynamic import using the module registry
                const moduleLoader = MODULE_REGISTRY[moduleName];
                
                // Skip if module loader is not found
                if (!moduleLoader) {
                    log.warn(`⚠️ Module loader not found for: ${moduleName}, skipping...`);
                    continue;
                }
                
                const moduleExports = await (moduleLoader as () => Promise<any>)();

                // Handle different export patterns
                const ModuleClass = this.resolveModuleClass(moduleExports, moduleName);
                                if (typeof ModuleClass === 'function') {
                    // Constructor function or class
                    this.modules[moduleName] = new ModuleClass();
                } else if (typeof ModuleClass === 'object' && ModuleClass !== null) {
                    // Already instantiated object or module
                    this.modules[moduleName] = ModuleClass;
                } else {
                    log.warn(`Module ${moduleName} resolved to unexpected type: ${typeof ModuleClass}`);
                    this.modules[moduleName] = ModuleClass;
                }

                log.Debug(`Loaded injectable module: ${moduleName}`);
            } catch (error) {
                log.Error(`Failed to load injectable module ${moduleName}:`, error);
            }
        }
    }    
    
    
    /**
     * Load all middlewares from the middleware registry
     */
    private async loadMiddlewares(): Promise<void> {
        const middlewareNames = Object.keys(MIDDLEWARE_REGISTRY) as MiddlewareName[];
        
        log.Info(`🔧 Loading ${middlewareNames.length} middlewares: ${middlewareNames.join(', ')}`);

        for (const middlewareName of middlewareNames) {
            try {
                log.Debug(`Loading middleware: ${middlewareName}`);
                
                // Dynamic import using the middleware registry
                const middlewareLoader = MIDDLEWARE_REGISTRY[middlewareName];
                
                // Skip if middleware loader is not found
                if (!middlewareLoader) {
                    log.warn(`⚠️ Middleware loader not found for: ${middlewareName}, skipping...`);
                    continue;
                }
                
                const middlewareExports = await (middlewareLoader as () => Promise<any>)();

                log.Debug(`Middleware exports for ${middlewareName}:`, Object.keys(middlewareExports));

                // Handle different export patterns for middlewares (functions, not classes)
                const MiddlewareFunction = this.resolveMiddlewareFunction(middlewareExports, middlewareName);
                
                log.Debug(`Resolved middleware function for ${middlewareName}:`, typeof MiddlewareFunction);
                
                if (typeof MiddlewareFunction === 'function') {
                    // Execute the middleware function to get the actual middleware object
                    this.middlewares[middlewareName] = MiddlewareFunction();
                    log.Debug(`Executed middleware function for ${middlewareName}, result:`, typeof this.middlewares[middlewareName]);
                } else {
                    log.warn(`Middleware ${middlewareName} resolved to unexpected type: ${typeof MiddlewareFunction}`);
                    this.middlewares[middlewareName] = MiddlewareFunction;
                }

                log.Info(`✅ Loaded injectable middleware: ${middlewareName}`);
            } catch (error) {
                log.Error(`❌ Failed to load injectable middleware ${middlewareName}:`, error);
            }
        }
        
        log.Info(`🔧 Middleware loading complete. Loaded middlewares: ${Object.keys(this.middlewares).join(', ')}`);
    }
    
    
    /**
     * Get all injected modules
     */
    public getInjectedModules(): Injectable {
        if (!this.initialized) {
            throw new Error('Dependency injector not initialized. Call initialize() first.');
        }

        return this.modules as Injectable;
    }

    /**
     * Get all injected middlewares
     */
    public getInjectedMiddlewares(): Middleware {
        if (!this.initialized) {
            throw new Error('Dependency injector not initialized. Call initialize() first.');
        }

        return this.middlewares as Middleware;
    }

    /**
     * Get a specific module by name
     */
    public getModule<T extends ModuleName>(name: T): Injectable[T] | undefined {
        return this.modules[name];
    }    
    
    
    /**
     * Get a specific middleware by name
     */
    public getMiddleware<T extends MiddlewareName>(name: T): Middleware[T] | undefined {
        log.Debug(`Getting middleware '${name}', available middlewares: [${Object.keys(this.middlewares).join(', ')}]`);
        const middleware = this.middlewares[name];
        log.Debug(`Middleware '${name}' found: ${middleware !== undefined}, type: ${typeof middleware}`);
        return middleware;
    }

    /**
     * Register a module manually
     */
    public registerModule<T extends ModuleName>(name: T, module: Injectable[T]): void {
        this.modules[name] = module;
        log.Debug(`Manually registered module: ${name}`);
    }

    /**
     * Register a middleware manually
     */
    public registerMiddleware<T extends MiddlewareName>(name: T, middleware: Middleware[T]): void {
        this.middlewares[name] = middleware;
        log.Debug(`Manually registered middleware: ${name}`);
    }

    /**
     * Clear all modules and middlewares (useful for testing)
     */
    public clear(): void {
        this.modules = {};
        this.middlewares = {};
        this.initialized = false;
    }    
    
    
    /**
     * Resolve the module class from various export patterns
     */
    private resolveModuleClass(moduleExports: any, moduleName: string): any {
        // Handle different export patterns
        
        // 1. Default export (ES modules)
        if (moduleExports.default) {
            return moduleExports.default;
        }
        
        // 2. Named export matching the module name
        if (moduleExports[moduleName]) {
            return moduleExports[moduleName];
        }
        
        // 3. Look for common class/service naming patterns
        const commonNames = [
            moduleName,
            `${moduleName}Service`,
            `${moduleName}Class`,
            moduleName.charAt(0).toUpperCase() + moduleName.slice(1), // Capitalize first letter
            moduleName.charAt(0).toUpperCase() + moduleName.slice(1) + 'Service'
        ];
        
        for (const name of commonNames) {
            if (moduleExports[name]) {
                return moduleExports[name];
            }
        }
        
        // 4. If moduleExports is a function or class directly (CommonJS style)
        if (typeof moduleExports === 'function') {
            return moduleExports;
        }
        
        // 5. If it's an object with constructor-like properties
        if (typeof moduleExports === 'object' && moduleExports !== null) {
            
            // Look for the first function property (potential constructor)
            const functionKeys = Object.keys(moduleExports).filter(
                key => typeof moduleExports[key] === 'function'
            );
            
            if (functionKeys.length === 1) {
                return moduleExports[functionKeys[0]];
            }
            
            // If multiple functions, prefer class-like names
            const classLikeKey = functionKeys.find(key => 
                key.charAt(0) === key.charAt(0).toUpperCase()
            );
            
            if (classLikeKey) {
                return moduleExports[classLikeKey];
            }
            
            // Return the whole object if no suitable function found
            return moduleExports;
        }
        
        // 6. Fallback: return as-is
        log.Debug(`No specific export pattern found for ${moduleName}, using moduleExports directly`);
        return moduleExports;
    }

    /**
     * Resolve the middleware function from various export patterns
     */
    private resolveMiddlewareFunction(middlewareExports: any, middlewareName: string): any {
        // Handle different export patterns for middlewares
        
        // 1. Default export (ES modules) - most common for middlewares
        if (middlewareExports.default) {
            return middlewareExports.default;
        }
        
        // 2. Named export matching the middleware name
        if (middlewareExports[middlewareName]) {
            return middlewareExports[middlewareName];
        }
        
        // 3. If middlewareExports is a function directly (CommonJS style)
        if (typeof middlewareExports === 'function') {
            return middlewareExports;
        }
        
        // 4. Look for common middleware naming patterns
        const commonNames = [
            middlewareName,
            `${middlewareName}Middleware`,
            middlewareName.charAt(0).toUpperCase() + middlewareName.slice(1), // Capitalize first letter
            middlewareName.charAt(0).toUpperCase() + middlewareName.slice(1) + 'Middleware'
        ];
        
        for (const name of commonNames) {
            if (middlewareExports[name] && typeof middlewareExports[name] === 'function') {
                return middlewareExports[name];
            }
        }
        
        // 5. Fallback: return as-is
        log.Debug(`No specific export pattern found for middleware ${middlewareName}, using middlewareExports directly`);
        return middlewareExports;
    }
}
