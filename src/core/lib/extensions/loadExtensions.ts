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

/**
 * Only `*.ts`/`*.js` activation files are loaded; `.d.ts`, barrels, and AGENTS.md are skipped.
 *
 * SSOT pair: this rule MUST stay identical to `isExtensionFile` in
 * `src/core/scripts/generate-extensions-map.js` — dev (runtime fs scan, here) and the build
 * (that codegen) must select the same file set or the bundle registers a different extension
 * set than dev. Their equivalence is pinned by
 * `tests/unit/extensions/extension-file-filter-parity.test.ts`.
 */
export function isExtensionFile(fileName: string): boolean {
    if (fileName.endsWith('.d.ts')) return false;
    if (!fileName.endsWith('.ts') && !fileName.endsWith('.js')) return false;
    const base = fileName.replace(/\.(ts|js)$/, '');
    return base !== 'index' && base !== 'AGENTS';
}

/** A discovered extension activation: its source label (for diagnostics) and default export. */
interface DiscoveredExtension {
    source: string;
    exported: unknown;
}

/**
 * Map a bundled extensions-map module (`{ extensions, extensionSources }`) to the discovered list.
 *
 * Pure — this is the build-branch logic, extracted so it is unit-testable without mutating
 * global `process.env`/the filesystem. A missing or non-array `extensions` yields `[]`;
 * `extensionSources[i]` (emitted by the codegen) labels each entry for diagnostics, falling back
 * to the array index when absent.
 */
export function bundledExtensionsToDiscovered(mod: unknown): DiscoveredExtension[] {
    const m = (mod ?? {}) as { extensions?: unknown; extensionSources?: unknown };
    const list: unknown[] = Array.isArray(m.extensions) ? m.extensions : [];
    const sources: unknown[] = Array.isArray(m.extensionSources) ? m.extensionSources : [];
    return list.map((exported, i) => ({
        source: typeof sources[i] === 'string' ? (sources[i] as string) : `extensions-map[${i}]`,
        exported,
    }));
}

/**
 * Discover extension activations.
 *
 * - **dev** (`WEBPACK_BUILD !== 'true'`): runtime scan of `src/app/extensions/` + `require` of
 *   each activation file (ts-node transpiles `.ts`).
 * - **build** (`WEBPACK_BUILD === 'true'`): the runtime fs scan + `require` of raw source does
 *   NOT work in the webpack bundle (the activation files are never bundled), so a build-time
 *   codegen (`generate-extensions-map.js`) emits `src/core/tmp/extensions-map.ts` that statically
 *   imports the activations; webpack bundles it and we read the array here. This mirrors how
 *   routes use `routes-map.ts`. Without this, extension methods (e.g. `GET_REACT`) are never
 *   registered in the build and routes that call them fail with "X is not a function".
 */
function discoverExtensions(dir: string): DiscoveredExtension[] {
    if (process.env.WEBPACK_BUILD === 'true') {
        // 정적 require(리터럴) — webpack 이 extensions-map(과 그것이 import 하는 확장 모듈)을 번들한다.
        // dev/test 에서는 이 분기에 진입하지 않으므로(파일도 없음) 실행되지 않는다.
        // 매핑 로직은 bundledExtensionsToDiscovered(순수, 단위 테스트됨)에 위임한다.
        return bundledExtensionsToDiscovered(require('@core/tmp/extensions-map'));
    }

    const resolvedDir = path.resolve(dir);
    if (!fs.existsSync(resolvedDir)) {
        return [];
    }
    return fs
        .readdirSync(resolvedDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isExtensionFile(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => {
            const filePath = path.join(resolvedDir, entry.name);
            try {
                return { source: entry.name, exported: loadExtensionModule(filePath) };
            } catch (error) {
                log.Error(`Failed to load extension file: ${entry.name}`, { error });
                throw error;
            }
        });
}

/**
 * Discover and apply extensions from the convention folder `src/app/extensions/`.
 *
 * Each activation default-exports a {@link KustoExtension}. Router methods are registered on
 * `ExpressRouter` immediately (this MUST run before route files load, since `route.ts` may
 * call the new methods); `onInit`/`onBuild` hooks are collected in the registry for later
 * execution. Activations are processed in filename order for determinism. No-op if there are
 * none. Works in both dev (runtime fs scan) and the webpack build (bundled extensions-map).
 */
export function loadExtensions(dir: string = DEFAULT_EXTENSIONS_DIR): KustoExtension[] {
    const loaded: KustoExtension[] = [];

    for (const { source, exported } of discoverExtensions(dir)) {
        if (!isKustoExtension(exported)) {
            throw new Error(
                `[kusto] Extension '${source}' must default-export a valid KustoExtension (got: ${typeof exported}).`,
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
