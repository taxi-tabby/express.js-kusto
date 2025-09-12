// filepath: r:\project\express.js-kusto\src\core\lib\prismaManager.ts

import { PrismaClient } from '@prisma/client';
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
	private readonly CONNECTION_CHECK_INTERVAL = 30000; // 30초
	private readonly MAX_RECONNECTION_ATTEMPTS = 3;


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

		console.log(`Found ${folders.length} database folders:`, folders);

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
		
		// Log final status
		const connectedCount = this.databases.size;
		const totalCount = folders.length;
		
		if (connectedCount === 0) {
			console.warn('⚠️ PrismaManager initialized but no databases are connected');
		} else {
			console.log(`✅ PrismaManager initialized successfully (${connectedCount}/${totalCount} databases connected)`);
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
				// Development environment - use normal dynamic import
				const clientPath = path.join(folderPath, 'client');
				clientModule = await import(clientPath);
				DatabasePrismaClient = clientModule.PrismaClient;
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

			// Create Prisma client instance with database URL
			const prismaClient = new DatabasePrismaClient({
				datasources: {
					[datasourceName]: {
						url: connectionUrl
					}
				}
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
					console.warn(`⚠️ Connection attempt ${connectionAttempts}/${maxAttempts} failed for ${folderName}:`, connectError);
					
					if (connectionAttempts >= maxAttempts) {
						throw connectError;
					}
					
					// Wait before retry
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

			console.log(`✅ Connected to database: ${folderName}`);
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
			const url = process.env[envVarName];
			

			if (!url) {
				throw new Error(`Environment variable ${envVarName} not found for database ${folderName}`);
			}

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
	 * Check if connection is healthy and reconnect if necessary
	 */
	private async ensureConnection(databaseName: string): Promise<boolean> {
		const connectionState = this.connectionStates.get(databaseName);
		const now = Date.now();

		// If recently checked and was healthy, assume still connected
		if (connectionState && connectionState.connected && 
			(now - connectionState.lastChecked) < this.CONNECTION_CHECK_INTERVAL) {
			return true;
		}

		// Check actual connection health
		const isHealthy = await this.checkConnectionHealth(databaseName);
		
		if (!isHealthy) {
			console.log(`🔄 Connection lost for database '${databaseName}', attempting reconnection...`);
			return await this.reconnectDatabase(databaseName);
		}

		// Update connection state
		this.connectionStates.set(databaseName, {
			connected: true,
			lastChecked: now
		});

		return true;
	}

	/**
	 * Check if a specific database connection is healthy
	 */
	private async checkConnectionHealth(databaseName: string): Promise<boolean> {
		try {
			const client = this.databases.get(databaseName);
			if (!client) return false;

			// Simple query to check connection
			await client.$queryRaw`SELECT 1 as health_check`;
			return true;
		} catch (error) {
			console.warn(`⚠️ Connection health check failed for '${databaseName}':`, error);
			return false;
		}
	}

	/**
	 * Reconnect to a specific database
	 */
	private async reconnectDatabase(databaseName: string): Promise<boolean> {
		const attempts = this.reconnectionAttempts.get(databaseName) || 0;
		
		if (attempts >= this.MAX_RECONNECTION_ATTEMPTS) {
			console.error(`❌ Max reconnection attempts reached for database '${databaseName}'`);
			this.connectionStates.set(databaseName, {
				connected: false,
				lastChecked: Date.now()
			});
			return false;
		}

		try {
			// Increment attempt counter
			this.reconnectionAttempts.set(databaseName, attempts + 1);

			// Disconnect existing client
			const existingClient = this.databases.get(databaseName);
			if (existingClient) {
				try {
					await existingClient.$disconnect();
				} catch (disconnectError) {
					console.warn(`Warning during disconnect:`, disconnectError);
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

			console.log(`✅ Successfully reconnected to database '${databaseName}'`);
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
			}
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

			// Log successful database access with hint
			// console.log(`🗃️ Accessing database '${databaseName}' from: ${callerInfo.filePath}${callerInfo.lineNumber ? `:${callerInfo.lineNumber}` : ''}`);

			// Ensure connection is healthy (includes automatic reconnection)
			const isConnected = await this.ensureConnection(databaseName);
			if (!isConnected) {
				console.error(`❌ Failed to connect to database '${databaseName}'`);
				console.error(`   Called from: ${callerInfo.filePath}${callerInfo.lineNumber ? `:${callerInfo.lineNumber}` : ''}`);
				throw new Error(`데이터베이스 '${databaseName}'에 연결할 수 없습니다. 재연결 시도가 실패했습니다.`);
			}

			const client = this.databases.get(databaseName);
			if (!client) {
				console.error(`❌ Database client '${databaseName}' not found`);
				console.error(`   Called from: ${callerInfo.filePath}${callerInfo.lineNumber ? `:${callerInfo.lineNumber}` : ''}`);
				throw new Error(`데이터베이스 '${databaseName}' 클라이언트를 찾을 수 없습니다.`);
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
			// 항상 최신 클라이언트를 로드하여 모델 동기화 보장
			try {
				const clientPath = `@app/db/${databaseName}/client`;
				delete require.cache[require.resolve(clientPath)];
				const { PrismaClient: FreshClientType } = require(clientPath);
				const freshClient = new FreshClientType();
				
				// 새로운 클라이언트로 업데이트
				this.databases.set(databaseName, freshClient);
				this.clientTypes.set(databaseName, FreshClientType);
				return freshClient;
			} catch (error) {
				console.error(`❌ Failed to reload fresh client, using cached:`, error);
				// 새로운 클라이언트 로드 실패 시 기존 클라이언트 반환
				return this.getClientSync(databaseName);
			}

		} catch (error) {
			if (error instanceof Error) {
				throw error; // getClientSync에서 이미 처리된 오류는 그대로 전달
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
	}  /**
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