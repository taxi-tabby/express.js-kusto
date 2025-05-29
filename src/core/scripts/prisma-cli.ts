#!/usr/bin/env node

/**
 * 통합 Prisma 데이터베이스 관리 CLI
 * 
 * 기능:
 * - 다중 데이터베이스 관리 (db-cli-multi.ts)
 * - 자동 클라이언트 관리 (auto-client-cli.ts) 
 * - 기존 단일 DB 호환성 (db-cli.ts)
 * - src/core/db 시스템과 완전 통합
 */

import { program } from 'commander';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

// 핵심 모듈들
import { PrismaManager, clientManager, initializeAllClients, getAllClientNames, getAnyClient, printClientReport } from '../db';
import { databaseService } from '../db/service';

// PrismaManager 초기화를 위해 init.ts 실행
import '../../app/db/init';

const prismaManager = PrismaManager.getInstance();

// 유틸리티 함수들
class CLIUtils {
  /**
   * 기본 데이터베이스 이름 가져오기
   */
  static async getDefaultDatabase(): Promise<string> {
    const dbNames = prismaManager.getDatabaseNames();
    const autoNames = clientManager.getValidClients().map(c => c.name);
    const allNames = [...new Set([...dbNames, ...autoNames])];
    
    if (allNames.length === 0) {
      throw new Error('No databases configured. Please configure databases first.');
    }
    
    return allNames[0];
  }

  /**
   * 데이터베이스 이름 검증
   */
  static async validateDatabase(dbName: string): Promise<void> {
    const allNames = getAllClientNames();
    if (!allNames.includes(dbName)) {
      throw new Error(`Database '${dbName}' not found. Available: ${allNames.join(', ')}`);
    }
  }

  /**
   * 모든 가용 데이터베이스 표시
   */
  static async showAllDatabases(): Promise<void> {
    console.log('📋 All Available Databases:');
    
    // 수동 설정된 데이터베이스
    const manualDBs = prismaManager.getDatabaseNames();
    if (manualDBs.length > 0) {
      console.log('\n🔧 Manually Configured:');
      manualDBs.forEach((name, index) => {
        const marker = index === 0 ? ' (default)' : '';
        console.log(`  • ${name}${marker}`);
      });
    }
    
    // 자동 탐지된 클라이언트
    const autoClients = clientManager.getValidClients();
    if (autoClients.length > 0) {
      console.log('\n🤖 Auto-Detected:');
      autoClients.forEach(client => {
        const provider = client.provider ? `[${client.provider}]` : '';
        console.log(`  • ${client.name} ${provider}`);
      });
    }
    
    const totalCount = getAllClientNames().length;
    if (totalCount === 0) {
      console.log('  No databases found');
    } else {
      console.log(`\n📊 Total: ${totalCount} databases available`);
    }
  }

  /**
   * 에러 출력 및 종료
   */
  static exitWithError(message: string, error?: any): never {
    console.error(`❌ ${message}`);
    if (error) {
      console.error('Details:', error.message || error);
    }
    process.exit(1);
  }

  /**
   * 성공 메시지 출력
   */
  static success(message: string): void {
    console.log(`✅ ${message}`);
  }
}

// 메인 프로그램 설정
program
  .name('prisma-cli')
  .description('Unified Prisma Database Management CLI')
  .version('2.0.0')
  .option('-d, --database <name>', 'Target database name (optional for auto-detection)')
  .option('--auto-init', 'Automatically initialize all clients before operation')
  .hook('preAction', async (thisCommand) => {
    // 자동 초기화 옵션이 활성화된 경우
    if (thisCommand.opts().autoInit) {
      console.log('🚀 Auto-initializing all clients...');
      try {
        await initializeAllClients();
      } catch (error) {
        CLIUtils.exitWithError('Failed to initialize clients', error);
      }
    }
  });

// =============================================================================
// 데이터베이스 관리 명령어들
// =============================================================================

// 데이터베이스 목록 및 상태
program
  .command('list')
  .alias('ls')
  .description('List all available databases')
  .action(async () => {
    try {
      await CLIUtils.showAllDatabases();
    } catch (error) {
      CLIUtils.exitWithError('Failed to list databases', error);
    }
  });

