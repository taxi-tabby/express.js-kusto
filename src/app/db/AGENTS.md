# db/ - Database Schema Management

Multi-database support via folder-based organization. Each subfolder represents an independent database.

## Structure

```
db/
├── default/          # "default" database
│   ├── schema.prisma # Prisma schema definition
│   └── client/       # Auto-generated Prisma client (gitignored)
├── another_db/       # Additional database (example)
│   ├── schema.prisma
│   └── client/
└── ...
```

## Conventions

- **One folder = One database**: the folder name is the database identifier (`prismaManager.getWrap('default')`)
- **`schema.prisma` required**: a folder is only recognized if it contains a Prisma schema file
- **`client/` auto-generated**: running `npm run db -- generate --all` generates a type-safe Prisma client in each folder
- **Connection via environment variable** (2 modes):
  1. `url = env("VAR_NAME")` in `schema.prisma` → uses that environment variable
  2. `url` omitted → the `{FOLDER_NAME}__KUSTO_RDB_URL` convention is applied automatically (camelCase → UPPER_SNAKE_CASE conversion)
- **Provider auto-detection**: based on the `datasource.provider` value in `schema.prisma`, the appropriate driver adapter is loaded dynamically (postgresql, mysql, sqlite)

## Type Generation

Running `npm run generate` generates the types for all databases, consolidated into `src/core/lib/types/generated-db-types.ts`, to support IDE autocompletion.
