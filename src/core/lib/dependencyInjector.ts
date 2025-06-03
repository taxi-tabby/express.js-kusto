import { log } from '../external/winston';
import { Injectable, MODULE_REGISTRY, ModuleName } from './types/generated-injectable-types';

export class DependencyInjector {
    private static instance: DependencyInjector;
    private modules: Partial<Injectable> = {};
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
                const moduleExports = await moduleLoader();                // Get the module (prefer default export)
                const ModuleClass = moduleExports.default || moduleExports;

                // Always instantiate if it's a constructor function
                if (typeof ModuleClass === 'function') {
                    this.modules[moduleName] = new ModuleClass();
                } else {
                    // If it's already an object/instance, use it directly
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
}