// 헬스 체크
program
  .command('health')
  .alias('check')
  .description('Check health of all database connections')
  .action(async () => {
    try {
      console.log('🏥 Checking database connections...');
      
      // 수동 설정된 DB 헬스 체크
      const manualResults = await databaseService.healthCheck();
      
      // 자동 탐지된 클라이언트 헬스 체크
      const allClients = getAllClientNames();
      const autoResults: { [key: string]: boolean } = {};
      
      for (const clientName of allClients) {
        if (!manualResults.hasOwnProperty(clientName)) {
          try {
            const client = await getAnyClient(clientName);
            await client.$connect();
            await client.$queryRaw`SELECT 1 as test`;
            await client.$disconnect();
            autoResults[clientName] = true;
          } catch {
            autoResults[clientName] = false;
          }
        }
      }
      
      // 결과 출력
      const allResults = { ...manualResults, ...autoResults };
      console.log('\n📊 Health Check Results:');
      
      let healthyCount = 0;
      Object.entries(allResults).forEach(([dbName, isHealthy]) => {
        const status = isHealthy ? '✅ Healthy' : '❌ Unhealthy';
        console.log(`  ${dbName}: ${status}`);
        if (isHealthy) healthyCount++;
      });
      
      const total = Object.keys(allResults).length;
      console.log(`\n📈 Summary: ${healthyCount}/${total} databases healthy`);
      
    } catch (error) {
      CLIUtils.exitWithError('Health check failed', error);
    }
  });

// =============================================================================
// 클라이언트 관리 명령어들
// =============================================================================

const client = program
  .command('client')
  .alias('c')
  .description('Client management commands');

// 클라이언트 스캔
client
  .command('scan')
  .description('Scan and detect all available Prisma clients')
  .action(async () => {
    try {
      console.log('🔍 Scanning for Prisma clients...');
      await clientManager.scanClients();
      printClientReport();
    } catch (error) {
      CLIUtils.exitWithError('Failed to scan clients', error);
    }
  });

// 클라이언트 자동 등록
client
  .command('auto-register')
  .alias('register')
  .description('Automatically register all detected clients')
  .action(async () => {
    try {
      console.log('📡 Auto-registering clients...');
      await clientManager.autoRegisterClients();
      CLIUtils.success('Auto-registration completed');
    } catch (error) {
      CLIUtils.exitWithError('Failed to auto-register clients', error);
    }
  });

// 클라이언트 정보
client
  .command('info <clientName>')
  .description('Show detailed information about a specific client')
  .action(async (clientName: string) => {
    try {
      await clientManager.scanClients();
      
      const detectedClients = clientManager.getDetectedClients();
      const client = detectedClients.find(c => c.name === clientName);
      
      if (!client) {
        console.log(`❌ Auto-detected client '${clientName}' not found.`);
        
        const manualClients = prismaManager.getDatabaseNames();
        if (manualClients.includes(clientName)) {
          console.log(`ℹ️ But '${clientName}' is available as a manually configured client.`);
        }
        return;
      }
      
      console.log(`📊 Client Information: ${clientName}`);
      console.log('='.repeat(50));
      console.log(`Status: ${client.isValid ? '✅ Valid' : '❌ Invalid'}`);
      console.log(`Provider: ${client.provider || 'Unknown'}`);
      console.log(`Path: ${client.path}`);
      if (client.schemaPath) {
        console.log(`Schema: ${client.schemaPath}`);
      }
      if (client.error) {
        console.log(`Error: ${client.error}`);
      }
      
    } catch (error) {
      CLIUtils.exitWithError('Failed to get client info', error);
    }
  });

// 클라이언트 연결 테스트
client
  .command('test [clientName]')
  .description('Test connection for specific client or all clients')
  .action(async (clientName?: string) => {
    try {
      if (clientName) {
        // 특정 클라이언트 테스트
        await CLIUtils.validateDatabase(clientName);
        console.log(`🔌 Testing connection for: ${clientName}`);
        
        const clientInstance = await getAnyClient(clientName);
        await clientInstance.$connect();
        await clientInstance.$queryRaw`SELECT 1 as test`;
        await clientInstance.$disconnect();
        
        CLIUtils.success(`Connection test passed for ${clientName}`);
      } else {
        // 모든 클라이언트 테스트
        const allClients = getAllClientNames();
        console.log(`🔌 Testing connections for ${allClients.length} clients...\n`);
        
        const results: { [key: string]: boolean } = {};
        
        for (const name of allClients) {
          try {
            const clientInstance = await getAnyClient(name);
            await clientInstance.$connect();
            await clientInstance.$queryRaw`SELECT 1 as test`;
            await clientInstance.$disconnect();
            results[name] = true;
            console.log(`✅ ${name}: Connected`);
          } catch (error) {
            results[name] = false;
            console.log(`❌ ${name}: Failed`);
          }
        }
        
        const successful = Object.values(results).filter(r => r).length;
        console.log(`\n📊 Summary: ${successful}/${allClients.length} clients passed`);
      }
    } catch (error) {
      CLIUtils.exitWithError('Connection test failed', error);
    }
  });

