#!/usr/bin/env node
// filepath: r:\project\express.js-kusto\src\core\scripts\kusto-db-cli.ts

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import * as util from 'util';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

const execPromise = util.promisify(exec);

/**
 * Dangerous operations that require double confirmation
 */
const DANGEROUS_OPERATIONS = ['reset', 'pull', 'push', 'deploy'];

/**
 * Generate a random 4-character alphanumeric code
 */
function generateSecurityCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Prompt user for security code confirmation
 */
async function promptSecurityCode(operation: string): Promise<boolean> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (prompt: string): Promise<string> => {
        return new Promise((resolve) => {
            rl.question(prompt, resolve);
        });
    };

    try {
        console.log(`\n🚨 SECURITY WARNING: You are about to perform a DANGEROUS operation: "${operation}"`);
        console.log('🔒 This operation requires double confirmation with security codes.');
        
        // First confirmation
        const code1 = generateSecurityCode();
        console.log(`\n🔑 First confirmation code: ${code1}`);
        const input1 = await question('   Please type the code exactly as shown: ');
        
        if (input1 !== code1) {
            console.log('❌ First confirmation failed. Operation cancelled.');
            return false;
        }
        
        console.log('✅ First confirmation successful.');
        
        // Second confirmation
        const code2 = generateSecurityCode();
        console.log(`\n🔑 Second confirmation code: ${code2}`);
        const input2 = await question('   Please type the code exactly as shown: ');
        
        if (input2 !== code2) {
            console.log('❌ Second confirmation failed. Operation cancelled.');
            return false;
        }
        
        console.log('✅ Both confirmations successful. Proceeding with operation...\n');
        return true;
    } finally {
        rl.close();
    }
}

/**
 * Check if operation requires security confirmation
 */
async function checkSecurityConfirmation(operation: string): Promise<boolean> {
    if (DANGEROUS_OPERATIONS.includes(operation)) {
        return await promptSecurityCode(operation);
    }
    return true;
}

/**
 * Load environment variables with NODE_ENV support
 * Similar to how the main application loads environment variables
 */
function loadEnvironmentConfig() {
    // 기본 .env 파일 경로
    const defaultEnvPath = path.resolve(process.cwd(), '.env');
    
    // 기본 .env 파일이 존재하는지 확인
    if (!fs.existsSync(defaultEnvPath)) {
        console.error('❌ .env file not found! Application requires environment configuration.');
        console.error('   Please create .env file in the project root.');
        return;
    }
    
    // 1. 기본 .env 파일 먼저 로드
    console.log(`🔧 Loading base environment config from: ${defaultEnvPath}`);
    dotenv.config({ path: defaultEnvPath });
    
    // 2. NODE_ENV 기반 환경별 파일로 덮어쓰기
    const nodeEnv = process.env.NODE_ENV;
    let envSpecificPath: string | null = null;
    
    if (nodeEnv === 'development') {
        envSpecificPath = path.resolve(process.cwd(), '.env.dev');
    } else if (nodeEnv === 'production') {
        envSpecificPath = path.resolve(process.cwd(), '.env.prod');
    }
    
    // 환경별 파일이 존재하면 덮어쓰기
    if (envSpecificPath && fs.existsSync(envSpecificPath)) {
        console.log(`🔧 Overriding with environment-specific config from: ${envSpecificPath}`);
        dotenv.config({ path: envSpecificPath, override: true });
    } else if (nodeEnv) {
        console.log(`⚠️ Environment-specific file (.env.${nodeEnv}) not found, using base .env only`);
    }
    
    // 최종 환경 정보 출력
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
}

// Load environment before defining any commands
loadEnvironmentConfig();

// Define the program
const program = new Command();

// Setup basic program info
program
    .name('kusto-db')
    .description('CLI tool for managing Prisma databases in express.js-kusto project')
    .version('1.0.0');

/**
 * Get all database directories from src/app/db
 */
function getDatabaseDirs(): string[] {
    const dbPath = path.join(process.cwd(), 'src', 'app', 'db');

    if (!fs.existsSync(dbPath)) {
        console.error(`Database directory not found: ${dbPath}`);
        return [];
    }

    return fs.readdirSync(dbPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && fs.existsSync(path.join(dbPath, dirent.name, 'schema.prisma')))
        .map(dirent => dirent.name);
}

/**
 * Get schema path for a database
 */
function getSchemaPath(dbName: string): string {
    return path.join(process.cwd(), 'src', 'app', 'db', dbName, 'schema.prisma');
}

/**
 * Execute a Prisma command for a specific database
 */
async function executePrismaCommand(dbName: string, command: string): Promise<void> {
    const schemaPath = getSchemaPath(dbName);

    if (!fs.existsSync(schemaPath)) {
        throw new Error(`Schema file not found: ${schemaPath}`);
    }

    const fullCommand = `npx prisma ${command} --schema ${schemaPath}`;    console.log(`Executing: ${fullCommand}`);
    
    try {
        const { stdout, stderr } = await execPromise(fullCommand);
        console.log(`[${dbName}] ${stdout}`);
        if (stderr) console.error(`[${dbName}] Error: ${stderr}`);
    } catch (error: any) {
        console.error(`[${dbName}] Failed to execute command: ${error?.message || String(error)}`);
    }
}

// List command - Shows all available databases
program
    .command('list')
    .description('List all available databases')
    .action(() => {
        const dbs = getDatabaseDirs();
        if (dbs.length === 0) {
            console.log('No databases found in src/app/db');
            return;
        }

        console.log('Available databases:');
        dbs.forEach(db => console.log(` - ${db}`));
    });

