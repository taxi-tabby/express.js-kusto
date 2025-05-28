#!/usr/bin/env node

import { program } from 'commander';
import { migrationManager } from '../db/migration';
import { databaseService } from '../db/service';
import { PrismaManager } from '../db';

// PrismaManager 초기화를 위해 init.ts 실행
import '@app/db/init';

const prismaManager = PrismaManager.getInstance();

program
	.name('db-cli')
	.description('Database management CLI for Prisma with multi-database support')
	.version('1.0.0');

// 데이터베이스 목록 명령어
program
	.command('list')
	.description('List all configured databases')
	.action(async () => {
		try {
			const migMgr = prismaManager.getMigrationManager();
			if (!migMgr) {
				throw new Error('Migration manager not initialized');
			}
			const dbNames = migMgr.getDatabaseNames();
			console.log('📋 Configured databases:');
			if (dbNames.length === 0) {
				console.log('  No databases configured');
			} else {
				dbNames.forEach((name: string) => console.log(`  - ${name}`));
			}
		} catch (error) {
			console.error('Error listing databases:', error);
			process.exit(1);
		}
	});

// 마이그레이션 관련 명령어
const migrate = program
	.command('migrate')
	.description('Migration management commands');

migrate
	.command('create <dbName> <migrationName>')
	.description('Create a new migration for specific database')
	.action(async (dbName: string, migrationName: string) => {
		try {
			const migMgr = prismaManager.getMigrationManager();
			if (!migMgr) {
				throw new Error('Migration manager not initialized');
			}
			await migMgr.createMigration(dbName, migrationName);
		} catch (error) {
			console.error('Error creating migration:', error);
			process.exit(1);
		}
	});

migrate
	.command('run <dbName> [migrationName]')
	.description('Run migrations for specific database')
	.action(async (dbName: string, migrationName?: string) => {
		try {
			const migMgr = prismaManager.getMigrationManager();
			if (!migMgr) {
				throw new Error('Migration manager not initialized');
			}
			await migMgr.runMigrations(dbName, migrationName);
		} catch (error) {
			console.error('Error running migrations:', error);
			process.exit(1);
		}
	});

migrate
	.command('run-all [migrationName]')
	.description('Run migrations for all configured databases')
	.action(async (migrationName?: string) => {
		try {
			const migMgr = prismaManager.getMigrationManager();
			if (!migMgr) {
				throw new Error('Migration manager not initialized');
			}
			await migMgr.runAllMigrations(migrationName);
		} catch (error) {
			console.error('Error running migrations:', error);
			process.exit(1);
		}
	});

migrate
	.command('status <dbName>')
	.description('Check migration status for specific database')
	.action(async (dbName: string) => {
		try {
			const migMgr = prismaManager.getMigrationManager();
			if (!migMgr) {
				throw new Error('Migration manager not initialized');
			}
			await migMgr.getStatus(dbName);
		} catch (error) {
			console.error('Error checking migration status:', error);
			process.exit(1);
		}
	});

migrate
	.command('reset <dbName>')
	.description('Reset specific database')
	.action(async (dbName: string) => {
		try {
			const migMgr = prismaManager.getMigrationManager();
			if (!migMgr) {
				throw new Error('Migration manager not initialized');
			}
			await migMgr.resetDatabase(dbName);
		} catch (error) {
			console.error('Error resetting database:', error);
			process.exit(1);
		}
	});

// 클라이언트 생성
program
	.command('generate <dbName>')
	.description('Generate Prisma Client for specific database')
	.action(async (dbName: string) => {
		try {
			const migMgr = prismaManager.getMigrationManager();
			if (!migMgr) {
				throw new Error('Migration manager not initialized');
			}
			await migMgr.generateClient(dbName);
		} catch (error) {
			console.error('Error generating client:', error);
			process.exit(1);
		}
	});

program
	.command('generate-all')
	.description('Generate Prisma Client for all databases')
	.action(async () => {
		try {
			const migMgr = prismaManager.getMigrationManager();
			if (!migMgr) {
				throw new Error('Migration manager not initialized');
			}
			await migMgr.generateAllClients();
		} catch (error) {
			console.error('Error generating clients:', error);
			process.exit(1);
		}
	});

// 스키마 푸시
program
	.command('push <dbName>')
	.description('Push schema to specific database')
	.action(async (dbName: string) => {
		try {
			const migMgr = prismaManager.getMigrationManager();
			if (!migMgr) {
				throw new Error('Migration manager not initialized');
			}
			await migMgr.pushSchema(dbName);
		} catch (error) {
			console.error('Error pushing schema:', error);
			process.exit(1);
		}
	});

// Prisma Studio
program
	.command('studio <dbName>')
	.description('Open Prisma Studio for specific database')
	.action(async (dbName: string) => {
		try {
			const migMgr = prismaManager.getMigrationManager();
			if (!migMgr) {
				throw new Error('Migration manager not initialized');
			}
			await migMgr.openStudio(dbName);
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
	.command('setup [dbName]')
	.description('Complete database setup (migrate + generate) for specific database or all databases')
	.action(async (dbName?: string) => {
		try {
			const migMgr = prismaManager.getMigrationManager();
			if (!migMgr) {
				throw new Error('Migration manager not initialized');
			}

			if (dbName) {
				console.log(`🚀 Starting database setup for ${dbName}...`);
				
				console.log(`\n1️⃣ Running migrations for ${dbName}...`);
				await migMgr.runMigrations(dbName);

				console.log(`\n2️⃣ Generating Prisma Client for ${dbName}...`);
				await migMgr.generateClient(dbName);

				console.log(`\n✅ Database setup completed successfully for ${dbName}!`);
			} else {
				console.log('🚀 Starting complete database setup for all databases...');

				console.log('\n1️⃣ Running migrations for all databases...');
				await migMgr.runAllMigrations();

				console.log('\n2️⃣ Generating Prisma Clients for all databases...');
				await migMgr.generateAllClients();

				console.log('\n✅ Database setup completed successfully for all databases!');
			}
		} catch (error) {
			console.error('❌ Setup failed:', error);
			process.exit(1);
		}
	});

program.parse();