// 클라이언트 리포트
client
  .command('report')
  .description('Show comprehensive report of all clients')
  .action(async () => {
    try {
      await clientManager.scanClients();
      printClientReport();
    } catch (error) {
      CLIUtils.exitWithError('Failed to generate report', error);
    }
  });

// =============================================================================
// 마이그레이션 관리 명령어들
// =============================================================================

const migrate = program
  .command('migrate')
  .alias('m')
  .description('Migration management commands');

// 마이그레이션 생성
migrate
  .command('create <migrationName> [dbName]')
  .description('Create a new migration for specific database')
  .action(async (migrationName: string, dbName?: string) => {
    try {
      const targetDb = dbName || program.opts().database || await CLIUtils.getDefaultDatabase();
      await CLIUtils.validateDatabase(targetDb);
      
      console.log(`📝 Creating migration '${migrationName}' for database: ${targetDb}`);
      
      const migMgr = prismaManager.getMigrationManager();
      if (!migMgr) {
        throw new Error('Migration manager not initialized');
      }
      
      await migMgr.createMigration(targetDb, migrationName);
      CLIUtils.success(`Migration created for ${targetDb}`);
      
    } catch (error) {
      CLIUtils.exitWithError('Failed to create migration', error);
    }
  });

// 마이그레이션 실행
migrate
  .command('run [migrationName] [dbName]')
  .description('Run migrations for specific database or all databases')
  .option('--all', 'Run migrations for all databases')
  .action(async (migrationName?: string, dbName?: string, options?: any) => {
    try {
      const migMgr = prismaManager.getMigrationManager();
      if (!migMgr) {
        throw new Error('Migration manager not initialized');
      }
      
      if (options?.all) {
        console.log('🚀 Running migrations for all databases...');
        await migMgr.runAllMigrations(migrationName);
        CLIUtils.success('Migrations completed for all databases');
      } else {
        const targetDb = dbName || program.opts().database || await CLIUtils.getDefaultDatabase();
        await CLIUtils.validateDatabase(targetDb);
        
        console.log(`🚀 Running migrations for database: ${targetDb}`);
        await migMgr.runMigrations(targetDb, migrationName);
        CLIUtils.success(`Migrations completed for ${targetDb}`);
      }
      
    } catch (error) {
      CLIUtils.exitWithError('Failed to run migrations', error);
    }
  });

// 마이그레이션 상태
migrate
  .command('status [dbName]')
  .description('Check migration status for specific database')
  .action(async (dbName?: string) => {
    try {
      const targetDb = dbName || program.opts().database || await CLIUtils.getDefaultDatabase();
      await CLIUtils.validateDatabase(targetDb);
      
      const migMgr = prismaManager.getMigrationManager();
      if (!migMgr) {
        throw new Error('Migration manager not initialized');
      }
      
      console.log(`📊 Checking migration status for: ${targetDb}`);
      await migMgr.getStatus(targetDb);
      
    } catch (error) {
      CLIUtils.exitWithError('Failed to check migration status', error);
    }
  });

// 데이터베이스 리셋
migrate
  .command('reset [dbName]')
  .description('Reset specific database')
  .option('--force', 'Force reset without confirmation')
  .action(async (dbName?: string, options?: any) => {
    try {
      const targetDb = dbName || program.opts().database || await CLIUtils.getDefaultDatabase();
      await CLIUtils.validateDatabase(targetDb);
      
      if (!options?.force) {
        console.log(`⚠️ This will reset database '${targetDb}' and ALL DATA WILL BE LOST!`);
        console.log('Use --force flag to confirm this action.');
        return;
      }
      
      const migMgr = prismaManager.getMigrationManager();
      if (!migMgr) {
        throw new Error('Migration manager not initialized');
      }
      
      console.log(`🔄 Resetting database: ${targetDb}`);
      await migMgr.resetDatabase(targetDb);
      CLIUtils.success(`Database ${targetDb} reset completed`);
      
    } catch (error) {
      CLIUtils.exitWithError('Failed to reset database', error);
    }
  });

// =============================================================================
// 클라이언트 생성 및 관리
// =============================================================================