// Generate command - Generates Prisma client
program
    .command('generate')
    .description('Generate Prisma client for one or all databases')
    .option('-d, --db <database>', 'Specific database to generate client for')
    .option('-a, --all', 'Generate for all databases (default)')
    .action(async (options) => {
        const dbs = options.db ? [options.db] : getDatabaseDirs();

        if (dbs.length === 0) {
            console.log('No databases found to generate');
            return;
        }

        console.log(`Generating Prisma client for ${options.db ? `database: ${options.db}` : 'all databases'}`);

        for (const db of dbs) {
            try {
                await executePrismaCommand(db, 'generate');

                

                console.log(`✅ Generated client for ${db}`);
            } catch (error: any) {
                console.error(`❌ Failed to generate client for ${db}: ${error?.message || String(error)}`);
            }
        }
    });

// Migrate command - Handles Prisma migrations
program
    .command('migrate')
    .description('Manage Prisma migrations')
    .option('-d, --db <database>', 'Specific database to run migration for')
    .option('-a, --all', 'Run migration for all databases')
    .option('-n, --name <name>', 'Name for the migration (required for dev)')    .requiredOption('-t, --type <type>', 'Migration type: dev, deploy, reset, status, diff, resolve, push')
    .option('--create-only', 'Create migration file without applying (for dev)')
    .option('--from-empty', 'Generate diff from empty state (for diff)')
    .option('--to-schema-datamodel <file>', 'Target schema file for diff comparison')
    .option('--from-local-db', 'Use local database as source for diff')
    .option('--to-local-db', 'Use local database as target for diff')
    .option('--script', 'Output executable script instead of migration (for diff)')
    .option('--accept-data-loss', 'Accept data loss during push operation')
    .option('--force-reset', 'Force reset the database before push')
    .option('--skip-generate', 'Skip generating Prisma client after operation')
    .action(async (options) => {        if (!['dev', 'deploy', 'reset', 'status', 'diff', 'resolve', 'push'].includes(options.type)) {
            console.error('Invalid migration type. Must be one of: dev, deploy, reset, status, diff, resolve, push');
            return;
        }

        const dbs = options.db ? [options.db] : (options.all ? getDatabaseDirs() : []);

        if (dbs.length === 0) {
            console.error('Please specify a database with --db or use --all flag');
            return;
        }        // Special handling for dangerous operations
        if (DANGEROUS_OPERATIONS.includes(options.type)) {
            const confirmed = await checkSecurityConfirmation(options.type);
            if (!confirmed) {
                console.log('🚫 Operation cancelled by user.');
                return;
            }
        }

        // Special handling for reset command
        if (options.type === 'reset') {
            console.log(`⚠️  WARNING: This will reset the database and delete ALL data!`);
            console.log(`🔄 Resetting database for ${options.db ? `database: ${options.db}` : 'all databases'}`);
            
            for (const db of dbs) {
                try {
                    await executePrismaCommand(db, 'migrate reset --force');
                    console.log(`✅ Database reset completed for ${db}`);
                    console.log(`   📁 All migrations have been reapplied`);
                    console.log(`   🚀 You can now continue with development`);
                } catch (error: any) {
                    console.error(`❌ Database reset failed for ${db}: ${error?.message || String(error)}`);
                }
            }
            return;
        }

        // Validation for dev migrations
        if (options.type === 'dev' && !options.name) {
            console.error('Migration name is required for dev migrations. Use --name flag');
            return;
        }        // Validation for diff command
        if (options.type === 'diff') {
            if (!options.fromEmpty && !options.toSchemaDatamodel && !options.fromLocalDb && !options.toLocalDb) {
                console.error('For diff command, use one of: --from-empty, --to-schema-datamodel, --from-local-db, --to-local-db');
                return;
            }
        }

        // Build migration command based on type and options
        let migrationCommand: string;
          switch (options.type) {
            case 'dev':
                migrationCommand = `migrate dev --name ${options.name}${options.createOnly ? ' --create-only' : ''}`;
                break;
            case 'reset':
                migrationCommand = 'migrate reset --force';
                break;            case 'diff':
                let diffOptions = '';
                if (options.fromEmpty) {
                    diffOptions = '--from-empty --to-schema-datamodel';
                } else if (options.toSchemaDatamodel) {
                    diffOptions = `--to-schema-datamodel ${options.toSchemaDatamodel}`;
                } else if (options.fromLocalDb) {
                    diffOptions = '--from-local-db --to-schema-datamodel';
                } else if (options.toLocalDb) {
                    diffOptions = '--from-schema-datamodel --to-local-db';
                }
                
                if (options.script) diffOptions += ' --script';
                if (options.exitCode) diffOptions += ' --exit-code';
                
                migrationCommand = `migrate diff ${diffOptions}`;
                break;
            case 'push':
                migrationCommand = 'db push';
                if (options.acceptDataLoss) migrationCommand += ' --accept-data-loss';
                if (options.forceReset) migrationCommand += ' --force-reset';
                if (options.skipGenerate) migrationCommand += ' --skip-generate';
                break;
            default:
                migrationCommand = `migrate ${options.type}`;
        }

        console.log(`🔄 Running migration '${options.type}' for ${options.db ? `database: ${options.db}` : 'all databases'}`);

        for (const db of dbs) {
            try {
                await executePrismaCommand(db, migrationCommand);
                console.log(`✅ Migration '${options.type}' completed for ${db}`);
                
                // Additional info for specific commands
                if (options.type === 'dev' && options.createOnly) {
                    console.log(`   📝 Migration file created but not applied. Review and apply with:`);
                    console.log(`      kusto-db migrate -d ${db} -t dev -n "continue_${options.name}"`);
                } else if (options.type === 'status') {
                    console.log(`   📊 Check migration status above for ${db}`);
                }
            } catch (error: any) {
                console.error(`❌ Migration failed for ${db}: ${error?.message || String(error)}`);
            }
        }
    });

