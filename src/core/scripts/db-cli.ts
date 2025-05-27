#!/usr/bin/env node

import { program } from 'commander';
import { migrationManager } from '../db/migration';
import { databaseService } from '../db/service';

program
  .name('db-cli')
  .description('Database management CLI for Prisma')
  .version('1.0.0');

// 마이그레이션 관련 명령어
const migrate = program
  .command('migrate')
  .description('Migration management commands');

migrate
  .command('create <name>')
  .description('Create a new migration')
  .action(async (name: string) => {
    try {
      await migrationManager.createMigration(name);
    } catch (error) {
      console.error('Error creating migration:', error);
      process.exit(1);
    }
  });

migrate
  .command('run [name]')
  .description('Run migrations')
  .action(async (name?: string) => {
    try {
      await migrationManager.runMigrations(name);
    } catch (error) {
      console.error('Error running migrations:', error);
      process.exit(1);
    }
  });

migrate
  .command('status')
  .description('Check migration status')
  .action(async () => {
    try {
      await migrationManager.getStatus();
    } catch (error) {
      console.error('Error checking migration status:', error);
      process.exit(1);
    }
  });

migrate
  .command('reset')
  .description('Reset database')
  .action(async () => {
    try {
      await migrationManager.resetDatabase();
    } catch (error) {
      console.error('Error resetting database:', error);
      process.exit(1);
    }
  });

// 클라이언트 생성
program
  .command('generate')
  .description('Generate Prisma Client')
  .action(async () => {
    try {
      await migrationManager.generateClient();
    } catch (error) {
      console.error('Error generating client:', error);
      process.exit(1);
    }
  });

// 스키마 푸시
program
  .command('push')
  .description('Push schema to database')
  .action(async () => {
    try {
      await migrationManager.pushSchema();
    } catch (error) {
      console.error('Error pushing schema:', error);
      process.exit(1);
    }
  });

// 시드 실행
program
  .command('seed')
  .description('Run database seed')
  .action(async () => {
    try {
      await databaseService.runSeed();
    } catch (error) {
      console.error('Error running seed:', error);
      process.exit(1);
    }
  });

// Prisma Studio
program
  .command('studio')
  .description('Open Prisma Studio')
  .action(async () => {
    try {
      await migrationManager.openStudio();
    } catch (error) {
      console.error('Error opening studio:', error);
      process.exit(1);
    }
  });

// 헬스 체크
program
  .command('health')
  .description('Check database connections')
  .action(async () => {
    try {
      const results = await databaseService.healthCheck();
      console.log('🏥 Database Health Check Results:');
      Object.entries(results).forEach(([dbName, isHealthy]) => {
        const status = isHealthy ? '✅ Healthy' : '❌ Unhealthy';
        console.log(`  ${dbName}: ${status}`);
      });
    } catch (error) {
      console.error('Error during health check:', error);
      process.exit(1);
    }
  });

// 올인원 셋업 명령어
program
  .command('setup')
  .description('Complete database setup (migrate + generate + seed)')
  .action(async () => {
    try {
      console.log('🚀 Starting complete database setup...');
      
      console.log('\n1️⃣ Running migrations...');
      await migrationManager.runMigrations();
      
      console.log('\n2️⃣ Generating Prisma Client...');
      await migrationManager.generateClient();
      
      console.log('\n3️⃣ Running seed...');
      await databaseService.runSeed();
      
      console.log('\n✅ Database setup completed successfully!');
    } catch (error) {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    }
  });

program.parse();