// 클라이언트 생성
program
  .command('generate [dbName]')
  .alias('gen')
  .description('Generate Prisma Client for specific database or all databases')
  .option('--all', 'Generate clients for all databases')
  .action(async (dbName?: string, options?: any) => {
    try {
      const migMgr = prismaManager.getMigrationManager();
      if (!migMgr) {
        throw new Error('Migration manager not initialized');
      }
      
      if (options?.all) {
        console.log('🔨 Generating Prisma Clients for all databases...');
        await migMgr.generateAllClients();
        CLIUtils.success('Client generation completed for all databases');
      } else {
        const targetDb = dbName || program.opts().database || await CLIUtils.getDefaultDatabase();
        await CLIUtils.validateDatabase(targetDb);
        
        console.log(`🔨 Generating Prisma Client for: ${targetDb}`);
        await migMgr.generateClient(targetDb);
        CLIUtils.success(`Client generated for ${targetDb}`);
      }
      
    } catch (error) {
      CLIUtils.exitWithError('Failed to generate client', error);
    }
  });

// 스키마 푸시
program
  .command('push [dbName]')
  .description('Push schema to specific database')
  .action(async (dbName?: string) => {
    try {
      const targetDb = dbName || program.opts().database || await CLIUtils.getDefaultDatabase();
      await CLIUtils.validateDatabase(targetDb);
      
      const migMgr = prismaManager.getMigrationManager();
      if (!migMgr) {
        throw new Error('Migration manager not initialized');
      }
      
      console.log(`📤 Pushing schema to: ${targetDb}`);
      await migMgr.pushSchema(targetDb);
      CLIUtils.success(`Schema pushed to ${targetDb}`);
      
    } catch (error) {
      CLIUtils.exitWithError('Failed to push schema', error);
    }
  });

// Prisma Studio
program
  .command('studio [dbName]')
  .description('Open Prisma Studio for specific database')
  .action(async (dbName?: string) => {
    try {
      const targetDb = dbName || program.opts().database || await CLIUtils.getDefaultDatabase();
      await CLIUtils.validateDatabase(targetDb);
      
      const migMgr = prismaManager.getMigrationManager();
      if (!migMgr) {
        throw new Error('Migration manager not initialized');
      }
      
      console.log(`🎨 Opening Prisma Studio for: ${targetDb}`);
      await migMgr.openStudio(targetDb);
      
    } catch (error) {
      CLIUtils.exitWithError('Failed to open studio', error);
    }
  });

// =============================================================================
// 통합 셋업 명령어들
// =============================================================================

// 통합 초기화
program
  .command('init')
  .description('Initialize all Prisma clients and scan for auto-detected clients')
  .action(async () => {
    try {
      console.log('🚀 Initializing Prisma Management System...\n');
      
      // 1. 자동 클라이언트 스캔 및 등록
      console.log('1️⃣ Scanning and registering auto-detected clients...');
      await clientManager.autoRegisterClients();
      
      // 2. 모든 클라이언트 초기화
      console.log('\n2️⃣ Initializing all clients...');
      await initializeAllClients();
      
      // 3. 헬스 체크
      console.log('\n3️⃣ Performing health check...');
      const allClients = getAllClientNames();
      let healthyCount = 0;
      
      for (const clientName of allClients) {
        try {
          const client = await getAnyClient(clientName);
          await client.$connect();
          await client.$queryRaw`SELECT 1 as test`;
          await client.$disconnect();
          console.log(`  ✅ ${clientName}: Healthy`);
          healthyCount++;
        } catch {
          console.log(`  ❌ ${clientName}: Unhealthy`);
        }
      }
      
      console.log(`\n📊 Initialization Summary:`);
      console.log(`  • Total clients: ${allClients.length}`);
      console.log(`  • Healthy clients: ${healthyCount}/${allClients.length}`);
      
      CLIUtils.success('Prisma system initialization completed!');
      
    } catch (error) {
      CLIUtils.exitWithError('Initialization failed', error);
    }
  });