// DB Pull command - Pull schema from database (DANGEROUS - overwrites schema)
program
    .command('pull')
    .description('Pull schema from database to update Prisma schema (DANGEROUS - overwrites current schema)')
    .option('-d, --db <database>', 'Specific database to pull schema from')
    .option('-a, --all', 'Pull schema for all databases')
    .option('--force', 'Force pull even if schema changes would be lost')
    .option('--print', 'Print the schema instead of writing to file')
    .action(async (options) => {
        // Security confirmation required
        const confirmed = await checkSecurityConfirmation('pull');
        if (!confirmed) {
            console.log('🚫 Operation cancelled by user.');
            return;
        }

        const dbs = options.db ? [options.db] : (options.all ? getDatabaseDirs() : []);

        if (dbs.length === 0) {
            console.error('Please specify a database with --db or use --all flag');
            return;
        }

        console.log(`⚠️  WARNING: This will overwrite your current Prisma schema!`);
        console.log(`📥 Pulling schema from database for ${options.db ? `database: ${options.db}` : 'all databases'}`);

        for (const db of dbs) {
            try {
                let pullCommand = 'db pull';
                if (options.force) pullCommand += ' --force';
                if (options.print) pullCommand += ' --print';

                await executePrismaCommand(db, pullCommand);
                console.log(`✅ Schema pull completed for ${db}`);
                console.log(`   📝 Prisma schema has been updated`);
                console.log(`   🔄 You may need to regenerate the client: kusto-db generate -d ${db}`);
            } catch (error: any) {
                console.error(`❌ Schema pull failed for ${db}: ${error?.message || String(error)}`);
            }
        }
    });

// DB Push command - Push schema changes to database (DANGEROUS)
program
    .command('push')
    .description('Push Prisma schema changes to database (DANGEROUS - can cause data loss)')
    .option('-d, --db <database>', 'Specific database to push schema to')
    .option('-a, --all', 'Push schema for all databases')
    .option('--accept-data-loss', 'Accept data loss during push')
    .option('--force-reset', 'Force reset the database before push')
    .option('--skip-generate', 'Skip generating Prisma client after push')
    .action(async (options) => {
        // Security confirmation required
        const confirmed = await checkSecurityConfirmation('push');
        if (!confirmed) {
            console.log('🚫 Operation cancelled by user.');
            return;
        }

        const dbs = options.db ? [options.db] : (options.all ? getDatabaseDirs() : []);

        if (dbs.length === 0) {
            console.error('Please specify a database with --db or use --all flag');
            return;
        }

        console.log(`⚠️  WARNING: This may cause data loss in your database!`);
        console.log(`📤 Pushing schema to database for ${options.db ? `database: ${options.db}` : 'all databases'}`);

        for (const db of dbs) {
            try {
                let pushCommand = 'db push';
                if (options.acceptDataLoss) pushCommand += ' --accept-data-loss';
                if (options.forceReset) pushCommand += ' --force-reset';
                if (options.skipGenerate) pushCommand += ' --skip-generate';

                await executePrismaCommand(db, pushCommand);
                console.log(`✅ Schema push completed for ${db}`);
                console.log(`   💾 Database schema has been updated`);
                if (!options.skipGenerate) {
                    console.log(`   🔄 Prisma client has been regenerated`);
                }
            } catch (error: any) {
                console.error(`❌ Schema push failed for ${db}: ${error?.message || String(error)}`);
            }
        }
    });

// DB Seed command - Run database seeding
program
    .command('seed')
    .description('Run database seeding scripts')
    .option('-d, --db <database>', 'Specific database to seed')
    .option('-a, --all', 'Seed all databases')
    .action(async (options) => {
        const dbs = options.db ? [options.db] : (options.all ? getDatabaseDirs() : []);

        if (dbs.length === 0) {
            console.error('Please specify a database with --db or use --all flag');
            return;
        }

        console.log(`🌱 Running database seed for ${options.db ? `database: ${options.db}` : 'all databases'}`);

        for (const db of dbs) {
            try {
                await executePrismaCommand(db, 'db seed');
                console.log(`✅ Database seeding completed for ${db}`);
            } catch (error: any) {
                console.error(`❌ Database seeding failed for ${db}: ${error?.message || String(error)}`);
            }
        }
    });

// DB Execute command - Execute raw SQL commands
program
    .command('execute')
    .description('Execute raw SQL commands against database')
    .option('-d, --db <database>', 'Specific database to execute against')
    .option('-f, --file <file>', 'SQL file to execute')
    .option('-c, --command <command>', 'SQL command to execute')
    .action(async (options) => {
        if (!options.db) {
            console.error('Database must be specified with --db flag');
            return;
        }

        if (!options.file && !options.command) {
            console.error('Either --file or --command must be specified');
            return;
        }

        console.log(`🗃️  Executing SQL against database: ${options.db}`);

        try {
            let executeCommand = 'db execute';
            if (options.file) executeCommand += ` --file ${options.file}`;
            if (options.command) executeCommand += ` --stdin`;

            if (options.command) {
                // For stdin commands, we need to pipe the command
                const fullCommand = `echo "${options.command}" | npx prisma ${executeCommand} --schema ${getSchemaPath(options.db)}`;
                console.log(`Executing: ${fullCommand}`);
                const { stdout, stderr } = await execPromise(fullCommand);
                console.log(`[${options.db}] ${stdout}`);
                if (stderr) console.error(`[${options.db}] Error: ${stderr}`);
            } else {
                await executePrismaCommand(options.db, executeCommand);
            }
            
            console.log(`✅ SQL execution completed for ${options.db}`);
        } catch (error: any) {
            console.error(`❌ SQL execution failed for ${options.db}: ${error?.message || String(error)}`);
        }
    });

