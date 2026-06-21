import { log } from '@ext/winston';
import type {
    KustoExtension,
    ExtensionInitContext,
    ExtensionBuildContext,
} from '@lib/extensions/extensionTypes';

/**
 * Singleton store of loaded extensions. The loader (`loadExtensions`) registers each
 * discovered extension here; Core runs the collected `onInit` hooks during boot and the
 * `kusto` CLI runs the `onBuild` hooks at build time. Router methods are NOT stored here —
 * they are applied directly to `ExpressRouter.prototype` by the loader.
 */
class ExtensionRegistry {
    private static instance: ExtensionRegistry;
    private extensions: KustoExtension[] = [];

    static getInstance(): ExtensionRegistry {
        if (!ExtensionRegistry.instance) {
            ExtensionRegistry.instance = new ExtensionRegistry();
        }
        return ExtensionRegistry.instance;
    }

    /** Store an extension. Returns false (with a warning) if an extension of the same name already exists. */
    register(extension: KustoExtension): boolean {
        if (this.extensions.some((e) => e.name === extension.name)) {
            log.Warn(`Extension '${extension.name}' is already registered; ignoring duplicate.`);
            return false;
        }
        this.extensions.push(extension);
        return true;
    }

    getAll(): readonly KustoExtension[] {
        return this.extensions;
    }

    /** Run every extension's `onInit` hook in registration order. Re-throws to fail-fast. */
    async runInit(ctx: ExtensionInitContext): Promise<void> {
        for (const ext of this.extensions) {
            if (!ext.onInit) continue;
            try {
                await ext.onInit(ctx);
            } catch (error) {
                log.Error(`Extension '${ext.name}' onInit failed`, { error });
                throw error;
            }
        }
    }

    /** Run every extension's `onBuild` hook in registration order. Re-throws to fail-fast. */
    async runBuild(ctx: ExtensionBuildContext): Promise<void> {
        for (const ext of this.extensions) {
            if (!ext.onBuild) continue;
            try {
                await ext.onBuild(ctx);
            } catch (error) {
                log.Error(`Extension '${ext.name}' onBuild failed`, { error });
                throw error;
            }
        }
    }

    /** Test-only: drop all registered extensions. */
    clear(): void {
        this.extensions = [];
    }
}

export const extensionRegistry = ExtensionRegistry.getInstance();