// 완전 셋업
program
  .command('setup [dbName]')
  .description('Complete database setup (migrate + generate) for specific or all databases')
  .option('--all', 'Setup all databases')
  .action(async (dbName?: string, options?: any) => {
    try {
      const migMgr = prismaManager.getMigrationManager();
      if (!migMgr) {
        throw new Error('Migration manager not initialized');
      }
      
      if (options?.all) {
        console.log('🚀 Starting complete setup for all databases...\n');
        
        console.log('1️⃣ Running migrations for all databases...');
        await migMgr.runAllMigrations();
        
        console.log('\n2️⃣ Generating clients for all databases...');
        await migMgr.generateAllClients();
        
        CLIUtils.success('Complete setup finished for all databases!');
      } else {
        const targetDb = dbName || program.opts().database || await CLIUtils.getDefaultDatabase();
        await CLIUtils.validateDatabase(targetDb);
        
        console.log(`🚀 Starting complete setup for: ${targetDb}\n`);
        
        console.log(`1️⃣ Running migrations for ${targetDb}...`);
        await migMgr.runMigrations(targetDb);
        
        console.log(`\n2️⃣ Generating client for ${targetDb}...`);
        await migMgr.generateClient(targetDb);
        
        CLIUtils.success(`Complete setup finished for ${targetDb}!`);
      }
      
    } catch (error) {
      CLIUtils.exitWithError('Setup failed', error);
    }
  });

// =============================================================================
// 환경 및 디버그 명령어들
// =============================================================================

// 환경 변수 체크
program
  .command('env')
  .description('Check environment variables for database connections')
  .action(() => {
    try {
      console.log('🔍 Checking environment variables...\n');
      
      const commonEnvPatterns = [
        'DATABASE_URL',
        'DEFAULT_DATABASE_URL', 'ANALYTICS_DATABASE_URL', 'CACHE_DATABASE_URL',
        'PG_HOST', 'PG_PORT', 'PG_USER', 'PG_PASSWORD', 'PG_DB', 'PG_SSL',
        'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DB',
        'SQLITE_PATH',
        'SQLSERVER_HOST', 'SQLSERVER_PORT', 'SQLSERVER_USER', 'SQLSERVER_PASSWORD', 'SQLSERVER_DB'
      ];
      
      const foundVars: string[] = [];
      const missingVars: string[] = [];
      
      commonEnvPatterns.forEach(pattern => {
        if (process.env[pattern]) {
          foundVars.push(pattern);
        } else {
          missingVars.push(pattern);
        }
      });
      
      console.log('✅ Found Environment Variables:');
      if (foundVars.length === 0) {
        console.log('  None found');
      } else {
        foundVars.forEach(varName => {
          const value = process.env[varName];
          const displayValue = varName.includes('PASSWORD') ? '*'.repeat(8) : value;
          console.log(`  ${varName}=${displayValue}`);
        });
      }
      
      console.log('\n⚠️ Missing Common Variables:');
      if (missingVars.length === 0) {
        console.log('  All variables are set');
      } else {
        missingVars.forEach(varName => console.log(`  ${varName}`));
      }
      
      console.log('\n💡 Tip: Configure missing variables in .env file or system environment');
      
    } catch (error) {
      CLIUtils.exitWithError('Failed to check environment', error);
    }
  });

// 디버그 정보
program
  .command('debug')
  .description('Show debug information about the Prisma management system')
  .action(async () => {
    try {
      console.log('🐛 Prisma Management System Debug Information\n');
      
      // 시스템 정보
      console.log('📋 System Information:');
      console.log(`  Node.js: ${process.version}`);
      console.log(`  Platform: ${process.platform}`);
      console.log(`  Architecture: ${process.arch}`);
      
      // 환경 변수
      console.log('\n🔧 Configuration:');
      console.log(`  NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
      console.log(`  DATABASE_URL: ${process.env.DATABASE_URL ? 'set' : 'not set'}`);
      
      // 데이터베이스 정보
      console.log('\n💾 Database Information:');
      const manualDBs = prismaManager.getDatabaseNames();
      const autoClients = clientManager.getValidClients();
      
      console.log(`  Manual databases: ${manualDBs.length}`);
      manualDBs.forEach(name => console.log(`    • ${name}`));
      
      console.log(`  Auto-detected clients: ${autoClients.length}`);
      autoClients.forEach(client => console.log(`    • ${client.name} [${client.provider || 'unknown'}]`));
      
      // 마이그레이션 매니저 상태
      console.log('\n⚙️ Migration Manager:');
      const migMgr = prismaManager.getMigrationManager();
      console.log(`  Status: ${migMgr ? 'initialized' : 'not initialized'}`);
      
      console.log('\n✅ Debug information collected successfully');
      
    } catch (error) {
      CLIUtils.exitWithError('Failed to collect debug information', error);
    }
  });

// 프로그램 파싱 및 실행
program.parse();