// Validate command - Validate Prisma schema
program
    .command('validate')
    .description('Validate Prisma schema files')
    .option('-d, --db <database>', 'Specific database to validate')
    .option('-a, --all', 'Validate all databases (default)')
    .action(async (options) => {
        const dbs = options.db ? [options.db] : getDatabaseDirs();

        if (dbs.length === 0) {
            console.log('No databases found to validate');
            return;
        }

        console.log(`🔍 Validating Prisma schema for ${options.db ? `database: ${options.db}` : 'all databases'}`);

        for (const db of dbs) {
            try {
                await executePrismaCommand(db, 'validate');
                console.log(`✅ Schema validation passed for ${db}`);
            } catch (error: any) {
                console.error(`❌ Schema validation failed for ${db}: ${error?.message || String(error)}`);
            }
        }
    });

// Version command - Show Prisma version
program
    .command('version')
    .description('Show Prisma CLI version information')
    .action(async () => {
        try {
            console.log('📦 Prisma Version Information:');
            const { stdout } = await execPromise('npx prisma version');
            console.log(stdout);
        } catch (error: any) {
            console.error(`❌ Failed to get version information: ${error?.message || String(error)}`);
        }
    });

// Debug command - Show debug information
program
    .command('debug')
    .description('Show debug information for troubleshooting')
    .option('-d, --db <database>', 'Show debug info for specific database')
    .action(async (options) => {
        console.log('🔧 Debug Information:');
        console.log('');
        
        // Environment info
        console.log('📋 Environment:');
        console.log(`   Node.js: ${process.version}`);
        console.log(`   Platform: ${process.platform}`);
        console.log(`   Architecture: ${process.arch}`);
        console.log(`   Working Directory: ${process.cwd()}`);
        console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
        console.log('');

        // Database info
        console.log('🗄️  Databases:');
        const dbs = getDatabaseDirs();
        if (dbs.length === 0) {
            console.log('   No databases found');
        } else {
            dbs.forEach(db => {
                console.log(`   - ${db}`);
                const schemaPath = getSchemaPath(db);
                console.log(`     Schema: ${fs.existsSync(schemaPath) ? '✅ Found' : '❌ Missing'}`);
                
                // Check for migrations
                const migrationsPath = path.join(path.dirname(schemaPath), 'migrations');
                const migrationsExist = fs.existsSync(migrationsPath);
                console.log(`     Migrations: ${migrationsExist ? '✅ Found' : '❌ Missing'}`);
                
                if (migrationsExist) {
                    const migrations = fs.readdirSync(migrationsPath).filter(f => f !== 'migration_lock.toml');
                    console.log(`     Migration count: ${migrations.length}`);
                }
            });
        }
        console.log('');

        // Prisma version
        try {
            console.log('🔍 Prisma CLI:');
            const { stdout } = await execPromise('npx prisma version');
            console.log(stdout);
        } catch (error) {
            console.log('❌ Prisma CLI not available');
        }

        // Specific database debug
        if (options.db) {
            console.log(`🔍 Database Debug: ${options.db}`);
            const schemaPath = getSchemaPath(options.db);
            
            if (fs.existsSync(schemaPath)) {
                try {
                    await executePrismaCommand(options.db, 'validate');
                    console.log('✅ Schema is valid');
                } catch (error) {
                    console.log('❌ Schema validation failed');
                }
            } else {
                console.log('❌ Schema file not found');
            }
        }
    });

// Help command - Show detailed usage examples and documentation
program
    .command('help')
    .description('Show detailed usage examples and documentation')
    .option('-l, --lang <language>', 'Language for help (en|ko)', 'en')
    .option('-c, --command <command>', 'Show help for specific command')
    .action((options) => {
        const lang = options.lang === 'ko' ? 'ko' : 'en';
        
        if (options.command) {
            showCommandHelp(options.command, lang);
        } else {
            showGeneralHelp(lang);
        }
    });

/**
 * Show general help with all commands
 */
