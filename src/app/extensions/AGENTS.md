# extensions/ - Extension Activation (convention folder)

Thin activation files that turn on Kusto framework extensions for this project. Each
`*.ts` here default-exports a `KustoExtension` (usually by calling an installed extension
package's factory). The framework discovers this folder at boot, registers any new
`ExpressRouter` methods, and runs the extensions' lifecycle hooks.

This folder is **optional**: if it is absent or empty, nothing happens. An extension only
enters your dependency tree and type graph when you install its package and add an
activation file here — so unused extensions cost nothing.

## Convention

```
src/app/extensions/
├── react.ts     # default-exports a KustoExtension (e.g. react({ ... }))
└── <name>.ts    # one activation file per extension
```

```typescript
// src/app/extensions/react.ts  — one-line activation
import { react } from '@kusto/react';
export default react({ /* options */ });
```

- Only `*.ts`/`*.js` files are loaded; `index`, `AGENTS`, and `*.d.ts` are skipped.
- Files load in filename order. The default export must be a valid `KustoExtension`
  (`{ name, routerMethods?, onInit?, onBuild? }`), or boot fails with a clear error.
- The activation file's `import` also pulls in the extension package's type augmentation
  (`.d.ts`), so the new router methods (e.g. `router.GET_REACT(...)`) appear in IDE
  IntelliSense across the project.

See `docs/10-extension-system.md` for authoring and usage details, and
`src/core/lib/extensions/AGENTS.md` for the core implementation.
