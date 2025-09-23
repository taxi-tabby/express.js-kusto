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
	private connectionStates: Map<string, { connected: boolean; lastChecked: number }> = new Map();
	private reconnectionAttempts: Map<string, number> = new Map();
	private readonly MAX_RECONNECTION_ATTEMPTS = 2; // 빠른 실패


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
			
			// Enhanced serverless environment detection and handling
			const isWebpackBuild = process.env.WEBPACK_BUILD === 'true' || 
								   process.env.NODE_ENV === 'production' ||
								   fs.existsSync(path.join(process.cwd(), 'dist', 'server.js'));
			
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

			// Get datasource name
			const datasourceName = this.getDatasourceName(folderName);

			// Create Prisma client instance with database URL and connection pool settings
			const prismaClient = new DatabasePrismaClient({
				datasources: {
					[datasourceName]: {
						url: connectionUrl
					}
				},
				// 올바른 연결 풀 설정
				log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
				errorFormat: 'minimal'
			});

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

			// Initialize connection state
			this.connectionStates.set(folderName, {
				connected: true,
				lastChecked: Date.now()
			});
			this.reconnectionAttempts.set(folderName, 0);
			
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
			const hasDatasource = /datasource\s+\w+\s*{[\s\S]*?provider\s*=[\s\S]*?url\s*=[\s\S]*?}/m.test(schemaContent);

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
	 * Get database URL by parsing schema.prisma file to extract environment variable
	 */
	private getDatabaseUrl(folderName: string): string {
		try {
			const schemaPath = path.join(process.cwd(), 'src', 'app', 'db', folderName, 'schema.prisma');
			const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

			// Parse the schema to extract the env variable name
			const urlMatch = schemaContent.match(/url\s*=\s*env\("([^"]+)"\)/);

			if (!urlMatch || !urlMatch[1]) {
				throw new Error(`Could not parse database URL from schema for ${folderName}`);
			}

			const envVarName = urlMatch[1];
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
	 * 서버리스 최적화: 사전 헬스체크 없이 요청 시점에만 연결 확인
	 * Check if connection is healthy and reconnect if necessary
	 */
	private async ensureConnection(databaseName: string): Promise<boolean> {
		const connectionState = this.connectionStates.get(databaseName);
		const now = Date.now();

		// 서버리스 최적화: 사전 헬스체크를 완전히 제거
		// 단순히 연결 상태만 확인하고, 실제 연결은 getClient에서 시도
		if (connectionState && connectionState.connected) {
			return true;
		}

		// 연결 상태가 없거나 연결되지 않은 상태라면 연결된 것으로 가정
		// 실제 연결 실패는 getClient()에서 catch하여 재연결 처리
		this.connectionStates.set(databaseName, {
			connected: true,
			lastChecked: now
		});

		return true;
	}

	/**
	 * 서버리스 최적화: 간단한 연결 상태 체크 (실제 쿼리 없음)
	 * Check if a specific database connection is healthy
	 */
	private async checkConnectionHealth(databaseName: string): Promise<boolean> {
		try {
			// 서버리스에서는 실제 헬스체크 쿼리를 실행하지 않음
			// 단순히 클라이언트가 존재하는지만 확인
			const client = this.databases.get(databaseName);
			return !!client;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Reconnect to a specific database
	 */
	private async reconnectDatabase(databaseName: string): Promise<boolean> {
		const attempts = this.reconnectionAttempts.get(databaseName) || 0;
		
		// 빠른 포기: 최대 시도 횟수에 도달하면 즉시 실패 처리 (성능 개선)
		if (attempts >= this.MAX_RECONNECTION_ATTEMPTS) {
			console.error(`❌ Max reconnection attempts (${this.MAX_RECONNECTION_ATTEMPTS}) reached for database '${databaseName}'`);
			this.connectionStates.set(databaseName, {
				connected: false,
				lastChecked: Date.now()
			});
			// 재연결 시도 카운터를 리셋하여 일정 시간 후 다시 시도 가능하게 함
			this.reconnectionAttempts.set(databaseName, 0);
			return false;
		}

		try {
			// Increment attempt counter
			this.reconnectionAttempts.set(databaseName, attempts + 1);

			// 기존 클라이언트 정리를 더 간단하게 처리 (성능 개선)
			const existingClient = this.databases.get(databaseName);
			if (existingClient) {
				try {
					// 타임아웃을 짧게 설정하여 빠른 정리
					await Promise.race([
						existingClient.$disconnect(),
						new Promise((_, reject) => setTimeout(() => reject(new Error('Disconnect timeout')), 3000))
					]);
				} catch (disconnectError) {
					// 연결 끊기 실패는 무시하고 계속 진행 (로그 제거)
				}
			}

			// Recreate the client
			await this.recreateClient(databaseName);

			// Reset attempt counter on successful reconnection
			this.reconnectionAttempts.set(databaseName, 0);
			this.connectionStates.set(databaseName, {
				connected: true,
				lastChecked: Date.now()
			});

			// 개발 환경에서만 재연결 성공 로그 출력
			if (process.env.NODE_ENV === 'development') {
				console.log(`✅ Successfully reconnected to database '${databaseName}'`);
			}
			return true;

		} catch (error) {
			console.error(`❌ Failed to reconnect to database '${databaseName}':`, error);
			this.connectionStates.set(databaseName, {
				connected: false,
				lastChecked: Date.now()
			});
			return false;
		}
	}

	/**
	 * Recreate a client for a specific database
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

		// Create new Prisma client instance
		const connectionUrl = this.getDatabaseUrl(databaseName);
		const datasourceName = this.getDatasourceName(databaseName);

		const prismaClient = new DatabasePrismaClient({
			datasources: {
				[datasourceName]: {
					url: connectionUrl
				}
			},
			// 올바른 연결 풀 설정
			log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
			errorFormat: 'minimal'
		});

		// Test the connection
		await prismaClient.$connect();

		// Store the new client instance
		this.databases.set(databaseName, prismaClient);
	}

	/**
	 * Get a Prisma client instance by database name with proper typing
	 * Includes automatic reconnection logic for serverless environments
	 * Returns the actual client with full type information preserved from dynamic import
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

			// 서버리스 최적화: 사전 연결 체크 제거, 실제 사용 시점에 재연결 시도
			// ensureConnection을 생략하고 바로 클라이언트 사용 시도
			const client = this.databases.get(databaseName);
			if (!client) {
				console.error(`❌ Database client '${databaseName}' not found`);
				console.error(`   Called from: ${callerInfo.filePath}${callerInfo.lineNumber ? `:${callerInfo.lineNumber}` : ''}`);
				throw new Error(`데이터베이스 '${databaseName}' 클라이언트를 찾을 수 없습니다.`);
			}

			// 클라이언트 반환 - 실제 쿼리 실행 시 연결 오류가 발생하면 그때 재연결
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
	 * Get a wrapped client with enhanced type information and runtime type checking
	 * This method provides the best TypeScript intellisense by preserving the original client type
	 * Synchronous version for use in repositories
	 */
	public getWrap(databaseName: string): any {
		try {
			if (!this.initialized) {
				throw new Error('데이터베이스 관리자가 초기화되지 않았습니다. 애플리케이션 시작 시 initialize()를 호출했는지 확인하세요.');
			}

			// 기존 클라이언트를 재사용 - 새로운 인스턴스를 생성하지 않음
			const existingClient = this.databases.get(databaseName);
			if (!existingClient) {
				const availableDbs = Array.from(this.databases.keys());
				const dbList = availableDbs.length > 0 ? availableDbs.join(', ') : '없음';
				throw new Error(`데이터베이스 '${databaseName}'를 찾을 수 없습니다. 사용 가능한 데이터베이스: ${dbList}`);
			}

			return existingClient;

		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error(`데이터베이스 래핑된 클라이언트 획득 중 오류가 발생했습니다: ${error}`);
		}
	}

	/**
	 * Get a wrapped client with enhanced type information and runtime type checking (async version)
	 * This method provides the best TypeScript intellisense by preserving the original client type
	 * Includes automatic reconnection logic
	 */
	public async getWrapAsync(databaseName: string): Promise<any> {
		try {
			// getClient 내부에서 이미 예외 처리를 하므로 여기서 추가로 할 필요는 없음
			const client = await this.getClient(databaseName);
			const clientType = this.clientTypes.get(databaseName);

			if (!clientType) {
				console.warn(`⚠️ Database '${databaseName}' client type not found, returning basic client.`);
				return client;
			}

			// Create a proxy that preserves the original client prototype and type information
			const wrappedClient = new Proxy(client, {
				get(target, prop, receiver) {
					try {
						const value = Reflect.get(target, prop, receiver);

						// If it's a function, bind it to the original target
						if (typeof value === 'function') {
							return value.bind(target);
						}

						return value;
					} catch (error) {
						console.error(`❌ Error accessing property '${String(prop)}' on database client: ${error}`);
						throw new Error(`데이터베이스 클라이언트 속성 '${String(prop)}' 접근 중 오류: ${error}`);
					}
				},

				getPrototypeOf() {
					return clientType.prototype;
				},

				has(target, prop) {
					return prop in target || prop in clientType.prototype;
				},

				getOwnPropertyDescriptor(target, prop) {
					const desc = Reflect.getOwnPropertyDescriptor(target, prop);
					if (desc) return desc;
					return Reflect.getOwnPropertyDescriptor(clientType.prototype, prop);
				}
			});

			return wrappedClient;

		} catch (error) {
			if (error instanceof Error) {
				throw error; // getClient에서 이미 처리된 오류는 그대로 전달
			}
			throw new Error(`데이터베이스 래핑된 클라이언트 획득 중 오류가 발생했습니다: ${error}`);
		}
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
			const client = await this.getClient(database);
			const result = await client.$transaction(async (tx: any) => {
				return operation(tx);
			});
			results.push(result);
		}

		return results;
	}

	/**
	 * Get raw database connection for custom queries
	 */
	public async executeRawQuery<T = any>(
		database: string,
		query: string,
		params?: any[]
	): Promise<T[]> {
		const client = await this.getClient(database);
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
				await client.$queryRaw`SELECT 1 as health_check`;
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
		this.connectionStates.delete(databaseName);
		this.reconnectionAttempts.delete(databaseName);

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