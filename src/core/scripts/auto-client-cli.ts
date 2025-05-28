#!/usr/bin/env node

// dotenv 로드
import dotenv from 'dotenv';
dotenv.config();

import { program } from 'commander';

// 필요한 모듈들 import
import { clientManager, printClientReport } from '../db/clientManager';
import { PrismaManager } from '../db';

const prismaManager = PrismaManager.getInstance();

// 헬퍼 함수들
const getAllClientNames = (): string[] => {
  const registeredClients = prismaManager.getDatabaseNames();
  const autoDetectedClients = clientManager.getValidClients().map(c => c.name);
  return [...new Set([...registeredClients, ...autoDetectedClients])];
};

const getAnyClient = async (clientName: string): Promise<any> => {
  try {
    return prismaManager.getClient(clientName);
  } catch (error) {
    console.log(`🔄 Fallback to auto-detected client: ${clientName}`);
    return await clientManager.getClientInstance(clientName);
  }
};

program
	.name('auto-client-cli')
	.description('Automatic Prisma Client management CLI')
	.version('1.0.0');

// 클라이언트 자동 탐지 및 스캔
program
	.command('scan')
	.description('Scan and detect all Prisma clients')
	.action(async () => {
		try {
			console.log('🔍 Scanning for Prisma clients...');
			await clientManager.scanClients();
			printClientReport();
		} catch (error) {
			console.error('Error scanning clients:', error);
			process.exit(1);
		}
	});

// 자동 등록
program
	.command('auto-register')
	.description('Automatically register all detected clients')
	.action(async () => {
		try {
			console.log('📡 Auto-registering clients...');
			await clientManager.autoRegisterClients();
			console.log('✅ Auto-registration completed.');
		} catch (error) {
			console.error('Error auto-registering clients:', error);
			process.exit(1);
		}
	});

// 클라이언트 목록 (통합)
program
	.command('list')
	.description('List all available clients (manual + auto-detected)')
	.action(async () => {
		try {
			// 먼저 자동 등록 실행
			console.log('📡 Auto-detecting and registering clients...');
			await clientManager.autoRegisterClients();
			
			const allClients = getAllClientNames();
			const autoDetectedClients = clientManager.getValidClients();
			
			console.log('📋 All Available Clients:');
			
			// 수동 등록된 클라이언트들
			const manualClients = prismaManager.getDatabaseNames();
			if (manualClients.length > 0) {
				console.log('\n🔧 Manually Configured:');
				manualClients.forEach(name => console.log(`  - ${name}`));
			}
			
			// 자동 탐지된 클라이언트들
			if (autoDetectedClients.length > 0) {
				console.log('\n🤖 Auto-Detected:');
				autoDetectedClients.forEach(client => {
					const provider = client.provider ? `[${client.provider}]` : '';
					console.log(`  - ${client.name} ${provider}`);
				});
			}
			
			if (allClients.length === 0) {
				console.log('  No clients found');
			} else {
				console.log(`\n📊 Total: ${allClients.length} clients available`);
			}
		} catch (error) {
			console.error('Error listing clients:', error);
			process.exit(1);
		}
	});

// 클라이언트 상세 정보
program
	.command('info <clientName>')
	.description('Show detailed information about a specific client')
	.action(async (clientName: string) => {
		try {
			// 먼저 스캔 실행
			await clientManager.scanClients();
			
			const detectedClients = clientManager.getDetectedClients();
			const client = detectedClients.find(c => c.name === clientName);
			
			if (!client) {
				console.log(`❌ Client '${clientName}' not found in auto-detected clients.`);
				
				// PrismaManager에서 확인
				const manualClients = prismaManager.getDatabaseNames();
				if (manualClients.includes(clientName)) {
					console.log(`ℹ️ But '${clientName}' is available as a manually configured client.`);
				}
				return;
			}
			
			console.log(`📊 Client Information: ${clientName}`);
			console.log('=' .repeat(50));
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
			console.error('Error getting client info:', error);
			process.exit(1);
		}
	});

// 클라이언트 테스트 연결
program
	.command('test <clientName>')
	.description('Test connection for a specific client')
	.action(async (clientName: string) => {
		try {
			console.log(`🔌 Testing connection for client: ${clientName}`);
			
			const client = await getAnyClient(clientName);
			await client.$connect();
			
			// 간단한 쿼리 테스트
			try {
				await client.$queryRaw`SELECT 1 as test`;
				console.log(`✅ Connection test successful for ${clientName}`);
			} catch (queryError) {
				console.log(`⚠️ Connected but query failed for ${clientName}:`, queryError);
			}
			
			await client.$disconnect();
		} catch (error) {
			console.error(`❌ Connection test failed for ${clientName}:`, error);
			process.exit(1);
		}
	});

// 모든 클라이언트 연결 테스트
program
	.command('test-all')
	.description('Test connections for all available clients')
	.action(async () => {
		try {
			const allClients = getAllClientNames();
			console.log(`🔌 Testing connections for ${allClients.length} clients...`);
			
			const results: { [key: string]: boolean } = {};
			
			for (const clientName of allClients) {
				try {
					const client = await getAnyClient(clientName);
					await client.$connect();
					await client.$queryRaw`SELECT 1 as test`;
					await client.$disconnect();
					results[clientName] = true;
					console.log(`✅ ${clientName}: Connected`);
				} catch (error) {
					results[clientName] = false;
					console.log(`❌ ${clientName}: Failed`);
				}
			}
			
			console.log('\n📊 Connection Test Summary:');
			const successful = Object.values(results).filter(r => r).length;
			const total = allClients.length;
			console.log(`✅ ${successful}/${total} clients connected successfully`);
			
		} catch (error) {
			console.error('Error testing connections:', error);
			process.exit(1);
		}
	});

// 클라이언트 리포트
program
	.command('report')
	.description('Show comprehensive report of all clients')
	.action(async () => {
		try {
			await clientManager.scanClients();
			printClientReport();
		} catch (error) {
			console.error('Error generating report:', error);
			process.exit(1);
		}
	});

// 환경 변수 체크
program
	.command('check-env')
	.description('Check environment variables for client connections')
	.action(() => {
		try {
			console.log('🔍 Checking environment variables...');
			
			const commonEnvPatterns = [
				'DATABASE_URL',
				'DEFAULT_DATABASE_URL',
				'PG_HOST', 'PG_PORT', 'PG_USER', 'PG_PASSWORD', 'PG_DB',
				'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DB',
				'SQLITE_PATH'
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
			
			console.log('\n✅ Found Environment Variables:');
			if (foundVars.length === 0) {
				console.log('  None found');
			} else {
				foundVars.forEach(varName => {
					const value = process.env[varName];
					const displayValue = varName.includes('PASSWORD') ? '*'.repeat(8) : value;
					console.log(`  ${varName}=${displayValue}`);
				});
			}
			
			console.log('\n❌ Missing Environment Variables:');
			if (missingVars.length === 0) {
				console.log('  All common variables are set');
			} else {
				missingVars.forEach(varName => console.log(`  ${varName}`));
			}
			
			console.log('\n💡 Tip: Set environment variables in .env file or system environment');
			
		} catch (error) {
			console.error('Error checking environment:', error);
			process.exit(1);
		}
	});

program.parse();