function showGeneralHelp(lang: 'en' | 'ko') {
    const help = {
        en: {
            title: '🚀 Kusto-DB CLI - Complete Usage Guide',
            subtitle: 'CLI tool for managing Prisma databases in express.js-kusto project',
            commands: 'Available Commands:',
            examples: 'Quick Examples:',
            moreHelp: 'For detailed help on specific commands, use:',            availableCommands: [
                { cmd: 'list', desc: 'List all available databases' },
                { cmd: 'generate', desc: 'Generate Prisma client for databases' },
                { cmd: 'migrate', desc: 'Manage Prisma migrations (dev, deploy, reset, status, diff, resolve, push)' },
                { cmd: 'pull', desc: 'Pull schema from database (DANGEROUS - requires confirmation)' },
                { cmd: 'push', desc: 'Push schema changes to database (DANGEROUS - requires confirmation)' },
                { cmd: 'seed', desc: 'Run database seeding scripts' },
                { cmd: 'execute', desc: 'Execute raw SQL commands against database' },
                { cmd: 'validate', desc: 'Validate Prisma schema files' },
                { cmd: 'studio', desc: 'Open Prisma Studio for database management' },
                { cmd: 'format', desc: 'Format Prisma schema files' },
                { cmd: 'version', desc: 'Show Prisma CLI version information' },
                { cmd: 'debug', desc: 'Show debug information for troubleshooting' },
                { cmd: 'help', desc: 'Show this help or help for specific commands' }
            ],            quickExamples: [
                'kusto-db list                              # Show all databases',
                'kusto-db migrate -d testdb1 -t dev -n "initial_migration"  # Create first migration',
                'kusto-db migrate -d testdb1 -t status     # Check migration status',
                'kusto-db pull -d testdb1                  # Pull schema from database (DANGEROUS)',
                'kusto-db push -d testdb1                  # Push schema to database (DANGEROUS)',
                'kusto-db seed -d testdb1                  # Run database seeding',
                'kusto-db execute -d testdb1 -c "SELECT * FROM users"  # Execute SQL',
                'kusto-db validate -a                      # Validate all schemas',
                'kusto-db generate -a                      # Generate all clients',
                'kusto-db studio -d testdb1                # Open database studio',
                'kusto-db version                          # Show Prisma version',
                'kusto-db debug -d testdb1                 # Show debug information'
            ]
        },
        ko: {
            title: '🚀 Kusto-DB CLI - 완전한 사용 가이드',
            subtitle: 'express.js-kusto 프로젝트의 Prisma 데이터베이스 관리 CLI 도구',
            commands: '사용 가능한 명령어:',
            examples: '빠른 예시:',
            moreHelp: '특정 명령어의 자세한 도움말을 보려면:',            availableCommands: [
                { cmd: 'list', desc: '사용 가능한 모든 데이터베이스 목록 표시' },
                { cmd: 'generate', desc: '데이터베이스용 Prisma 클라이언트 생성' },
                { cmd: 'migrate', desc: 'Prisma 마이그레이션 관리 (dev, deploy, reset, status, diff, resolve, push)' },
                { cmd: 'pull', desc: '데이터베이스에서 스키마 가져오기 (위험 - 확인 필요)' },
                { cmd: 'push', desc: '스키마 변경사항을 데이터베이스에 푸시 (위험 - 확인 필요)' },
                { cmd: 'seed', desc: '데이터베이스 시딩 스크립트 실행' },
                { cmd: 'execute', desc: '데이터베이스에 대해 원시 SQL 명령 실행' },
                { cmd: 'validate', desc: 'Prisma 스키마 파일 검증' },
                { cmd: 'studio', desc: '데이터베이스 관리용 Prisma Studio 열기' },
                { cmd: 'format', desc: 'Prisma 스키마 파일 포맷팅' },
                { cmd: 'version', desc: 'Prisma CLI 버전 정보 표시' },
                { cmd: 'debug', desc: '문제 해결을 위한 디버그 정보 표시' },
                { cmd: 'help', desc: '이 도움말 또는 특정 명령어 도움말 표시' }
            ],            quickExamples: [
                'kusto-db list                              # 모든 데이터베이스 표시',
                'kusto-db migrate -d testdb1 -t dev -n "initial_migration"  # 첫 번째 마이그레이션 생성',
                'kusto-db migrate -d testdb1 -t status     # 마이그레이션 상태 확인',
                'kusto-db pull -d testdb1                  # 데이터베이스에서 스키마 가져오기 (위험)',
                'kusto-db push -d testdb1                  # 스키마를 데이터베이스에 푸시 (위험)',
                'kusto-db seed -d testdb1                  # 데이터베이스 시딩 실행',
                'kusto-db execute -d testdb1 -c "SELECT * FROM users"  # SQL 실행',
                'kusto-db validate -a                      # 모든 스키마 검증',
                'kusto-db generate -a                      # 모든 클라이언트 생성',
                'kusto-db studio -d testdb1                # 데이터베이스 스튜디오 열기',
                'kusto-db version                          # Prisma 버전 표시',
                'kusto-db debug -d testdb1                 # 디버그 정보 표시'
            ]
        }
    };

    const h = help[lang];
    
    console.log(`\n${h.title}`);
    console.log(`${h.subtitle}\n`);
    
    console.log(`📚 ${h.commands}`);
    h.availableCommands.forEach(cmd => {
        console.log(`  ${cmd.cmd.padEnd(12)} - ${cmd.desc}`);
    });
    
    console.log(`\n⚡ ${h.examples}`);
    h.quickExamples.forEach(example => {
        console.log(`  ${example}`);
    });
    
    console.log(`\n💡 ${h.moreHelp}`);
    console.log(`  kusto-db help -c <command> [--lang ko]`);
    console.log(`  kusto-db help --lang ko                 # Korean help`);
    console.log('');
}

/**
 * Show help for specific command
 */
