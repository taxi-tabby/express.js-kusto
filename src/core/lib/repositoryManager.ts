import { log } from '../external/winston';
import { REPOSITORY_REGISTRY, RepositoryName, GetRepositoryType } from './types/generated-repository-types';
import { PrismaManager } from './prismaManager';

export class RepositoryManager {
    private static instance: RepositoryManager;
    private repositories: any = {};
    private initialized = false;
    private prismaManager: PrismaManager;

    private constructor() {
        this.prismaManager = PrismaManager.getInstance();
    }

    public static getInstance(): RepositoryManager {
        if (!RepositoryManager.instance) {
            RepositoryManager.instance = new RepositoryManager();
        }
        return RepositoryManager.instance;
    }

    /**
     * Initialize the repository manager by loading all repositories from the repository registry
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            await this.loadRepositories();
            this.initialized = true;
            log.Info(`Repository manager initialized with ${Object.keys(this.repositories).length} repositories`);
        } catch (error) {
            log.Error('Failed to initialize repository manager:', error);
            throw error;
        }
    }

    /**
     * Load all repositories from the repository registry
     */
    private async loadRepositories(): Promise<void> {
        const repositoryNames = Object.keys(REPOSITORY_REGISTRY) as RepositoryName[];

        for (const repositoryName of repositoryNames) {
            try {
                // Dynamic import using the repository registry
                const repositoryLoader = REPOSITORY_REGISTRY[repositoryName];
                
                // Skip if repository loader is not found
                if (!repositoryLoader) {
                    log.warn(`⚠️ Repository loader not found for: ${repositoryName}, skipping...`);
                    continue;
                }
                
                const repositoryExports = await (repositoryLoader as () => Promise<any>)();                // Handle different export patterns
                const RepositoryClass = this.resolveRepositoryClass(repositoryExports, repositoryName);
                  if (typeof RepositoryClass === 'function') {
                    // Pass the PrismaManager instance to the repository constructor
                    const repositoryInstance = new RepositoryClass(this.prismaManager);
                    this.repositories[repositoryName] = repositoryInstance;
                    log.Info(`Loaded repository: ${repositoryName}`);
                } else {
                    log.Warn(`Repository ${repositoryName} is not a constructor function`);
                }
            } catch (error) {
                log.Error(`Failed to load repository ${repositoryName}:`, error);
            }
        }
    }

    /**
     * Resolve the repository class from different export patterns
     */
    private resolveRepositoryClass(repositoryExports: any, repositoryName: string): any {
        // Try different export patterns
        if (repositoryExports.default) {
            return repositoryExports.default;
        }

        // Look for class with the same name as the repository
        const className = this.pascalCase(repositoryName);
        if (repositoryExports[className]) {
            return repositoryExports[className];
        }

        // Look for any function/class in the exports
        for (const key of Object.keys(repositoryExports)) {
            if (typeof repositoryExports[key] === 'function') {
                return repositoryExports[key];
            }
        }

        throw new Error(`No repository class found in ${repositoryName}`);
    }

    /**
     * Convert a repository name to PascalCase
     */
    private pascalCase(name: string): string {
        return name
            .split(/[-_\s]+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
    }    /**
     * Get a repository instance by name
     */
    public getRepository<T extends RepositoryName>(name: T): GetRepositoryType<T> {
        if (!this.initialized) {
            throw new Error('Repository manager not initialized. Call initialize() first.');
        }

        const repository = this.repositories[name];
        if (!repository) {
            throw new Error(`Repository ${name} not found`);
        }

        return repository as GetRepositoryType<T>;
    }

    /**
     * Check if a repository exists
     */
    public hasRepository(name: RepositoryName): boolean {
        return this.initialized && !!this.repositories[name];
    }

    /**
     * Get all loaded repository names
     */
    public getLoadedRepositoryNames(): string[] {
        return Object.keys(this.repositories);
    }

    /**
     * Reload a specific repository (useful for development)
     */
    public async reloadRepository(name: RepositoryName): Promise<void> {
        try {
            delete this.repositories[name];
            
            const repositoryLoader = REPOSITORY_REGISTRY[name];
            if (!repositoryLoader) {
                throw new Error(`Repository ${name} not found in registry`);
            }

            // Clear module cache to force reload
            const modulePath = require.resolve(await (repositoryLoader as () => Promise<any>).toString());
            delete require.cache[modulePath];

            const repositoryExports = await (repositoryLoader as () => Promise<any>)();
            const RepositoryClass = this.resolveRepositoryClass(repositoryExports, name);
              if (typeof RepositoryClass === 'function') {
                const repositoryInstance = new RepositoryClass(this.prismaManager);
                this.repositories[name] = repositoryInstance;
                log.Info(`Reloaded repository: ${name}`);
            }
        } catch (error) {
            log.Error(`Failed to reload repository ${name}:`, error);
            throw error;
        }
    }

    /**
     * Get repository manager status
     */
    public getStatus(): {
        initialized: boolean;
        repositoryCount: number;
        repositories: string[];
    } {
        return {
            initialized: this.initialized,
            repositoryCount: Object.keys(this.repositories).length,
            repositories: this.getLoadedRepositoryNames()
        };
    }
}

// Export singleton instance for easy access
export const repositoryManager = RepositoryManager.getInstance();
