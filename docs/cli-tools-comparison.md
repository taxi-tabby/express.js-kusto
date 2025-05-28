# CLI Tools Comparison

This document explains the differences between the two available database CLI tools.

## db-cli.ts (Updated for Multi-Database Support)

The original CLI tool has been updated to work with the new multi-database MigrationManager API. It provides backward compatibility while supporting multiple databases.

### Features:
- **Single database operations** with automatic database selection
- **Database selection** via `-d, --database <name>` option
- **Default database** automatically uses the first configured database
- **List databases** command to see all configured databases
- **Health check** for all databases

### Usage:
```bash
# Use default database (first configured)
npm run db:migrate:create my_migration
npm run db:migrate:run
npm run db:generate

# Use specific database
npm run db:migrate:create my_migration -- -d mysql_db
npm run db:migrate:run -- -d postgresql_db
npm run db:generate -- -d sqlite_db

# List all databases
npm run db:list

# Health check all databases
npm run db:health
```

### Available Commands:
- `migrate create <name>` - Create new migration for specified database
- `migrate run [name]` - Run migrations for specified database
- `migrate status` - Check migration status for specified database
- `migrate reset` - Reset specified database
- `generate` - Generate Prisma Client for specified database
- `push` - Push schema to specified database
- `studio` - Open Prisma Studio for specified database
- `setup` - Complete setup (migrate + generate) for specified database
- `health` - Check health of all databases
- `list` - List all configured databases

## db-cli-multi.ts (Full Multi-Database CLI)

A new, more advanced CLI tool designed specifically for multi-database operations with explicit database management.

### Features:
- **Explicit database selection** required for all operations
- **Batch operations** across all databases
- **Advanced multi-database management**
- **Database-specific commands** with clear separation

### Usage:
```bash
# Database-specific operations
node src/core/scripts/db-cli-multi.ts migrate run postgresql_db
node src/core/scripts/db-cli-multi.ts generate mysql_db
node src/core/scripts/db-cli-multi.ts setup sqlite_db

# Batch operations
node src/core/scripts/db-cli-multi.ts migrate run-all
node src/core/scripts/db-cli-multi.ts generate-all
node src/core/scripts/db-cli-multi.ts setup-all
```

### Available Commands:
- `migrate create <dbName> <name>` - Create migration for specific database
- `migrate run <dbName> [name]` - Run migrations for specific database
- `migrate run-all [name]` - Run migrations for all databases
- `migrate status <dbName>` - Check migration status for specific database
- `migrate reset <dbName>` - Reset specific database
- `generate <dbName>` - Generate client for specific database
- `generate-all` - Generate clients for all databases
- `push <dbName>` - Push schema to specific database
- `studio <dbName>` - Open Prisma Studio for specific database
- `setup <dbName>` - Complete setup for specific database
- `setup-all` - Complete setup for all databases
- `health` - Check health of all databases
- `list` - List all configured databases

## When to Use Which Tool

### Use `db-cli.ts` when:
- You primarily work with one database
- You want backward compatibility with existing scripts
- You prefer automatic database selection
- You're migrating from single-database setup

### Use `db-cli-multi.ts` when:
- You frequently work with multiple databases
- You need explicit control over which database to target
- You want to perform batch operations across all databases
- You prefer explicit over implicit database selection

## Migration Path

If you're currently using the old CLI and want to migrate:

1. **Continue using `db-cli.ts`** - It's been updated to work with the new system
2. **Add database selection** - Use the `-d` option when you need a specific database
3. **Gradually migrate to `db-cli-multi.ts`** - When you need more advanced multi-database features

Both tools are fully compatible with the same underlying MigrationManager system.
