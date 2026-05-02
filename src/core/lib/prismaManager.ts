// filepath: r:\project\express.js-kusto\src\core\lib\prismaManager.ts

// Note: PrismaClient is dynamically imported from each database's client folder
// import { PrismaClient } from '@prisma/client'; // Removed - using dynamic imports instead
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import {
	DatabaseClientMap,
	DatabaseClientType,
	DatabaseName,
	PrismaManagerWrapOverloads,
	PrismaManagerClientOverloads
} from './types/generated-db-types';

/**
 * Database connection configuration interface
 */
export interface DatabaseConfig {
	name: string;
	schemaPath: string;
	isGenerated: boolean;
}

/**
 * Prisma Manager Singleton Class
 * Manages multiple Prisma clients for different databases
 */
export class PrismaManager implements PrismaManagerWrapOverloads, PrismaManagerClientOverloads {
	private static instance: PrismaManager;
	private databases: Map<string, any> = new Map(); // Store actual client instances
	private configs: Map<string, DatabaseConfig> = new Map();
	private clientTypes: Map<string, any> = new Map(); // Store client type constructors
	private initialized: boolean = false;
	private reconnectionAttempts: Map<string, number> = new Map();
	private reconnectionCooldowns: Map<string, number> = new Map(); // 쿨다운 타임스탬프
	private readonly MAX_RECONNECTION_ATTEMPTS = 3;
	private readonly RECONNECTION_COOLDOWN_MS = 30000; // 30초 쿨다운


	/**
	 * Private constructor to enforce singleton pattern
	 */
	private constructor() { 
		// Load environment variables when PrismaManager is created
		this.loadEnvironmentVariables();
	}	
	
	
	/**
	 * Load environment variables using the same logic as webpack config
	 */
	private loadEnvironmentVariables(): void {
		console.log('🔧 Loading environment variables...');
		
		// 기본 .env 파일 로드
		const defaultEnvPath = path.resolve(process.cwd(), '.env');
		if (fs.existsSync(defaultEnvPath)) {
			console.log(`📄 Loading default .env file: ${defaultEnvPath}`);
			config({ path: defaultEnvPath });
		}

		// NODE_ENV 기반 환경별 파일 로드
		const nodeEnv = process.env.NODE_ENV || 'development';
		let envSpecificPath = null;

		if (nodeEnv === 'development') {
			envSpecificPath = path.resolve(process.cwd(), '.env.dev');
		} else if (nodeEnv === 'production') {
			envSpecificPath = path.resolve(process.cwd(), '.env.prod');
		}
		
		if (envSpecificPath && fs.existsSync(envSpecificPath)) {
			console.log(`📄 Loading environment-specific file: ${envSpecificPath}`);
			config({ path: envSpecificPath, override: true });
		} else if (envSpecificPath) {
			console.log(`⚠️ Environment-specific file not found: ${envSpecificPath}`);
		}
		
	}

	/**
	 * Get the singleton instance of PrismaManager
	 */
	public static getInstance(): PrismaManager {
		if (!PrismaManager.instance) {
			PrismaManager.instance = new PrismaManager();
		}
		return PrismaManager.instance;
	}

	/**
	 * Initialize the Prisma Manager
	 * Scans src/app/db folder for database configurations
	 */
	public async initialize(): Promise<void> {
		if (this.initialized) {
			console.log('PrismaManager already initialized');
			return;
		}

		// Load environment variables first
		this.loadEnvironmentVariables();

		const dbPath = path.join(process.cwd(), 'src', 'app', 'db');

		if (!fs.existsSync(dbPath)) {
			throw new Error(`Database directory not found: ${dbPath}`);
		}

		// Read all folders in src/app/db
		const folders = fs.readdirSync(dbPath, { withFileTypes: true })
			.filter(dirent => dirent.isDirectory())
			.map(dirent => dirent.name);

		// 개발 환경에서만 상세 로그 출력
		if (process.env.NODE_ENV === 'development') {
			console.log(`Found ${folders.length} database folders:`, folders);
		}

		// Process each database folder with error handling
		for (const folderName of folders) {
			try {
				await this.processDatabaseFolder(folderName, dbPath);
			} catch (error) {
				console.error(`❌ Failed to process database folder '${folderName}':`, error);
				// Continue with other databases instead of failing completely
			}
		}

		this.initialized = true;
		
		// 간소화된 초기화 로그
		const connectedCount = this.databases.size;
		const totalCount = folders.length;
		
		if (connectedCount === 0) {
			console.warn('⚠️ No databases connected');
		} else {
			console.log(`✅ PrismaManager: ${connectedCount}/${totalCount} databases ready`);
		}
	}