function showCommandHelp(command: string, lang: 'en' | 'ko') {
    const commandHelp = {
        en: {
            list: {
                title: '📋 List Command',
                description: 'Lists all available databases in src/app/db directory',
                usage: 'Usage: kusto-db list',
                examples: [
                    'kusto-db list                    # Show all databases'
                ]
            },
            generate: {
                title: '🔧 Generate Command',
                description: 'Generate Prisma client for one or all databases',
                usage: 'Usage: kusto-db generate [options]',
                options: [
                    '-d, --db <database>    Generate for specific database',
                    '-a, --all             Generate for all databases (default)'
                ],
                examples: [
                    'kusto-db generate -d testdb1     # Generate for testdb1 only',
                    'kusto-db generate -a             # Generate for all databases',
                    'kusto-db generate                # Same as --all'
                ]
            },
            migrate: {
                title: '🔄 Migrate Command',
                description: 'Manage Prisma migrations with various operations',
                usage: 'Usage: kusto-db migrate [options]',
                options: [
                    '-d, --db <database>           Target specific database',
                    '-a, --all                     Target all databases',
                    '-t, --type <type>             Migration type (init|dev|deploy|reset|status|diff)',
                    '-n, --name <name>             Migration name (required for dev)',
                    '--create-only                 Create migration without applying (dev only)',
                    '--from-empty                  Generate diff from empty state',
                    '--to-schema-datamodel <file>  Target schema for diff comparison'
                ],
                examples: [
                    'kusto-db migrate -d testdb1 -t init                    # Initialize migrations',
                    'kusto-db migrate -d testdb1 -t dev -n "add_users"      # Create and apply migration',
                    'kusto-db migrate -d testdb1 -t dev -n "test" --create-only  # Create only',
                    'kusto-db migrate -a -t deploy                         # Deploy all databases',
                    'kusto-db migrate -d testdb1 -t status                 # Check migration status',
                    'kusto-db migrate -d testdb1 -t reset                  # Reset database (dev only)',
                    'kusto-db migrate -d testdb1 -t diff --from-empty      # Show schema diff'
                ]
            },
            studio: {
                title: '🖥️ Studio Command',
                description: 'Open Prisma Studio for database management and data viewing',
                usage: 'Usage: kusto-db studio -d <database>',
                options: [
                    '-d, --db <database>    Database to open in Prisma Studio (required)'
                ],
                examples: [
                    'kusto-db studio -d testdb1       # Open Prisma Studio for testdb1',
                    'kusto-db studio -d testdb2       # Open Prisma Studio for testdb2'
                ]
            },
            format: {
                title: '🎨 Format Command',
                description: 'Format Prisma schema files to ensure consistent formatting',
                usage: 'Usage: kusto-db format [options]',
                options: [
                    '-d, --db <database>    Format specific database schema',
                    '-a, --all             Format all database schemas (default)'
                ],
                examples: [
                    'kusto-db format -d testdb1       # Format testdb1 schema only',
                    'kusto-db format -a               # Format all schemas',                    'kusto-db format                  # Same as --all'
                ]
            },
            pull: {
                title: '📥 Pull Command (DANGEROUS)',
                description: 'Pull schema from database to update Prisma schema. This overwrites your current schema!',
                usage: 'Usage: kusto-db pull [options]',
                options: [
                    '-d, --db <database>    Pull schema for specific database',
                    '-a, --all             Pull schema for all databases',
                    '--force               Force pull even if schema changes would be lost',
                    '--print               Print the schema instead of writing to file'
                ],
                examples: [
                    'kusto-db pull -d testdb1         # Pull schema from testdb1 (requires confirmation)',
                    'kusto-db pull -a                 # Pull schema for all databases',
                    'kusto-db pull -d testdb1 --print # Show schema without writing to file',
                    'kusto-db pull -d testdb1 --force # Force pull without additional warnings'
                ],
                warning: '🚨 This command requires double security confirmation as it overwrites your schema!'
            },
            push: {
                title: '📤 Push Command (DANGEROUS)',
                description: 'Push Prisma schema changes to database. This can cause data loss!',
                usage: 'Usage: kusto-db push [options]',
                options: [
                    '-d, --db <database>        Push schema for specific database',
                    '-a, --all                 Push schema for all databases',
                    '--accept-data-loss        Accept data loss during push',
                    '--force-reset             Force reset the database before push',
                    '--skip-generate           Skip generating Prisma client after push'
                ],
                examples: [
                    'kusto-db push -d testdb1                    # Push schema to testdb1 (requires confirmation)',
                    'kusto-db push -a                           # Push schema for all databases',
                    'kusto-db push -d testdb1 --accept-data-loss # Push accepting potential data loss',
                    'kusto-db push -d testdb1 --skip-generate   # Push without regenerating client'
                ],
                warning: '🚨 This command requires double security confirmation as it can cause data loss!'
            },
            seed: {
                title: '🌱 Seed Command',
                description: 'Run database seeding scripts to populate database with initial data',
                usage: 'Usage: kusto-db seed [options]',
                options: [
                    '-d, --db <database>    Seed specific database',
                    '-a, --all             Seed all databases'
                ],
                examples: [
                    'kusto-db seed -d testdb1         # Run seeding for testdb1',
                    'kusto-db seed -a                 # Run seeding for all databases'
                ]
            },
            execute: {
                title: '🗃️ Execute Command',
                description: 'Execute raw SQL commands against database',
                usage: 'Usage: kusto-db execute [options]',
                options: [
                    '-d, --db <database>       Target database (required)',
                    '-f, --file <file>         SQL file to execute',
                    '-c, --command <command>   SQL command to execute'
                ],
                examples: [
                    'kusto-db execute -d testdb1 -c "SELECT * FROM users"     # Execute SQL command',
                    'kusto-db execute -d testdb1 -f ./scripts/cleanup.sql     # Execute SQL file',
                    'kusto-db execute -d testdb1 -c "UPDATE users SET active = true"  # Update query'
                ]
            },
            validate: {
                title: '🔍 Validate Command',
                description: 'Validate Prisma schema files for syntax and consistency',
                usage: 'Usage: kusto-db validate [options]',
                options: [
                    '-d, --db <database>    Validate specific database schema',
                    '-a, --all             Validate all database schemas (default)'
                ],
                examples: [
                    'kusto-db validate -d testdb1     # Validate testdb1 schema only',
                    'kusto-db validate -a             # Validate all schemas',
                    'kusto-db validate                # Same as --all'
                ]
            },
            version: {
                title: '📦 Version Command',
                description: 'Show Prisma CLI version information',
                usage: 'Usage: kusto-db version',
                examples: [
                    'kusto-db version                 # Show Prisma CLI version info'
                ]
            },
            debug: {
                title: '🔧 Debug Command',
                description: 'Show debug information for troubleshooting',
                usage: 'Usage: kusto-db debug [options]',
                options: [
                    '-d, --db <database>    Show debug info for specific database'
                ],
                examples: [
                    'kusto-db debug                   # Show general debug information',
                    'kusto-db debug -d testdb1        # Show debug info for testdb1'
                ]
            },
            help: {
                title: '❓ Help Command',
                description: 'Show usage information and examples for commands',
                usage: 'Usage: kusto-db help [options]',
                options: [
                    '-l, --lang <language>     Language for help (en|ko, default: en)',
                    '-c, --command <command>   Show help for specific command'
                ],
                examples: [
                    'kusto-db help                    # Show general help in English',
                    'kusto-db help --lang ko          # Show general help in Korean',
                    'kusto-db help -c migrate         # Show migrate command help',
                    'kusto-db help -c migrate --lang ko  # Show migrate help in Korean'
                ]
            }
        },
        ko: {
            list: {
                title: '📋 List 명령어',
                description: 'src/app/db 디렉토리의 모든 사용 가능한 데이터베이스를 나열합니다',
                usage: '사용법: kusto-db list',
                examples: [
                    'kusto-db list                    # 모든 데이터베이스 표시'
                ]
            },
            generate: {
                title: '🔧 Generate 명령어',
                description: '하나 또는 모든 데이터베이스용 Prisma 클라이언트를 생성합니다',
                usage: '사용법: kusto-db generate [옵션]',
                options: [
                    '-d, --db <database>    특정 데이터베이스용 생성',
                    '-a, --all             모든 데이터베이스용 생성 (기본값)'
                ],
                examples: [
                    'kusto-db generate -d testdb1     # testdb1만 생성',
                    'kusto-db generate -a             # 모든 데이터베이스 생성',
                    'kusto-db generate                # --all과 동일'
                ]
            },
            migrate: {
                title: '🔄 Migrate 명령어',
                description: '다양한 작업으로 Prisma 마이그레이션을 관리합니다',
                usage: '사용법: kusto-db migrate [옵션]',
                options: [
                    '-d, --db <database>           특정 데이터베이스 대상',
                    '-a, --all                     모든 데이터베이스 대상',
                    '-t, --type <type>             마이그레이션 타입 (init|dev|deploy|reset|status|diff)',
                    '-n, --name <name>             마이그레이션 이름 (dev에 필수)',
                    '--create-only                 적용하지 않고 마이그레이션만 생성 (dev만)',
                    '--from-empty                  빈 상태부터 차이점 생성',
                    '--to-schema-datamodel <file>  차이점 비교용 대상 스키마'
                ],
                examples: [
                    'kusto-db migrate -d testdb1 -t init                    # 마이그레이션 초기화',
                    'kusto-db migrate -d testdb1 -t dev -n "add_users"      # 마이그레이션 생성 및 적용',
                    'kusto-db migrate -d testdb1 -t dev -n "test" --create-only  # 생성만',
                    'kusto-db migrate -a -t deploy                         # 모든 데이터베이스 배포',
                    'kusto-db migrate -d testdb1 -t status                 # 마이그레이션 상태 확인',
                    'kusto-db migrate -d testdb1 -t reset                  # 데이터베이스 리셋 (개발만)',
                    'kusto-db migrate -d testdb1 -t diff --from-empty      # 스키마 차이점 표시'
                ]
            },
            studio: {
                title: '🖥️ Studio 명령어',
                description: '데이터베이스 관리 및 데이터 보기를 위한 Prisma Studio를 엽니다',
                usage: '사용법: kusto-db studio -d <database>',
                options: [
                    '-d, --db <database>    Prisma Studio에서 열 데이터베이스 (필수)'
                ],
                examples: [
                    'kusto-db studio -d testdb1       # testdb1용 Prisma Studio 열기',
                    'kusto-db studio -d testdb2       # testdb2용 Prisma Studio 열기'
                ]
            },
            format: {
                title: '🎨 Format 명령어',
                description: '일관된 포맷팅을 위해 Prisma 스키마 파일을 포맷합니다',
                usage: '사용법: kusto-db format [옵션]',
                options: [
                    '-d, --db <database>    특정 데이터베이스 스키마 포맷',
                    '-a, --all             모든 데이터베이스 스키마 포맷 (기본값)'
                ],
                examples: [
                    'kusto-db format -d testdb1       # testdb1 스키마만 포맷',
                    'kusto-db format -a               # 모든 스키마 포맷',                    'kusto-db format                  # --all과 동일'
                ]
            },
            pull: {
                title: '📥 Pull 명령어 (위험)',
                description: 'Prisma 스키마를 업데이트하기 위해 데이터베이스에서 스키마를 가져옵니다. 현재 스키마를 덮어씁니다!',
                usage: '사용법: kusto-db pull [옵션]',
                options: [
                    '-d, --db <database>    특정 데이터베이스 스키마 가져오기',
                    '-a, --all             모든 데이터베이스 스키마 가져오기',
                    '--force               스키마 변경사항이 손실되어도 강제 가져오기',
                    '--print               파일에 쓰지 않고 스키마만 출력'
                ],
                examples: [
                    'kusto-db pull -d testdb1         # testdb1에서 스키마 가져오기 (확인 필요)',
                    'kusto-db pull -a                 # 모든 데이터베이스 스키마 가져오기',
                    'kusto-db pull -d testdb1 --print # 파일에 쓰지 않고 스키마만 표시',
                    'kusto-db pull -d testdb1 --force # 추가 경고 없이 강제 가져오기'
                ],
                warning: '🚨 이 명령어는 스키마를 덮어쓰므로 이중 보안 확인이 필요합니다!'
            },
            push: {
                title: '📤 Push 명령어 (위험)',
                description: 'Prisma 스키마 변경사항을 데이터베이스에 푸시합니다. 데이터 손실이 발생할 수 있습니다!',
                usage: '사용법: kusto-db push [옵션]',
                options: [
                    '-d, --db <database>        특정 데이터베이스에 스키마 푸시',
                    '-a, --all                 모든 데이터베이스에 스키마 푸시',
                    '--accept-data-loss        푸시 중 데이터 손실 허용',
                    '--force-reset             푸시 전 데이터베이스 강제 리셋',
                    '--skip-generate           푸시 후 Prisma 클라이언트 생성 건너뛰기'
                ],
                examples: [
                    'kusto-db push -d testdb1                    # testdb1에 스키마 푸시 (확인 필요)',
                    'kusto-db push -a                           # 모든 데이터베이스에 스키마 푸시',
                    'kusto-db push -d testdb1 --accept-data-loss # 잠재적 데이터 손실 허용하고 푸시',
                    'kusto-db push -d testdb1 --skip-generate   # 클라이언트 재생성 없이 푸시'
                ],
                warning: '🚨 이 명령어는 데이터 손실을 야기할 수 있으므로 이중 보안 확인이 필요합니다!'
            },
            seed: {
                title: '🌱 Seed 명령어',
                description: '초기 데이터로 데이터베이스를 채우기 위해 데이터베이스 시딩 스크립트를 실행합니다',
                usage: '사용법: kusto-db seed [옵션]',
                options: [
                    '-d, --db <database>    특정 데이터베이스 시딩',
                    '-a, --all             모든 데이터베이스 시딩'
                ],
                examples: [
                    'kusto-db seed -d testdb1         # testdb1 시딩 실행',
                    'kusto-db seed -a                 # 모든 데이터베이스 시딩 실행'
                ]
            },
            execute: {
                title: '🗃️ Execute 명령어',
                description: '데이터베이스에 대해 원시 SQL 명령을 실행합니다',
                usage: '사용법: kusto-db execute [옵션]',
                options: [
                    '-d, --db <database>       대상 데이터베이스 (필수)',
                    '-f, --file <file>         실행할 SQL 파일',
                    '-c, --command <command>   실행할 SQL 명령'
                ],
                examples: [
                    'kusto-db execute -d testdb1 -c "SELECT * FROM users"     # SQL 명령 실행',
                    'kusto-db execute -d testdb1 -f ./scripts/cleanup.sql     # SQL 파일 실행',
                    'kusto-db execute -d testdb1 -c "UPDATE users SET active = true"  # 업데이트 쿼리'
                ]
            },
            validate: {
                title: '🔍 Validate 명령어',
                description: '구문과 일관성을 위해 Prisma 스키마 파일을 검증합니다',
                usage: '사용법: kusto-db validate [옵션]',
                options: [
                    '-d, --db <database>    특정 데이터베이스 스키마 검증',
                    '-a, --all             모든 데이터베이스 스키마 검증 (기본값)'
                ],
                examples: [
                    'kusto-db validate -d testdb1     # testdb1 스키마만 검증',
                    'kusto-db validate -a             # 모든 스키마 검증',
                    'kusto-db validate                # --all과 동일'
                ]
            },
            version: {
                title: '📦 Version 명령어',
                description: 'Prisma CLI 버전 정보를 표시합니다',
                usage: '사용법: kusto-db version',
                examples: [
                    'kusto-db version                 # Prisma CLI 버전 정보 표시'
                ]
            },
            debug: {
                title: '🔧 Debug 명령어',
                description: '문제 해결을 위한 디버그 정보를 표시합니다',
                usage: '사용법: kusto-db debug [옵션]',
                options: [
                    '-d, --db <database>    특정 데이터베이스의 디버그 정보 표시'
                ],
                examples: [
                    'kusto-db debug                   # 일반 디버그 정보 표시',
                    'kusto-db debug -d testdb1        # testdb1의 디버그 정보 표시'
                ]
            },
            help: {
                title: '❓ Help 명령어',
                description: '명령어의 사용 정보와 예시를 표시합니다',
                usage: '사용법: kusto-db help [옵션]',
                options: [
                    '-l, --lang <language>     도움말 언어 (en|ko, 기본값: en)',
                    '-c, --command <command>   특정 명령어 도움말 표시'
                ],
                examples: [
                    'kusto-db help                    # 영어로 일반 도움말 표시',
                    'kusto-db help --lang ko          # 한국어로 일반 도움말 표시',
                    'kusto-db help -c migrate         # migrate 명령어 도움말 표시',
                    'kusto-db help -c migrate --lang ko  # 한국어로 migrate 도움말 표시'
                ]
            }
        }
    };    const helpData = (commandHelp as any)[lang]?.[command];
    
    if (!helpData) {
        const errorMsg = lang === 'ko' 
            ? `❌ 알 수 없는 명령어: ${command}\n사용 가능한 명령어: list, generate, migrate, pull, push, seed, execute, validate, studio, format, version, debug, help`
            : `❌ Unknown command: ${command}\nAvailable commands: list, generate, migrate, pull, push, seed, execute, validate, studio, format, version, debug, help`;
        console.log(errorMsg);
        return;
    }

    console.log(`\n${helpData.title}`);
    console.log(`${helpData.description}\n`);
    
    // Show warning for dangerous commands
    if ('warning' in helpData && helpData.warning) {
        console.log(`${helpData.warning}\n`);
    }
    
    console.log(`📝 ${helpData.usage}`);
    
    if ('options' in helpData && helpData.options) {
        const optionsTitle = lang === 'ko' ? '⚙️ 옵션:' : '⚙️ Options:';
        console.log(`\n${optionsTitle}`);
        helpData.options.forEach((option: string) => {
            console.log(`  ${option}`);
        });
    }
    
    const examplesTitle = lang === 'ko' ? '💡 예시:' : '💡 Examples:';
    console.log(`\n${examplesTitle}`);
    helpData.examples.forEach((example: string) => {
        console.log(`  ${example}`);
    });
    console.log('');
}

// Parse arguments
program.parse(process.argv);

// Show help if no arguments provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}