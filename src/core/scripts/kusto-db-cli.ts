#!/usr/bin/env node
// filepath: r:\project\express.js-kusto\src\core\scripts\kusto-db-cli.ts

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import * as util from 'util';
import * as dotenv from 'dotenv';

const execPromise = util.promisify(exec);

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
    .option('-n, --name <name>', 'Name for the migration (required for dev)')    .requiredOption('-t, --type <type>', 'Migration type: dev, deploy, reset, status, diff, resolve')
    .option('--create-only', 'Create migration file without applying (for dev)')
    .option('--from-empty', 'Generate diff from empty state (for diff)')
    .option('--to-schema-datamodel <file>', 'Target schema file for diff comparison')
    .action(async (options) => {
        if (!['dev', 'deploy', 'reset', 'status', 'diff', 'resolve'].includes(options.type)) {
            console.error('Invalid migration type. Must be one of: dev, deploy, reset, status, diff, resolve');
            return;
        }

        const dbs = options.db ? [options.db] : (options.all ? getDatabaseDirs() : []);

        if (dbs.length === 0) {
            console.error('Please specify a database with --db or use --all flag');
            return;
        }        // Special handling for reset command
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
        }

        // Validation for diff command
        if (options.type === 'diff') {
            if (!options.fromEmpty && !options.toSchemaDatamodel) {
                console.error('For diff command, use either --from-empty or --to-schema-datamodel flag');
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
                break;
            case 'diff':
                if (options.fromEmpty) {
                    migrationCommand = 'migrate diff --from-empty --to-schema-datamodel';
                } else if (options.toSchemaDatamodel) {
                    migrationCommand = `migrate diff --to-schema-datamodel ${options.toSchemaDatamodel}`;
                } else {
                    migrationCommand = 'migrate diff';
                }
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

// Studio command - Opens Prisma Studio for a specific database
program
    .command('studio')
    .description('Open Prisma Studio for a database')
    .requiredOption('-d, --db <database>', 'Database to open in Prisma Studio')
    .action(async (options) => {
        try {
            await executePrismaCommand(options.db, 'studio');
        } catch (error: any) {
            console.error(`❌ Failed to open Prisma Studio: ${error?.message || String(error)}`);
        }
    });

// Format command - Format schema for one or all databases
program
    .command('format')
    .description('Format Prisma schema for one or all databases')
    .option('-d, --db <database>', 'Specific database to format schema for')
    .option('-a, --all', 'Format schemas for all databases (default)')
    .action(async (options) => {
        const dbs = options.db ? [options.db] : getDatabaseDirs();

        if (dbs.length === 0) {
            console.log('No databases found to format');
            return;
        }

        console.log(`Formatting Prisma schema for ${options.db ? `database: ${options.db}` : 'all databases'}`);

        for (const db of dbs) {
            try {
                await executePrismaCommand(db, 'format');
                console.log(`✅ Formatted schema for ${db}`);
            } catch (error: any) {
                console.error(`❌ Failed to format schema for ${db}: ${error?.message || String(error)}`);
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
            moreHelp: 'For detailed help on specific commands, use:',
            availableCommands: [
                { cmd: 'list', desc: 'List all available databases' },
                { cmd: 'generate', desc: 'Generate Prisma client for databases' },
                { cmd: 'migrate', desc: 'Manage Prisma migrations (dev, deploy, reset, status, diff, resolve)' },
                { cmd: 'studio', desc: 'Open Prisma Studio for database management' },
                { cmd: 'format', desc: 'Format Prisma schema files' },
                { cmd: 'help', desc: 'Show this help or help for specific commands' }
            ],            quickExamples: [
                'kusto-db list                              # Show all databases',
                'kusto-db migrate -d testdb1 -t dev -n "initial_migration"  # Create first migration',
                'kusto-db migrate -d testdb1 -t status     # Check migration status',
                'kusto-db generate -a                      # Generate all clients',
                'kusto-db studio -d testdb1                # Open database studio'
            ]
        },
        ko: {
            title: '🚀 Kusto-DB CLI - 완전한 사용 가이드',
            subtitle: 'express.js-kusto 프로젝트의 Prisma 데이터베이스 관리 CLI 도구',
            commands: '사용 가능한 명령어:',
            examples: '빠른 예시:',
            moreHelp: '특정 명령어의 자세한 도움말을 보려면:',
            availableCommands: [
                { cmd: 'list', desc: '사용 가능한 모든 데이터베이스 목록 표시' },
                { cmd: 'generate', desc: '데이터베이스용 Prisma 클라이언트 생성' },
                { cmd: 'migrate', desc: 'Prisma 마이그레이션 관리 (dev, deploy, reset, status, diff, resolve)' },
                { cmd: 'studio', desc: '데이터베이스 관리용 Prisma Studio 열기' },
                { cmd: 'format', desc: 'Prisma 스키마 파일 포맷팅' },
                { cmd: 'help', desc: '이 도움말 또는 특정 명령어 도움말 표시' }
            ],            quickExamples: [
                'kusto-db list                              # 모든 데이터베이스 표시',
                'kusto-db migrate -d testdb1 -t dev -n "initial_migration"  # 첫 번째 마이그레이션 생성',
                'kusto-db migrate -d testdb1 -t status     # 마이그레이션 상태 확인',
                'kusto-db generate -a                      # 모든 클라이언트 생성',
                'kusto-db studio -d testdb1                # 데이터베이스 스튜디오 열기'
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
                    'kusto-db format -a               # Format all schemas',
                    'kusto-db format                  # Same as --all'
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
                    'kusto-db format -a               # 모든 스키마 포맷',
                    'kusto-db format                  # --all과 동일'
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
            ? `❌ 알 수 없는 명령어: ${command}\n사용 가능한 명령어: list, generate, migrate, studio, format, help`
            : `❌ Unknown command: ${command}\nAvailable commands: list, generate, migrate, studio, format, help`;
        console.log(errorMsg);
        return;
    }

    console.log(`\n${helpData.title}`);
    console.log(`${helpData.description}\n`);
    
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