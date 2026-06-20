# core/ - Framework Internals

All internal implementation of the express.js-kusto framework. Covers bootstrap (lifecycle), HTTP request handling/validation/serialization/errors, multi-DB and DI, the CRUD engine, dev tools, and CLI/scripts/updater.

## ⛔ Do-Not-Modify Principle (most important)

**`src/core/` is, by default, not a space for LLMs or developers to edit directly — strictly and absolutely prohibited.**

- In any **project that consumes (installs) this framework**, `src/core/` is framework internals. Do not edit it directly. Changes arrive only through `kusto update` (the framework self-update). Editing it directly means it gets overwritten or conflicts on the next update.
- **Exception — this very repo**: this repository is the source repo that *implements the framework itself*, so `src/core/` is edited directly here. However, the following discipline must be observed.
  1. Read the `AGENTS.md` of the relevant folder (and its parent tiers) before editing.
  2. Do not violate the tier dependency direction (below) — no back-references.
  3. When you change code, sync that folder's `AGENTS.md` in the same change.

> The user (developer) workspace is `src/app/`. Put all application code there.

## Structure (see each folder's AGENTS.md)

```
core/
├── index.ts        # public API barrel (curated re-exports)
├── AGENTS.md       # (this file) core root index + do-not-modify principle
├── bootstrap/      # lifecycle: Application, Core, expressAppSingleton(@deprecated) — AGENTS.md
├── external/       # 3rd-party wrappers (leaf, zero intra-core imports): winston, util — AGENTS.md
├── cli/            # unified `kusto` CLI (commander) over db/update/generate
├── scripts/        # standalone build/codegen CLI tooling (operator-facing)
├── updater/        # framework self-update (excluded from its own deploy map) — AGENTS.md
└── lib/
    ├── http/       # request-handling tier (routing/validation/serialization/errors) — AGENTS.md
    ├── data/       # persistence tier (database/di) — AGENTS.md
    ├── crud/       # JSON:API CRUD engine — AGENTS.md
    ├── extensions/ # CoC extension system (router methods / lifecycle / build hooks) — AGENTS.md
    ├── devtools/   # DEV-only (documentation/schema-api/monitor) — AGENTS.md
    ├── config/     # environmentLoader — AGENTS.md
    └── types/      # express-extensions + generated-*.ts (codegen output, do-not-edit) — AGENTS.md
```

## Tier Dependency Direction (one-way)

`bootstrap` → tiers. Within `lib`, higher tiers depend inward on lower tiers. `external` and `config` are leaves. Reverse edges (e.g. `data` importing `http`) are prohibited. `devtools` is dev-only and may depend on runtime tiers, but never the reverse. `extensions` depends inward on `http/routing` (for `RouterContext` / `ExpressRouter.registerMethod`) and must not depend on `bootstrap`.

## AGENTS.md Convention (required: reference + sync)

- **Always reference before working**: before reading/editing any file in `src/core/`, first read that folder's `AGENTS.md` (and the parent tier's `AGENTS.md`). It is the single source of truth for each file's role, exports, and dependency direction — do not start from the code alone.
- **Always sync on change**: when adding a new feature/file/export or changing behavior/dependency direction, update that folder's `AGENTS.md` in the same change. A state where the code and `AGENTS.md` diverge is treated as a defect.
