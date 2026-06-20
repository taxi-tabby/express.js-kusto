# external/ - third-party library wrappers / general-purpose helpers

The leaf tier that provides the logging subsystem — a wrapper around a third-party library (winston) adapted to the framework's conventions — plus general-purpose utility functions that depend on no tier. It imports nothing anywhere inside core (zero intra-core dependencies); every other tier imports toward it (a pure bottom layer).

## Structure

```
external/
├── winston.ts   # logging subsystem: custom levels/colors/emojis, env-aware console level, safe serialization + sensitive-data masking, log singleton
└── util.ts      # general-purpose helpers: slash normalization, elapsed-time formatting, pluralize/singularize, pagination cursor
```

## winston.ts — logging subsystem (leaf, zero intra-core dependencies)

A single module that layers project-specific log levels/format/serialization policy on top of winston + winston-daily-rotate-file. Its only external dependencies are `winston`, `winston-daily-rotate-file`, `logform`, and the Node built-ins `path`/`fs`; it imports no core-internal module whatsoever.

Main exports:
- `log` (default + named) — a winston `Logger` singleton with custom level methods. Level methods (PascalCase): `Error`, `Warn`, `Info`, `Debug`, `Silly`, `SQL`, `Route`, `SessionDeclaration`, `Footwalk`, `Email`, `Auth` (plus a lowercase `error` alias for winston's exception handling). Used globally across the core/app runtime via `import { log } from '@ext/winston'`.
- `logger` — an auxiliary utility object: `startTimer(label)` (hrtime-based performance timer), `httpRequest(method,url,statusCode,duration)`, `dbQuery(query,duration?,params?)`.
- `LogLevelName` — a level-name union type derived from the `LOG_SETTINGS` keys.
- `normalizeLevel(raw)` — resolves an arbitrary string/alias/`silent`·`off`·`none` to a canonical level name or `'silent'`/`null` (for `LOG_LEVEL` normalization).
- `resolveConsoleLevel(env?)` — determines the console transport level. Precedence: `LOG_LEVEL` > per-environment default (production=`Info`, test=`Error`, otherwise=`Debug`). Since the dev default is `Debug`, `Silly` is hidden by default.
- `isColorEnabled(env?, isTTY?)` — whether ANSI color is used. Respects the `NO_COLOR` standard, honors `FORCE_COLOR` as a force, and is disabled on non-TTY.
- `toSafeJson(value, opts?)` — converts to a JSON-safe structure, guarding against every case where `JSON.stringify` could throw (circular references, `BigInt`, functions, symbols, `Error`, `Buffer`, `Date`, `Map`/`Set`, throwing getters, depth overflow).
- `safeStringify(value, opts?)` — cleans up via `toSafeJson`, then serializes. Never throws on any input and masks sensitive keys to `[REDACTED]`.

Key internal behavior: `LOG_SETTINGS` is the single source of truth for levels/colors/emojis (`customLevels`/`customColors`/`customEmojis` are derived from it). Dev uses a human-readable colored line (TTY only); prod uses one-line JSON. Sensitive-key matching is composed of `SUBSTRING_TOKENS` (partial match) + `WORD_TOKENS` (whole-word, e.g. `pwd`/`ssn`/`jwt`); disable it with `LOG_REDACT=false`, add extra keys with `LOG_REDACT_KEYS=a,b`. Daily-rotating file logs are tuned via `LOG_DIR`/`LOG_MAX_SIZE`/`LOG_MAX_FILES`/`LOG_FILE_LEVEL`, and on log-directory creation failure (`ensureLogDirectory`) or transport initialization failure they degrade gracefully to console-only instead of throwing. Transport write failures (`log.on('error')`) are routed to stderr so they do not kill the process.

## util.ts — general-purpose helpers (leaf, zero dependencies)

A collection of pure functions with no external or internal imports at all. Shared across the core for string paths/pagination/word transformations.

Main exports:
- `normalizeSlash(input)` — collapses consecutive slashes (`//+`) into a single `/` (URL/path normalization).
- `getElapsedTimeInString(endTime)` — formats a `process.hrtime` `[seconds, nanoseconds]` tuple into a string in the form `"1.2s (1234ms)"`.
- `pluralize(word)` — simple English-rule pluralization (`s`/`x`/`ch`/`sh`→`+es`, `y`→`ies`, otherwise `+s`).
- `singularize(word)` — singularization by the inverse of `pluralize`'s rules (`ies`→`y`, `ses`/`xes`/`ches`/`shes`→`-es`, strips a trailing `s` except for `ss`).
- `createPaginationCursor(total)` — generates a base64 pagination cursor in a TypeORM-compatible format.

## Import rules / layering

- The canonical import path is not the single `@lib` root but the alias `@ext`: `@ext/winston`, `@ext/util` (= `src/core/external/*`). `@ext` is a dedicated alias pointing at `src/core/external` (distinct from `@lib` = `src/core/lib`).
- **Layering direction**: external is the lowest layer of core (leaf). Both files import nothing from inside core (outbound dependencies = winston-family/Node built-ins only), and higher tiers (lib and core in general, app) import toward it one-directionally. Because it is a safe bottom layer with no circular risk, it can be freely pulled in from anywhere.