	/**
	 * Process a single database folder
	 */
	private async processDatabaseFolder(folderName: string, dbPath: string): Promise<void> {
		const folderPath = path.join(dbPath, folderName);
		const schemaPath = path.join(folderPath, 'schema.prisma');

		// Check if schema.prisma exists
		if (!fs.existsSync(schemaPath)) {
			console.warn(`No schema.prisma found in ${folderName}, skipping...`);
			return;
		}

		// Check if Prisma client is generated
		const isGenerated = await this.checkIfGenerated(folderName);

		if (!isGenerated) {
			console.warn(`Prisma client not generated for ${folderName}, skipping connection...`);
			this.configs.set(folderName, {
				name: folderName,
				schemaPath,
				isGenerated: false
			});
			return;
		}

		try {
			// Dynamically import the generated Prisma client
			let clientModule;
			let DatabasePrismaClient;			
			
			// Webpack/Production 환경 감지: dist/server.js 존재만으로 판단하지 않음
			// NODE_ENV가 development면 무조건 개발 경로 사용
			const isWebpackBuild = process.env.WEBPACK_BUILD === 'true' || 
								   (process.env.NODE_ENV === 'production' && 
								    fs.existsSync(path.join(process.cwd(), 'dist', 'server.js')));
			
			if (isWebpackBuild) {
				// In webpack build/production environment
				const distClientPath = path.join(process.cwd(), 'dist', 'src', 'app', 'db', folderName, 'client');
				const clientIndexPath = path.join(distClientPath, 'index.js');
				
				// Check if built client exists
				if (!fs.existsSync(clientIndexPath)) {
					throw new Error(`Built Prisma client not found at: ${clientIndexPath}`);
				}
				
				try {
					// Multiple fallback strategies for loading the module
					let nodeRequire: any;
					
					// Strategy 1: Try Module.createRequire
					try {
						const Module = eval('require')('module');
						nodeRequire = Module.createRequire(__filename);
					} catch (e) {
						// Strategy 2: Direct eval require
						nodeRequire = eval('require');
					}
					
					// Clear cache and load the module
					delete nodeRequire.cache[clientIndexPath];
					clientModule = nodeRequire(clientIndexPath);
					DatabasePrismaClient = clientModule.PrismaClient;
					
					if (!DatabasePrismaClient) {
						throw new Error(`PrismaClient not found in module: ${clientIndexPath}`);
					}
					
					console.log(`✅ Successfully loaded Prisma client for ${folderName} from dist path`);
				} catch (requireError: any) {
					console.error(`❌ Failed to load Prisma client from dist for ${folderName}:`, requireError);
					
					// Fallback: Try to load from source (for development in production mode)
					console.log(`🔄 Attempting fallback to source client for ${folderName}...`);
					const clientPath = path.join(folderPath, 'client');
					if (fs.existsSync(path.join(clientPath, 'index.js'))) {
						clientModule = await import(clientPath);
						DatabasePrismaClient = clientModule.PrismaClient;
						console.log(`✅ Fallback successful for ${folderName}`);
					} else {
						throw requireError;
					}
				}
			} else {
				// Development environment - enhanced client loading with cache clearing
				const clientPath = path.join(folderPath, 'client');
				console.log(`🔧 Loading Prisma client for ${folderName} from development path: ${clientPath}`);
				
				try {
					// 개발 모드에서 모듈 캐시 완전 클리어
					if (process.env.NODE_ENV === 'development') {
						// Clear require cache for this client module (cross-platform path handling)
						const normalizedClientPath = clientPath.replace(/\\/g, '/');
						Object.keys(require.cache).forEach(key => {
							const normalizedKey = key.replace(/\\/g, '/');
							if (normalizedKey.includes(normalizedClientPath) || 
								normalizedKey.includes(`/db/${folderName}/client`) ||
								normalizedKey.includes(`\\db\\${folderName}\\client`)) {
								delete require.cache[key];
								console.log(`🗑️ Cleared cache for: ${key}`);
							}
						});
					}
					
					// Check if client files exist before importing
					const clientIndexPath = path.join(clientPath, 'index.js');
					const clientIndexTsPath = path.join(clientPath, 'index.d.ts');
					
					if (!fs.existsSync(clientIndexPath)) {
						throw new Error(`Prisma client index.js not found at: ${clientIndexPath}. Please run 'npx prisma generate --schema=${path.join(folderPath, 'schema.prisma')}'`);
					}
					
					if (!fs.existsSync(clientIndexTsPath)) {
						console.warn(`⚠️ Prisma client TypeScript definitions not found at: ${clientIndexTsPath}`);
					}
					
					// Dynamic import with timestamp to avoid ES module cache
					const timestamp = Date.now();
					let importPath = clientPath;
					
					// Try import with cache busting
					try {
						// First try with timestamp query (works in some environments)
						importPath = `${clientPath}?t=${timestamp}`;
						clientModule = await import(importPath);
					} catch (timestampError) {
						// Fallback to normal import
						console.log(`🔄 Timestamp import failed, using normal import for ${folderName}`);
						importPath = clientPath;
						clientModule = await import(importPath);
					}
					
					DatabasePrismaClient = clientModule.PrismaClient;
					
					if (!DatabasePrismaClient) {
						throw new Error(`PrismaClient not found in module: ${importPath}. Module exports: ${Object.keys(clientModule || {}).join(', ')}`);
					}
					
					// Verify the client has expected properties
					if (typeof DatabasePrismaClient !== 'function') {
						throw new Error(`PrismaClient is not a constructor function. Type: ${typeof DatabasePrismaClient}`);
					}
					
					console.log(`✅ Successfully loaded Prisma client for ${folderName} from development path`);
					
				} catch (importError: any) {
					console.error(`❌ Failed to load Prisma client from development path for ${folderName}:`, importError);
					
					// Try fallback to dist path if exists (development with build)
					const distClientPath = path.join(process.cwd(), 'dist', 'src', 'app', 'db', folderName, 'client');
					const distClientIndexPath = path.join(distClientPath, 'index.js');
					
					if (fs.existsSync(distClientIndexPath)) {
						console.log(`🔄 Attempting fallback to dist client for ${folderName}...`);
						try {
							let nodeRequire: any;
							try {
								const Module = eval('require')('module');
								nodeRequire = Module.createRequire(__filename);
							} catch (e) {
								nodeRequire = eval('require');
							}
							
							delete nodeRequire.cache[distClientIndexPath];
							clientModule = nodeRequire(distClientIndexPath);
							DatabasePrismaClient = clientModule.PrismaClient;
							
							if (!DatabasePrismaClient) {
								throw new Error(`PrismaClient not found in dist module: ${distClientIndexPath}`);
							}
							
							console.log(`✅ Fallback to dist client successful for ${folderName}`);
						} catch (distError) {
							throw new Error(`Both development and dist client loading failed for ${folderName}. Development error: ${importError.message}, Dist error: ${distError}`);
						}
					} else {
						throw new Error(`Development client loading failed for ${folderName}: ${importError.message}. Dist fallback not available.`);
					}
				}
			}

			// Store the client type constructor for type information
			this.clientTypes.set(folderName, DatabasePrismaClient);

			// Check if database URL is available
			let connectionUrl;
			try {
				connectionUrl = this.getDatabaseUrl(folderName);
			} catch (urlError) {
				console.error(`❌ Database URL not configured for ${folderName}:`, urlError);
				throw urlError;
			}

			// Create Prisma client instance with provider-specific driver adapter
			const adapter = await this.createDriverAdapter(folderName, connectionUrl);
			const clientOptions: any = {
				log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
				errorFormat: 'minimal'
			};
			if (adapter) {
				clientOptions.adapter = adapter;
			}
			const prismaClient = new DatabasePrismaClient(clientOptions);

			// Test the connection with retry logic
			let connectionAttempts = 0;
			const maxAttempts = 3;
			
			while (connectionAttempts < maxAttempts) {
				try {
					await prismaClient.$connect();
					break; // Connection successful
				} catch (connectError) {
					connectionAttempts++;
					// 최종 실패 시에만 로그 출력 (성능 개선)
					if (connectionAttempts >= maxAttempts) {
						console.error(`❌ Connection failed for ${folderName} after ${maxAttempts} attempts:`, connectError);
						throw connectError;
					}
					
					// 짧은 대기 후 재시도 (로그 없음)
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
			}

			// Store the client instance with its original prototype and type information
			this.databases.set(folderName, prismaClient);
			this.configs.set(folderName, {
				name: folderName,
				schemaPath,
				isGenerated: true
			});

			// Initialize reconnection state
			this.reconnectionAttempts.set(folderName, 0);
			this.reconnectionCooldowns.delete(folderName);
			
			// Dynamically extend the DatabaseClientMap interface with the actual client type
			this.extendDatabaseClientMap(folderName, DatabasePrismaClient);

			// Dynamically create getter methods for this database
			this.createDynamicMethods(folderName);

			// 개발 환경에서만 성공 로그 출력
			if (process.env.NODE_ENV === 'development') {
				console.log(`✅ Connected to database: ${folderName}`);
			}
		} catch (error) {
			console.error(`❌ Failed to connect to database ${folderName}:`, error);
			
			// Store failed config for reference
			this.configs.set(folderName, {
				name: folderName,
				schemaPath,
				isGenerated: true // We know it's generated, just connection failed
			});
			
			// Don't throw the error, let the application continue
			throw error;
		}
	}


	/**
	 * Check if Prisma client is generated for a database
	 */
	private async checkIfGenerated(folderName: string): Promise<boolean> {
		try {
			// Check if the specific database schema exists
			const schemaPath = path.join(process.cwd(), 'src', 'app', 'db', folderName, 'schema.prisma');
			if (!fs.existsSync(schemaPath)) {
				return false;
			}

			// Read schema file to check if it has valid content
			const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

			// Check for generator block (any name, not just "client")
			const hasGenerator = /generator\s+\w+\s*{[\s\S]*?provider\s*=\s*["']prisma-client-js["'][\s\S]*?}/m.test(schemaContent);

			// Check for datasource block (any name, not just "db")
			// Prisma 7: url is optional in schema (moved to prisma.config.ts)
			const hasDatasource = /datasource\s+\w+\s*{[\s\S]*?provider\s*=/m.test(schemaContent);

			if (!hasGenerator || !hasDatasource) {
				return false;
			}

			// Check if the generated client directory exists and has the expected files
			const clientPath = path.join(process.cwd(), 'src', 'app', 'db', folderName, 'client');
			if (!fs.existsSync(clientPath)) {
				return false;
			}

			// Check if essential client files exist
			const indexJsPath = path.join(clientPath, 'index.js');
			const packageJsonPath = path.join(clientPath, 'package.json');

			return fs.existsSync(indexJsPath) && fs.existsSync(packageJsonPath);
		} catch (error) {
			return false;
		}
	}

	/**
	 * Read the datasource provider from schema.prisma for a given database folder
	 */
	private getSchemaProvider(folderName: string): string {
		try {
			const schemaPath = path.join(process.cwd(), 'src', 'app', 'db', folderName, 'schema.prisma');
			const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
			// datasource 블록 내의 provider 값만 추출
			const dsBlock = schemaContent.match(/datasource\s+\w+\s*{([\s\S]*?)}/m);
			if (dsBlock) {
				const providerMatch = dsBlock[1].match(/provider\s*=\s*["']([^"']+)["']/);
				if (providerMatch) return providerMatch[1];
			}
		} catch { /* ignore */ }
		return 'postgresql';
	}

	/**
	 * Create a driver adapter based on the schema provider.
	 * Dynamically imports the adapter package only when needed.
	 * Returns null for providers that don't require an adapter (e.g. sqlite).
	 */
	private async createDriverAdapter(folderName: string, connectionUrl: string): Promise<any | null> {
		const provider = this.getSchemaProvider(folderName);

		switch (provider) {
			case 'postgresql':
			case 'postgres': {
				try {
					const { PrismaPg } = await import('@prisma/adapter-pg');
					return new PrismaPg({ connectionString: connectionUrl });
				} catch {
					throw new Error(
						`'@prisma/adapter-pg' 패키지가 필요합니다.\n` +
						`  npm install @prisma/adapter-pg`
					);
				}
			}
			case 'mysql': {
				try {
					const { PrismaMysql } = await import('@prisma/adapter-mysql' as string);
					return new PrismaMysql({ connectionString: connectionUrl });
				} catch {
					throw new Error(
						`'@prisma/adapter-mysql' 패키지가 필요합니다.\n` +
						`  npm install @prisma/adapter-mysql`
					);
				}
			}
			case 'sqlite':
				// SQLite는 어댑터 없이 직접 연결
				return null;
			default:
				console.warn(`⚠️ Unknown provider '${provider}' for ${folderName}, attempting connection without adapter`);
				return null;
		}
	}

	/**
	 * Get database URL by parsing schema.prisma file to extract environment variable
	 * Supports both Prisma 6 (url in schema) and Prisma 7 (url in prisma.config.ts) formats
	 */
	private getDatabaseUrl(folderName: string): string {
		try {
			const schemaPath = path.join(process.cwd(), 'src', 'app', 'db', folderName, 'schema.prisma');
			const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

			// Parse the schema to extract the env variable name (Prisma 6 format)
			const urlMatch = schemaContent.match(/url\s*=\s*env\("([^"]+)"\)/);

			let envVarName: string;
			if (urlMatch && urlMatch[1]) {
				// Prisma 6 format: url = env("DEFAULT_URL")
				envVarName = urlMatch[1];
			} else {
				// Prisma 7 format: url is provided via CLI --url option
				// Use folder name convention to determine env variable
				// Convert folder name to env variable: default -> DEFAULT__KUSTO_RDB_URL, myDatabase -> MY_DATABASE__KUSTO_RDB_URL
				envVarName = folderName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase() + '__KUSTO_RDB_URL';
			}

			let url = process.env[envVarName];
			

			if (!url) {
				throw new Error(`Environment variable ${envVarName} not found for database ${folderName}`);
			}

			// 연결 풀 매개변수가 없으면 추가
			// if (!url.includes('connection_limit') && !url.includes('pool_timeout')) {
			// 	const hasParams = url.includes('?');
			// 	const connector = hasParams ? '&' : '?';
			// 	url += `${connector}connection_limit=5&pool_timeout=10000&connect_timeout=5000`;
			// 	console.log(`📊 Added connection pool settings to ${folderName} database URL`);
			// }

			return url;
		} catch (error) {
			console.error(`Failed to get database URL for ${folderName}:`, error);
			throw new Error(`Failed to get database URL for ${folderName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}	
	
	
	/**
	 * Get datasource name from schema.prisma file
	 */
	private getDatasourceName(folderName: string): string {
		try {
			const schemaPath = path.join(process.cwd(), 'src', 'app', 'db', folderName, 'schema.prisma');
			const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

			// Parse the schema to extract the datasource name
			const datasourceMatch = schemaContent.match(/datasource\s+(\w+)\s*{/);

			if (!datasourceMatch || !datasourceMatch[1]) {
				throw new Error(`Could not parse datasource name from schema for ${folderName}`);
			}

			return datasourceMatch[1];
		} catch (error) {
			console.error(`Failed to get datasource name for ${folderName}:`, error);
			throw new Error(`Failed to get datasource name for ${folderName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}


	/**
	 * Get database provider information for all connected databases
	 */
	public getDatabaseProviders(): Array<{
		database: string;
		provider: string;
		connected: boolean;
	}> {
		const providers: Array<{
			database: string;
			provider: string;
			connected: boolean;
		}> = [];

		for (const config of this.getAllConfigs()) {
			try {
				// Read schema.prisma to get provider
				const schemaPath = path.join(process.cwd(), 'src', 'app', 'db', config.name, 'schema.prisma');
				const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
				const providerMatch = schemaContent.match(/provider\s*=\s*["']([^"']+)["']/);
				
				const provider = providerMatch ? providerMatch[1] : 'unknown';
				
				providers.push({
					database: config.name,
					provider: provider,
					connected: this.isConnected(config.name)
				});
			} catch (error) {
				providers.push({
					database: config.name,
					provider: 'unknown',
					connected: this.isConnected(config.name)
				});
			}
		}

		return providers;
	}

	/**
	 * Get database provider for a specific database
	 */
	public getProviderForDatabase(databaseName: string): string {
		const config = this.getDatabaseConfig(databaseName);
		if (!config) {
			throw new Error(`Database ${databaseName} not found`);
		}

		try {
			const schemaPath = path.join(process.cwd(), 'src', 'app', 'db', databaseName, 'schema.prisma');
			const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
			const providerMatch = schemaContent.match(/provider\s*=\s*["']([^"']+)["']/);
			
			return providerMatch ? providerMatch[1] : 'unknown';
		} catch (error) {
			console.error(`Failed to get provider for ${databaseName}:`, error);
			return 'unknown';
		}
	}

	/**
	 * Reconnect to a specific database
	 * 서버리스 환경에서 슬립 복구 시 자동 재연결을 위해 public으로 노출
	 */
	public async reconnectDatabase(databaseName: string): Promise<boolean> {
		const now = Date.now();
		const attempts = this.reconnectionAttempts.get(databaseName) || 0;

		// 쿨다운 확인: 최근 실패 후 일정 시간 내에는 즉시 실패 반환 (불필요한 재시도 방지)
		const cooldownUntil = this.reconnectionCooldowns.get(databaseName) || 0;
		if (now < cooldownUntil) {
			const remainingSec = Math.ceil((cooldownUntil - now) / 1000);
			console.warn(`⏳ Database '${databaseName}' reconnection in cooldown (${remainingSec}s remaining)`);
			return false;
		}

		// 최대 시도 횟수에 도달하면 쿨다운 설정 후 실패
		if (attempts >= this.MAX_RECONNECTION_ATTEMPTS) {
			console.error(`❌ Max reconnection attempts (${this.MAX_RECONNECTION_ATTEMPTS}) reached for database '${databaseName}', cooldown ${this.RECONNECTION_COOLDOWN_MS / 1000}s`);
			this.reconnectionCooldowns.set(databaseName, now + this.RECONNECTION_COOLDOWN_MS);
			this.reconnectionAttempts.set(databaseName, 0);
			return false;
		}

		try {
			this.reconnectionAttempts.set(databaseName, attempts + 1);

			// 기존 클라이언트 정리 (타임아웃 3초)
			const existingClient = this.databases.get(databaseName);
			if (existingClient) {
				try {
					await Promise.race([
						existingClient.$disconnect(),
						new Promise((_, reject) => setTimeout(() => reject(new Error('Disconnect timeout')), 3000))
					]);
				} catch {
					// 연결 끊기 실패는 무시하고 계속 진행
				}
			}

			// Recreate the client
			await this.recreateClient(databaseName);

			// 성공 시 카운터 및 쿨다운 리셋
			this.reconnectionAttempts.set(databaseName, 0);
			this.reconnectionCooldowns.delete(databaseName);

			console.log(`✅ Successfully reconnected to database '${databaseName}'`);
			return true;

		} catch (error) {
			console.error(`❌ Failed to reconnect to database '${databaseName}' (attempt ${attempts + 1}/${this.MAX_RECONNECTION_ATTEMPTS}):`, error instanceof Error ? error.message : error);
			return false;
		}
	}

	/**
	 * Recreate a client for a specific database
	 * Prisma 7: PrismaPg adapter를 사용하여 연결 재생성
	 * 서버리스 DB 슬립 복구를 위해 충분한 재시도 시간 확보
	 */
	private async recreateClient(databaseName: string): Promise<void> {
		const config = this.configs.get(databaseName);
		if (!config || !config.isGenerated) {
			throw new Error(`Cannot recreate client for '${databaseName}': config not found or not generated`);
		}

		// Get client type constructor
		const DatabasePrismaClient = this.clientTypes.get(databaseName);
		if (!DatabasePrismaClient) {
			throw new Error(`Cannot recreate client for '${databaseName}': client type not found`);
		}

		// Create new Prisma client instance with provider-specific adapter
		const connectionUrl = this.getDatabaseUrl(databaseName);

		const adapter = await this.createDriverAdapter(databaseName, connectionUrl);
		const clientOptions: any = {
			log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
			errorFormat: 'minimal'
		};
		if (adapter) {
			clientOptions.adapter = adapter;
		}
		const prismaClient = new DatabasePrismaClient(clientOptions);

		// 연결 테스트 (재시도 3회, 지수 백오프)
		// 상위 레이어(getWrap, reconnectDatabase)에서도 재시도하므로 여기서는 짧게
		let connectionAttempts = 0;
		const maxAttempts = 3;

		while (connectionAttempts < maxAttempts) {
			try {
				await prismaClient.$connect();
				break;
			} catch (connectError: any) {
				connectionAttempts++;
				if (connectionAttempts >= maxAttempts) {
					throw connectError;
				}
				const delay = 1000 * connectionAttempts; // 1초, 2초
				console.log(`⏳ DB 연결 대기 중 (${connectError.message?.substring(0, 40)}...), ${delay/1000}초 후 재시도... (${connectionAttempts}/${maxAttempts})`);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}

		// Store the new client instance
		this.databases.set(databaseName, prismaClient);
	}

	/**
	 * Get a Prisma client instance by database name with proper typing.
	 *
	 * NOTE: This is the raw client without the lazy reconnect proxy. Use `getWrap()`
	 * if you need the auto-reconnect behavior used in serverless environments.
	 */
	public async getClient<T = any>(databaseName: string): Promise<T> {
		try {
			// Get caller information for hint tracking
			const callerInfo = this.getCallerSourceInfo();
			
			if (!this.initialized) {
				console.error('❌ PrismaManager not initialized. Call initialize() first.');
				console.error(`   Called from: ${callerInfo.filePath}${callerInfo.lineNumber ? `:${callerInfo.lineNumber}` : ''}`);
				throw new Error('데이터베이스 관리자가 초기화되지 않았습니다. 애플리케이션 시작 시 initialize()를 호출했는지 확인하세요.');
			}

			// Check if database exists in configs
			if (!this.configs.has(databaseName)) {
				const availableDbs = Array.from(this.configs.keys());
				const dbList = availableDbs.length > 0 ? availableDbs.join(', ') : '없음';
				console.error(`❌ Database '${databaseName}' not found. Available: ${dbList}`);
				console.error(`   Called from: ${callerInfo.filePath}${callerInfo.lineNumber ? `:${callerInfo.lineNumber}` : ''}`);
				throw new Error(`데이터베이스 '${databaseName}'를 찾을 수 없습니다. 사용 가능한 데이터베이스: ${dbList}`);
			}

			// 개발 모드에서 클라이언트 무결성 검증 및 필요시 새로고침
			if (process.env.NODE_ENV === 'development') {
				const isClientHealthy = await this.verifyAndRefreshClientIfNeeded(databaseName);
				if (!isClientHealthy) {
					console.warn(`⚠️ Client verification failed for ${databaseName}, but continuing...`);
				}
			}

			const client = this.databases.get(databaseName);
			if (!client) {
				console.error(`❌ Database client '${databaseName}' not found`);
				console.error(`   Called from: ${callerInfo.filePath}${callerInfo.lineNumber ? `:${callerInfo.lineNumber}` : ''}`);
				throw new Error(`데이터베이스 '${databaseName}' 클라이언트를 찾을 수 없습니다.`);
			}

			// raw 클라이언트 반환 (재연결 없음, 성능 우선 경로)
			// 서버리스 환경에서 자동 재연결이 필요하면 getWrap() 사용
			return client as T;
		} catch (error) {
			if (error instanceof Error) {
				throw error; // 이미 처리된 오류는 그대로 전달
			}
			throw new Error(`데이터베이스 클라이언트 획득 중 오류가 발생했습니다: ${error}`);
		}
	}

	/**
	 * Get a Prisma client instance synchronously (without reconnection logic)
	 * Use this only when you're sure the connection is healthy
	 * For most cases, use getClient() instead
	 */
	public getClientSync<T = any>(databaseName: string): T {
		try {
			if (!this.initialized) {
				console.error('❌ PrismaManager not initialized. Call initialize() first.');
				throw new Error('데이터베이스 관리자가 초기화되지 않았습니다. 애플리케이션 시작 시 initialize()를 호출했는지 확인하세요.');
			}

			const client = this.databases.get(databaseName);
			if (!client) {
				const availableDbs = Array.from(this.databases.keys());
				const dbList = availableDbs.length > 0 ? availableDbs.join(', ') : '없음';
				console.error(`❌ Database '${databaseName}' not found. Available: ${dbList}`);
				throw new Error(`데이터베이스 '${databaseName}'를 찾을 수 없습니다. 사용 가능한 데이터베이스: ${dbList}`);
			}

			// Return the client with its original type preserved from dynamic import
			return client as T;
		} catch (error) {
			if (error instanceof Error) {
				throw error; // 이미 처리된 오류는 그대로 전달
			}
			throw new Error(`데이터베이스 클라이언트 획득 중 오류가 발생했습니다: ${error}`);
		}
	}

	/**
	 * Extract caller source information from stack trace for hint tracking
	 * @returns Object containing file path and line number information
	 */
	private getCallerSourceInfo(): { filePath: string; lineNumber?: number } {
		const stack = new Error().stack;
		let filePath = 'Unknown';
		let lineNumber: number | undefined;

		// Extract caller file path from stack trace
		if (stack) {
			const stackLines = stack.split('\n');
			// First line is current function, second line is the calling method, third line is the actual user code caller
			const callerLine = stackLines[3] || '';

			// Regular expression to handle both Windows paths (with drive letters) and general paths
			const fileMatch = callerLine.match(/\(([a-zA-Z]:\\[^:]+|\/?[^:]+):(\d+):(\d+)\)/) ||
				callerLine.match(/at\s+([a-zA-Z]:\\[^:]+|\/?[^:]+):(\d+):(\d+)/);

			if (fileMatch) {
				filePath = fileMatch[1];
				lineNumber = parseInt(fileMatch[2], 10);
			}
		}

		return { filePath, lineNumber };
	}

	/**
	 * Prisma 에러 코드 (공식 문서 기반)
	 * @see https://www.prisma.io/docs/reference/api-reference/error-reference
	 */
	private static readonly PRISMA_CONNECTION_ERROR_CODES = new Set([
		// Common errors (P1xxx) - 연결 관련
		'P1001', // Can't reach database server
		'P1002', // Database server was reached but timed out
		'P1003', // Database does not exist
		'P1008', // Operations timed out
		'P1009', // Database already exists
		'P1010', // User was denied access
		'P1011', // Error opening a TLS connection
		'P1012', // Schema validation error (잘못된 연결 문자열 포함)
		'P1013', // Invalid database string
		'P1014', // Underlying model does not exist
		'P1015', // Schema using features not supported
		'P1016', // Raw query parameter count mismatch
		'P1017', // Server has closed the connection
		
		// Query engine errors (P2xxx) - 연결 풀/타임아웃 관련
		'P2024', // Timed out fetching a new connection from pool
	]);

	/**
	 * PostgreSQL 에러 코드 (공식 문서 기반)
	 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
	 */
	private static readonly POSTGRES_CONNECTION_ERROR_CODES = new Set([
		// Class 08 — Connection Exception
		'08000', // connection_exception
		'08003', // connection_does_not_exist
		'08006', // connection_failure
		'08001', // sqlclient_unable_to_establish_sqlconnection
		'08004', // sqlserver_rejected_establishment_of_sqlconnection
		'08007', // transaction_resolution_unknown
		'08P01', // protocol_violation
		
		// Class 53 — Insufficient Resources
		'53000', // insufficient_resources
		'53100', // disk_full
		'53200', // out_of_memory
		'53300', // too_many_connections
		
		// Class 57 — Operator Intervention
		'57000', // operator_intervention
		'57014', // query_canceled
		'57P01', // admin_shutdown
		'57P02', // crash_shutdown
		'57P03', // cannot_connect_now (DB starting up)
		'57P04', // database_dropped
		
		// Class 58 — System Error
		'58000', // system_error
		'58030', // io_error
		
		// Class XX — Internal Error
		'XX000', // internal_error
		'XX001', // data_corrupted
		'XX002', // index_corrupted
	]);

	/**
	 * Node.js 시스템 에러 코드
	 */
	private static readonly NODEJS_CONNECTION_ERROR_CODES = new Set([
		'ECONNREFUSED',   // 연결 거부됨
		'ECONNRESET',     // 연결이 리셋됨
		'ENOTFOUND',      // DNS 조회 실패
		'ETIMEDOUT',      // 연결 타임아웃
		'ECONNABORTED',   // 연결이 중단됨
		'EHOSTUNREACH',   // 호스트에 도달할 수 없음
		'ENETUNREACH',    // 네트워크에 도달할 수 없음
		'EPIPE',          // 파이프가 끊어짐
		'EAI_AGAIN',      // DNS 일시적 실패
	]);

	/**
	 * 연결 오류인지 판단 (서버리스 슬립 복구용)
	 * 공식 에러 코드 기반으로 정확하게 판단
	 */
	private isConnectionError(error: any): boolean {
		if (!error) return false;

		// 1. Prisma 에러 코드 체크
		const prismaCode = error.code;
		if (prismaCode && PrismaManager.PRISMA_CONNECTION_ERROR_CODES.has(prismaCode)) {
			return true;
		}

		// 2. PostgreSQL 에러 코드 체크 (Prisma가 내부적으로 전달하는 경우)
		const pgCode = error.meta?.code || error.errorCode;
		if (pgCode && PrismaManager.POSTGRES_CONNECTION_ERROR_CODES.has(pgCode)) {
			return true;
		}

		// 3. Node.js 시스템 에러 코드 체크
		const nodeCode = error.code || error.cause?.code;
		if (nodeCode && PrismaManager.NODEJS_CONNECTION_ERROR_CODES.has(nodeCode)) {
			return true;
		}

		// 4. PrismaClientKnownRequestError / PrismaClientInitializationError 체크
		const errorName = error.constructor?.name || error.name;
		if (errorName === 'PrismaClientInitializationError') {
			return true; // 초기화 에러는 항상 연결 문제
		}

		// 5. 중첩된 cause 체크 (에러 체이닝)
		if (error.cause && this.isConnectionError(error.cause)) {
			return true;
		}

		return false;
	}

	/**
	 * Get a wrapped client with automatic reconnection on connection errors
	 * 성능 최적화: 정상 동작 시 오버헤드 없음, 연결 오류 시에만 재연결 시도
	 * 서버리스 DB 슬립 복구를 위해 충분한 재시도 시간 확보
	 * Synchronous version for use in repositories
	 */
	public getWrap(databaseName: string): any {
		try {
			if (!this.initialized) {
				throw new Error('데이터베이스 관리자가 초기화되지 않았습니다. 애플리케이션 시작 시 initialize()를 호출했는지 확인하세요.');
			}

			const existingClient = this.databases.get(databaseName);
			if (!existingClient) {
				const availableDbs = Array.from(this.databases.keys());
				const dbList = availableDbs.length > 0 ? availableDbs.join(', ') : '없음';
				throw new Error(`데이터베이스 '${databaseName}'를 찾을 수 없습니다. 사용 가능한 데이터베이스: ${dbList}`);
			}

			// Proxy를 사용하여 모든 접근에 자동 재연결 로직 적용
			const manager = this;

			/**
			 * 연결 오류 시 재연결 후 재시도하는 래퍼 함수 생성
			 * @param executeFn 실제 실행할 함수 (최신 클라이언트에서 호출)
			 */
			const createRetryWrapper = (executeFn: (...args: any[]) => Promise<any>) => {
				return async function(...args: any[]) {
					const maxRetries = 3;
					const baseDelay = 2000; // 2초부터 시작
					let lastError: Error | null = null;

					for (let attempt = 0; attempt <= maxRetries; attempt++) {
						try {
							return await executeFn(...args);
						} catch (error: any) {
							lastError = error;

							if (manager.isConnectionError(error) && attempt < maxRetries) {
								const delay = Math.min(baseDelay * Math.pow(1.5, attempt), 8000);
								console.log(`🔄 DB 연결 오류 감지 (${error.message?.substring(0, 50)}...), ${delay/1000}초 후 재시도... (${attempt + 1}/${maxRetries})`);

								await new Promise(resolve => setTimeout(resolve, delay));

								try {
									await manager.reconnectDatabase(databaseName);
								} catch {
									// 재연결 실패해도 다음 시도에서 다시 시도
								}
								continue;
							}

							throw error;
						}
					}

					throw lastError;
				};
			};

			// 재연결 래핑이 불필요한 $ 메서드 (연결 관리용)
			const noWrapMethods = new Set(['$connect', '$disconnect', '$on', '$extends']);

			return new Proxy(existingClient, {
				get(target, prop, receiver) {
					const value = Reflect.get(target, prop, receiver);
					const propStr = String(prop);

					// Symbol이나 래핑 불필요한 메서드는 그대로 반환
					if (typeof prop === 'symbol' || noWrapMethods.has(propStr)) {
						return value;
					}

					// $ 접두사 함수 ($transaction, $queryRaw, $queryRawUnsafe, $executeRaw 등)
					// 연결 오류 시 재연결 후 재시도
					if (propStr.startsWith('$') && typeof value === 'function') {
						return createRetryWrapper(async (...args: any[]) => {
							const currentClient = manager.databases.get(databaseName);
							return await (currentClient as any)[prop](...args);
						});
					}

					// 비-객체 (string, number, boolean 등) 그대로 반환
					if (typeof value !== 'object' || value === null) {
						return value;
					}

					// Prisma 모델 객체 (user, post 등)에 대한 Proxy
					return new Proxy(value, {
						get(modelTarget, modelProp, modelReceiver) {
							const modelValue = Reflect.get(modelTarget, modelProp, modelReceiver);

							if (typeof modelValue !== 'function') {
								return modelValue;
							}

							// Prisma 쿼리 메서드를 래핑 (findFirst, findMany, create, update 등)
							return createRetryWrapper(async (...args: any[]) => {
								const currentClient = manager.databases.get(databaseName);
								const currentModel = (currentClient as any)[prop];
								return await currentModel[modelProp](...args);
							});
						}
					});
				}
			});

		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error(`데이터베이스 래핑된 클라이언트 획득 중 오류가 발생했습니다: ${error}`);
		}
	}

	/**
	 * Get a wrapped client (async version)
	 * getWrap()과 동일한 재연결 로직을 포함하며, 추가로 타입 정보를 보존합니다.
	 * 내부적으로 getWrap()을 사용하여 재연결 Proxy를 적용합니다.
	 */
	public async getWrapAsync(databaseName: string): Promise<any> {
		// getWrap이 이미 모든 재연결 로직을 가지고 있으므로 위임
		return this.getWrap(databaseName);
	}

	/**
	 * Get a client with runtime type checking and enhanced type information
	 */
	public async getTypedClient(databaseName: string) {
		const client = await this.getClient(databaseName);
		const clientType = this.clientTypes.get(databaseName);

		// Add runtime type information
		Object.defineProperty(client, '__databaseName', {
			value: databaseName,
			writable: false,
			enumerable: false
		});

		Object.defineProperty(client, '__clientType', {
			value: clientType,
			writable: false,
			enumerable: false
		});

		return client;
	}



	
	/**
	 * Dynamically create a typed getter method for any database
	 * This preserves the original client type from dynamic import
	 */
	public createTypedGetter(databaseName: string) {
		const client = this.databases.get(databaseName);
		const clientType = this.clientTypes.get(databaseName);

		if (!client || !clientType) {
			throw new Error(`Database '${databaseName}' not found or not properly initialized`);
		}

		// Return a function that provides the typed client (synchronous)
		return () => {
			return this.getWrap(databaseName);
		};
	}

	/**
	 * Get all available database names
	 */
	public getAvailableDatabases(): string[] {
		return Array.from(this.databases.keys());
	}

	/**
	 * Get database configuration
	 */
	public getDatabaseConfig(databaseName: string): DatabaseConfig | undefined {
		return this.configs.get(databaseName);
	}

	/**
	 * Get all database configurations
	 */
	public getAllConfigs(): DatabaseConfig[] {
		return Array.from(this.configs.values());
	}

	/**
	 * Check if a database is connected
	 */
	public isConnected(databaseName: string): boolean {
		return this.databases.has(databaseName);
	}

	/**
	 * Disconnect all databases
	 */
	public async disconnectAll(): Promise<void> {
		const disconnectPromises = Array.from(this.databases.values()).map(client =>
			client.$disconnect().catch((error: any) =>
				console.error('Error disconnecting Prisma client:', error)
			)
		);

		await Promise.all(disconnectPromises);
		this.databases.clear();
		this.initialized = false;
		console.log('All Prisma clients disconnected');
	}

	/**
	 * Get connection status
	 */
	public getStatus(): {
		initialized: boolean;
		connectedDatabases: number;
		totalDatabases: number;
		databases: { name: string; connected: boolean; generated: boolean }[];
	} {
		return {
			initialized: this.initialized,
			connectedDatabases: this.databases.size,
			totalDatabases: this.configs.size,
			databases: Array.from(this.configs.values()).map(config => ({
				name: config.name,
				connected: this.isConnected(config.name),
				generated: config.isGenerated
			}))
		};
	}
	/**
	 * Execute a transaction across multiple databases
	 * Note: This is for separate transactions, not distributed transactions
	 */
	public async executeTransactions<T>(
		operations: Array<{
			database: string;
			operation: (client: any) => Promise<T>;
		}>
	): Promise<T[]> {
		const results: T[] = [];
		for (const { database, operation } of operations) {
			// getWrap을 사용하여 서버리스 재연결 지원
			const client = this.getWrap(database);
			const result = await client.$transaction(async (tx: any) => {
				return operation(tx);
			});
			results.push(result);
		}

		return results;
	}

	/**
	 * Get raw database connection for custom queries
	 * 서버리스 재연결을 지원하기 위해 getWrap을 사용합니다.
	 */
	public async executeRawQuery<T = any>(
		database: string,
		query: string,
		params?: any[]
	): Promise<T[]> {
		const client = this.getWrap(database);
		return client.$queryRawUnsafe(query, ...(params || []));
	}

	/**
	 * Health check for all connected databases
	 */
	public async healthCheck(): Promise<{
		overall: 'healthy' | 'degraded' | 'unhealthy';
		databases: Array<{
			name: string;
			status: 'healthy' | 'unhealthy' | 'not-connected';
			responseTime?: number;
			error?: string;
		}>;
	}> {
		const results = [];
		let healthyCount = 0;
		for (const dbName of this.getAvailableDatabases()) {
			const start = Date.now();
			try {
				const client = await this.getClient(dbName);
				// 프로바이더별 헬스체크 쿼리
				const provider = this.getSchemaProvider(dbName);
				if (provider === 'sqlite') {
					await client.$queryRawUnsafe('SELECT 1');
				} else {
					await client.$queryRaw`SELECT 1 as health_check`;
				}
				const responseTime = Date.now() - start;

				results.push({
					name: dbName,
					status: 'healthy' as const,
					responseTime
				});
				healthyCount++;
			} catch (error) {
				results.push({
					name: dbName,
					status: 'unhealthy' as const,
					error: error instanceof Error ? error.message : 'Unknown error'
				});
			}
		}

		// Add not-connected databases
		for (const config of this.getAllConfigs()) {
			if (!this.isConnected(config.name)) {
				results.push({
					name: config.name,
					status: 'not-connected' as const
				});
			}
		}

		const totalConnected = this.getAvailableDatabases().length;
		let overall: 'healthy' | 'degraded' | 'unhealthy';

		if (healthyCount === totalConnected && totalConnected > 0) {
			overall = 'healthy';
		} else if (healthyCount > 0) {
			overall = 'degraded';
		} else {
			overall = 'unhealthy';
		}

		return {
			overall,
			databases: results
		};
	}
	/**
	 * Dynamically create typed getter methods for each database
	 */
	private createDynamicMethods(databaseName: string): void {
		const methodName = `get${databaseName.charAt(0).toUpperCase() + databaseName.slice(1)}Client`;

		// Only create the method if it doesn't already exist
		if (!(this as any)[methodName]) {
			(this as any)[methodName] = () => {
				return this.getWrap(databaseName);
			};
		}
	}

	/**
	 * Force refresh a specific database client
	 * Useful when schema changes or client is out of sync
	 */
	public async forceRefreshClient(databaseName: string): Promise<void> {
		console.log(`🔄 Force refreshing client for database: ${databaseName}`);
		
		// Disconnect existing client
		const existingClient = this.databases.get(databaseName);
		if (existingClient && typeof existingClient.$disconnect === 'function') {
			try {
				await existingClient.$disconnect();
			} catch (error) {
				console.warn(`⚠️ Error disconnecting existing client: ${error}`);
			}
		}

		// Clear from cache
		this.databases.delete(databaseName);
		this.reconnectionAttempts.delete(databaseName);
		this.reconnectionCooldowns.delete(databaseName);

		// 개발 모드에서 더 적극적인 캐시 클리어
		if (process.env.NODE_ENV === 'development') {
			const config = this.configs.get(databaseName);
			if (config) {
				const clientPath = path.join(process.cwd(), 'src', 'app', 'db', databaseName, 'client');
				const normalizedClientPath = clientPath.replace(/\\/g, '/');
				
				// Clear all cached modules related to this client (cross-platform)
				Object.keys(require.cache).forEach(key => {
					const normalizedKey = key.replace(/\\/g, '/');
					if (normalizedKey.includes(normalizedClientPath) || 
						normalizedKey.includes(`/db/${databaseName}/client`) ||
						normalizedKey.includes(`\\db\\${databaseName}\\client`)) {
						delete require.cache[key];
						console.log(`🗑️ Cleared cache for: ${key}`);
					}
				});
				
				// Also clear any related prisma cache but be more selective
				Object.keys(require.cache).forEach(key => {
					const normalizedKey = key.replace(/\\/g, '/');
					if (normalizedKey.includes(`/db/${databaseName}/`) && 
						(normalizedKey.includes('@prisma') || normalizedKey.includes('prisma'))) {
						delete require.cache[key];
						console.log(`🗑️ Cleared Prisma cache for: ${key}`);
					}
				});
			}
		}

		// Process the database folder again to recreate the client
		try {
			const dbPath = path.join(process.cwd(), 'src', 'app', 'db');
			await this.processDatabaseFolder(databaseName, dbPath);
			console.log(`✅ Client refreshed for database: ${databaseName}`);
		} catch (error) {
			console.error(`❌ Failed to refresh client for database: ${databaseName}`, error);
			throw error;
		}
	}

	/**
	 * Force refresh all database clients
	 */
	public async forceRefreshAllClients(): Promise<void> {
		console.log('🔄 Force refreshing all database clients...');
		
		const databases = Array.from(this.databases.keys());
		for (const dbName of databases) {
			await this.forceRefreshClient(dbName);
		}
		
		console.log('✅ All clients refreshed');
	}

	/**
	 * Development mode: Verify client integrity and regenerate if needed
	 */
	public async verifyAndRefreshClientIfNeeded(databaseName: string): Promise<boolean> {
		if (process.env.NODE_ENV !== 'development') {
			return true; // Skip verification in production
		}

		try {
			const config = this.configs.get(databaseName);
			if (!config) {
				console.warn(`⚠️ Database config not found for: ${databaseName}`);
				return false;
			}

			const clientPath = path.join(process.cwd(), 'src', 'app', 'db', databaseName, 'client');
			const schemaPath = path.join(process.cwd(), 'src', 'app', 'db', databaseName, 'schema.prisma');
			
			// Check if schema file exists
			if (!fs.existsSync(schemaPath)) {
				console.error(`❌ Schema file not found: ${schemaPath}`);
				return false;
			}

			// Check if client files exist
			const clientIndexPath = path.join(clientPath, 'index.js');
			const clientIndexTsPath = path.join(clientPath, 'index.d.ts');
			
			if (!fs.existsSync(clientIndexPath) || !fs.existsSync(clientIndexTsPath)) {
				console.log(`🔧 Client files missing for ${databaseName}, regenerating...`);
				
				// Try to regenerate the client
				const { spawn } = require('child_process');
				return new Promise((resolve) => {
					const generateProcess = spawn('npx', ['prisma', 'generate', `--schema=${schemaPath}`], {
						stdio: 'inherit',
						shell: true
					});
					
					generateProcess.on('close', async (code: number | null) => {
						if (code === 0) {
							console.log(`✅ Client regenerated for ${databaseName}`);
							try {
								await this.forceRefreshClient(databaseName);
								resolve(true);
							} catch (error) {
								console.error(`❌ Failed to refresh after regeneration: ${error}`);
								resolve(false);
							}
						} else {
							console.error(`❌ Failed to regenerate client for ${databaseName}`);
							resolve(false);
						}
					});
				});
			}

			// Check if current client is working
			const client = this.databases.get(databaseName);
			if (!client) {
				console.log(`🔧 Client not loaded for ${databaseName}, refreshing...`);
				await this.forceRefreshClient(databaseName);
				return this.databases.has(databaseName);
			}

			return true;
		} catch (error) {
			console.error(`❌ Client verification failed for ${databaseName}:`, error);
			return false;
		}
	}

  /**
   * Dynamically extend the DatabaseClientMap interface with the actual client type
   */
	private extendDatabaseClientMap(databaseName: string, ClientType: any): void {
		// Store the client type for runtime access and type information
		this.clientTypes.set(databaseName, ClientType);

		// Create a runtime type registry for better type inference
		if (!(globalThis as any).__prismaClientTypes) {
			(globalThis as any).__prismaClientTypes = {};
		}
		(globalThis as any).__prismaClientTypes[databaseName] = ClientType;
	}
}

// Export a default instance for easy access
export const prismaManager = PrismaManager.getInstance();