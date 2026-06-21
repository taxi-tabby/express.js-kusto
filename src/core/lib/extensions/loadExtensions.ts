import * as fs from 'fs';
import * as path from 'path';
import { log } from '@ext/winston';
import { ExpressRouter } from '@lib/http/routing/expressRouter';
import { isKustoExtension, KustoExtension } from '@lib/extensions/extensionTypes';
import { extensionRegistry } from '@lib/extensions/extensionRegistry';

/** Convention folder for extension activation files. */
const DEFAULT_EXTENSIONS_DIR = './src/app/extensions';

/** Resolve and require an extension module, returning its default export (or the module). */
function loadExtensionModule(filePath: string): unknown {
    const resolved = path.resolve(filePath);
     
    const mod = require(resolved);
    return mod && mod.default !== undefined ? mod.default : mod;
}

/** Only `*.ts`/`*.js` activation files are loaded; `.d.ts`, barrels, and AGENTS.md are skipped. */
function isExtensionFile(fileName: string): boolean {
    if (fileName.endsWith('.d.ts')) return false;
    if (!fileName.endsWith('.ts') && !fileName.endsWith('.js')) return false;
    const base = fileName.replace(/\.(ts|js)$/, '');
    return base !== 'index' && base !== 'AGENTS';
}

/**
 * Discover and apply extensions from the convention folder `src/app/extensions/`.
 *
 * Each `*.ts` default-exports a {@link KustoExtension}. Router methods are registered on
 * `ExpressRouter` immediately (this MUST run before route files load, since `route.ts` may
 * call the new methods); `onInit`/`onBuild` hooks are collected in the registry for later
 * execution. Files are processed in filename order for determinism. No-op if the folder is absent.
 */
export function loadExtensions(dir: string = DEFAULT_EXTENSIONS_DIR): KustoExtension[] {
    const resolvedDir = path.resolve(dir);
    if (!fs.existsSync(resolvedDir)) {
        return [];
    }

    const loaded: KustoExtension[] = [];
    const entries = fs
        .readdirSync(resolvedDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isExtensionFile(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        const filePath = path.join(resolvedDir, entry.name);
        let exported: unknown;
        try {
            exported = loadExtensionModule(filePath);
        } catch (error) {
            log.Error(`Failed to load extension file: ${entry.name}`, { error });
            throw error;
        }

        if (!isKustoExtension(exported)) {
            throw new Error(
                `[kusto] Extension file '${entry.name}' must default-export a valid KustoExtension (got: ${typeof exported}).`,
            );
        }

        // Skip duplicate names before applying anything, so the returned list, the registry,
        // and the executed hooks stay in lockstep (registry already warned).
        if (!extensionRegistry.register(exported)) {
            continue;
        }
        // Register router methods now, before any route.ts runs.
        if (exported.routerMethods) {
            for (const [name, impl] of Object.entries(exported.routerMethods)) {
                ExpressRouter.registerMethod(name, impl);
            }
        }
        loaded.push(exported);
        log.Silly(`Extension loaded: ${exported.name}`);
    }
    return loaded;
}

export default loadExtensions;
