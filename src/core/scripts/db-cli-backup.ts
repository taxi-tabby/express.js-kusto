#!/usr/bin/env node

import { program } from 'commander';
import { migrationManager } from '../db/migration';
import { databaseService } from '../db/service';
import { PrismaManager } from '../db';

// PrismaManager 초기화를 위해 init.ts 실행
import '../../app/db/init';

const prismaManager = PrismaManager.getInstance();

program
	.name('db-cli')
	.description('Database management CLI for Prisma with multi-database support')
	.version('1.0.0')
	.option('-d, --database <name>', 'Database name (default: first available database)');

// Helper function to get database name
async function getDatabaseName(options: any): Promise<string> {
	if (options.database) {
		return options.database;
	}
	
	// Get first available database as default
	const dbNames = prismaManager.getDatabaseNames();
	
	if (dbNames.length === 0) {
		throw new Error('No databases configured. Please add a database first.');
	}
	
	const defaultDb = dbNames[0];
	console.log(`Using default database: ${defaultDb}`);
	return defaultDb;
}

// 마이그레이션 관련 명령어
const migrate = program
	.command('migrate')
	.description('Migration management commands');

migrate
	.command('create <name>')
	.description('Create a new migration')
	.action(async (name: string, cmd: any) => {
		try {
			const dbName = await getDatabaseName(cmd.parent.opts());
			await migrationManager.createMigration(dbName, name);
		} catch (error) {
			console.error('Error creating migration:', error);
			process.exit(1);
		}
	});

migrate
	.command('run [name]')
	.description('Run migrations')
	.action(async (name: string | undefined, cmd: any) => {
		try {
			const dbName = await getDatabaseName(cmd.parent.opts());
			await migrationManager.runMigrations(dbName, name);
		} catch (error) {
			console.error('Error running migrations:', error);
			process.exit(1);
		}
	});

migrate
	.command('status')
	.description('Check migration status')
	.action(async (cmd: any) => {
		try {
			const dbName = await getDatabaseName(cmd.parent.opts());
			await migrationManager.getStatus(dbName);
		} catch (error) {
			console.error('Error checking migration status:', error);
			process.exit(1);
		}
	});

migrate
	.command('reset')
	.description('Reset database')
	.action(async (cmd: any) => {
		try {
			const dbName = await getDatabaseName(cmd.parent.opts());
			await migrationManager.resetDatabase(dbName);
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
			const dbName = await getDatabaseName(program.opts());
			await migrationManager.generateClient(dbName);
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
			const dbName = await getDatabaseName(program.opts());
			await migrationManager.pushSchema(dbName);
		} catch (error) {
			console.error('Error pushing schema:', error);
			process.exit(1);
		}
	});

// 시드 실행
// program
//   .command('seed')
//   .description('Run database seed')
//   .action(async () => {
//     try {
//       await databaseService.runSeed();
//     } catch (error) {
//       console.error('Error running seed:', error);
//       process.exit(1);
//     }
//   });

// Prisma Studio
program
	.command('studio')
	.description('Open Prisma Studio')
	.action(async () => {
		try {
			const dbName = await getDatabaseName(program.opts());
			await migrationManager.openStudio(dbName);
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

// 데이터베이스 목록
program
	.command('list')
	.description('List all configured databases')
	.action(async () => {
		try {
			const dbNames = prismaManager.getDatabaseNames();
			if (dbNames.length === 0) {
				console.log('📋 No databases configured');
			} else {
				console.log('📋 Configured databases:');
				dbNames.forEach((dbName, index) => {
					const marker = index === 0 ? ' (default)' : '';
					console.log(`  • ${dbName}${marker}`);
				});
			}
		} catch (error) {
			console.error('Error listing databases:', error);
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
			const dbName = await getDatabaseName(program.opts());

			console.log('\n1️⃣ Running migrations...');
			await migrationManager.runMigrations(dbName);

			console.log('\n2️⃣ Generating Prisma Client...');
			await migrationManager.generateClient(dbName);

			// console.log('\n3️⃣ Running seed...');
			// await databaseService.runSeed();

			console.log('\n✅ Database setup completed successfully!');
		} catch (error) {
			console.error('❌ Setup failed:', error);
			process.exit(1);
		}
	});

program.parse();
