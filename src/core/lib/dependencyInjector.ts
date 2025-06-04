import { log } from '../external/winston';
import { Injectable, MODULE_REGISTRY, ModuleName } from './types/generated-injectable-types';

export class DependencyInjector {
    private static instance: DependencyInjector;
    private modules: any = {};
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
        }

        try {
            await this.loadModules();
            this.initialized = true;
            log.Info(`Dependency injection initialized with ${Object.keys(this.modules).length} modules`);
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
                const moduleExports = await moduleLoader();

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
     * Get all injected modules
     */
    public getInjectedModules(): Injectable {
        if (!this.initialized) {
            throw new Error('Dependency injector not initialized. Call initialize() first.');
        }

        return this.modules as Injectable;
    }

    /**
     * Get a specific module by name
     */
    public getModule<T extends ModuleName>(name: T): Injectable[T] | undefined {
        return this.modules[name];
    }

    /**
     * Register a module manually
     */
    public registerModule<T extends ModuleName>(name: T, module: Injectable[T]): void {
        this.modules[name] = module;
        log.Debug(`Manually registered module: ${name}`);
    }

    /**
     * Clear all modules (useful for testing)
     */
    public clear(): void {
        this.modules = {};
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
}
