# updater/ - Framework Self-Update Tooling

A self-updater that fetches framework core (`src/core`) files from GitHub releases and applies them safely.
Because it is an operator-facing CLI, it is **exempt** from the runtime log conventions (English-only, no emoji).

> Important: the updater deploys **framework-owned** files only — `src/core/**` (except `src/core/updater/` itself),
> plus framework root files (`src/index.ts`, `bin/kusto.js`, `docs/`). **Consumer-owned** trees and project files are
> excluded from the deployment file map and are **never overwritten**: `src/app/` (user code), `tests/` (tests are
> per-project), `public/` (consumer assets), and project meta/config files (`package.json`, `tsconfig.*`,
> `jest.config.*`, `webpack.config.js`, `nodemon.*`, `prisma.config.ts`, `artillery-test.yml`, `README.md`,
> `CHANGELOG.md`, `LICENSE*`, `CLAUDE.md`, `.gitignore`/`.gitattributes`). The scan is inclusive-by-default, so these
> exclusions are the gate — see the two SSOT predicates in `analy.ts`. Exposed via the unified `kusto` CLI as `kusto update <...>`.

## Structure

```
updater/
├── paths.ts       # path SSOT: PROJECT_ROOT/UPDATER_DIR/MAP_DIR/PACKAGES_DIR/PACKAGE_JSON_PATH
├── checksum.ts    # hash SSOT: SHA-256 default + file-map algo-field back-compat (defaults to md5 when absent)
├── archive.ts     # zip-slip (path-traversal) safe extraction
├── analy.ts       # scan core files → build file map (file map = {path: {checksum, algo}})
├── generate.ts    # package file map + sources into a zip (release asset)
├── compare.ts     # compare current version vs latest release + extract download URL
└── update.ts      # download → integrity check → plan → backup → apply/rollback
```

Generated artifacts (`map/`, `packages/`, `temp-update/`, `.installed-map.json`) are gitignored.

## Files

### `paths.ts`
- **Responsibility**: because the updater lives in `src/core/updater/`, its `__dirname` depth differs (`path.resolve(__dirname,'..')` is no longer the repo root), so all paths are derived in one place.
- **Key exports**: `PROJECT_ROOT` (= three levels up, the base for applying updates), `UPDATER_DIR`, `MAP_DIR`, `PACKAGES_DIR`, `PACKAGE_JSON_PATH`.

### `checksum.ts`
- **Responsibility**: the hash SSOT shared by the generator and the applier. When an entry has no `algo`, it is interpreted as the legacy format (md5) for back-compat.
- **Key exports**: `ChecksumAlgo`, `DEFAULT_ALGO` ('sha256'), `FileMap`/`FileMapEntry`, `hashBuffer`, `checksumFile`, `entryAlgo`, `matchesEntry`.

### `archive.ts`
- **Responsibility**: during ZIP extraction, reject any entry that points outside the extraction root (`../`/absolute path) (zip-slip protection).
- **Key exports**: `isEntryInsideRoot` (pure guard, unit-tested), `extractZipSafe`.

### `analy.ts`
- **Responsibility**: scan PROJECT_ROOT to build the core file map. Two SSOT exclusion predicates gate the inclusive-by-default scan: `shouldSkipDirectory(dirName, relativePath)` (skips build/VCS/editor dirs + consumer-owned trees `src/app`/`tests`/`public` + `src/core/updater`) and `shouldExcludeFromDeployment(fileName, relativePath)` (drops project meta/config files by name/pattern: npm files, `tsconfig.*`, `jest.config.*`, `webpack.config.js`, `nodemon.*`, `prisma.config.ts`, `artillery-test.yml`, `README.md`/`CHANGELOG.md`/`LICENSE*`, `CLAUDE.md`, and the three generated `*-types.ts`). Also honors `.gitignore`. Sets `algo: sha256` explicitly.
- **Key exports**: `generateFileMap(outputDir?)`, `runAnalysis()`, `shouldSkipDirectory`, `shouldExcludeFromDeployment`.

### `generate.ts`
- **Responsibility**: package source files into a zip based on the file map (`file-map/` + `files/`). Produces the release asset.
- **Key exports**: `generateAndCompress(outputDir?)`, `compressFilesFromMap(...)`, `compressFromExistingMap(...)`.

### `compare.ts`
- **Responsibility**: compare the current `package.json` version against the latest GitHub release, and extract the asset (zip/file map) download URL.
- **Key exports**: `checkForUpdates()`, `runUpdateCheck()`, `ComparisonResult`.

### `update.ts`
- **Responsibility**: download → zip-slip-safe extraction → integrity check (against the authoritative file map) → plan (create/update/delete) → backup → apply, with rollback on failure. Uses `.installed-map.json` for deletion detection.
- **Key exports**: `performUpdate(options)`, `runUpdate(options?)`, `UpdateOptions` (dryRun/yes/packagePath/keepBackup).

## Dependency / Trust Model

- The standard import path is `@core/updater/<file>`. `@core` (src/core) is the single root.
- The runtime core (`src/index.ts`/`src/app`/`src/core/lib`) does **not** import the updater (not included in the server bundle). Conversely, the updater enables aliases via `module-alias/register` in `compare`/`update`.
- The trust basis is **HTTPS (github.com) + release ownership**. Integrity verification only detects corruption/partial transfers; since there is no code signing, it does not guarantee cryptographic authenticity against release forgery. For details, see `docs/07-update-system.md`.
