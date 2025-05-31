// filepath: r:\project\express.js-kusto\src\core\lib\prismaManager.ts

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
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

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {}

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

    const dbPath = path.join(process.cwd(), 'src', 'app', 'db');
    
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database directory not found: ${dbPath}`);
    }

    // Read all folders in src/app/db
    const folders = fs.readdirSync(dbPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    console.log(`Found ${folders.length} database folders:`, folders);

    // Process each database folder
    for (const folderName of folders) {
      await this.processDatabaseFolder(folderName, dbPath);
    }

    this.initialized = true;
    console.log('PrismaManager initialized successfully');
  }  /**
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
      const clientPath = path.join(folderPath, 'client');
      const clientModule = await import(clientPath);
      const DatabasePrismaClient = clientModule.PrismaClient;
      
      // Store the client type constructor for type information
      this.clientTypes.set(folderName, DatabasePrismaClient);
      
      // Create Prisma client instance with database URL
      const prismaClient = new DatabasePrismaClient({
        datasources: {
          db: {
            url: this.getDatabaseUrl(folderName)
          }
        }
      });

      // Test the connection
      await prismaClient.$connect();      // Store the client instance with its original prototype and type information
      this.databases.set(folderName, prismaClient);
      this.configs.set(folderName, {
        name: folderName,
        schemaPath,
        isGenerated: true
      });

      // Dynamically extend the DatabaseClientMap interface with the actual client type
      this.extendDatabaseClientMap(folderName, DatabasePrismaClient);

      // Dynamically create getter methods for this database
      this.createDynamicMethods(folderName);

      console.log(`✅ Connected to database: ${folderName}`);
    } catch (error) {
      console.error(`❌ Failed to connect to database ${folderName}:`, error);
    }
  }

  /**
   * Check if Prisma client is generated for a database
   */
  private async checkIfGenerated(folderName: string): Promise<boolean> {
    try {
      // Check if node_modules/.prisma/client exists
      const nodeModulesPath = path.join(process.cwd(), 'node_modules', '.prisma', 'client');
      if (!fs.existsSync(nodeModulesPath)) {
        return false;
      }

      // Also check if the specific database schema is generated
      // by trying to import the client dynamically
      const schemaPath = path.join(process.cwd(), 'src', 'app', 'db', folderName, 'schema.prisma');
      if (!fs.existsSync(schemaPath)) {
        return false;
      }

      // Read schema file to check if it has valid content
      const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
      return schemaContent.includes('generator client') && schemaContent.includes('datasource db');
    } catch (error) {
      return false;
    }
  }

  /**
   * Get database URL based on folder name
   */
  private getDatabaseUrl(folderName: string): string {
    // Convert folder name to environment variable format
    // testdb1 -> RDS1_DEFAULT_URL, testdb2 -> RDS2_DEFAULT_URL
    const envVarName = folderName.toUpperCase().replace(/testdb(\d+)/, 'RDS$1_DEFAULT_URL');
    let url = process.env[envVarName];
    
    // Fallback: try direct folder name transformation
    if (!url) {
      const fallbackEnvName = `${folderName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_DEFAULT_URL`;
      url = process.env[fallbackEnvName];
    }
    
    if (!url) {
      throw new Error(`Environment variable ${envVarName} not found for database ${folderName}`);
    }
    
    return url;
  }  /**
   * Get a Prisma client instance by database name with proper typing
   * Returns the actual client with full type information preserved from dynamic import
   */
  public getClient<T = any>(databaseName: string): T {
    if (!this.initialized) {
      throw new Error('PrismaManager not initialized. Call initialize() first.');
    }

    const client = this.databases.get(databaseName);
    if (!client) {
      const availableDbs = Array.from(this.databases.keys());
      throw new Error(`Database '${databaseName}' not found. Available databases: ${availableDbs.join(', ')}`);
    }

    // Return the client with its original type preserved from dynamic import
    return client as T;
  }  /**
   * Get a wrapped client with enhanced type information and runtime type checking
   * This method provides the best TypeScript intellisense by preserving the original client type
   */
  public getWrap(databaseName: string): any {
    const client = this.getClient(databaseName);
    const clientType = this.clientTypes.get(databaseName);
    
    if (!clientType) {
      return client;
    }

    // Create a proxy that preserves the original client prototype and type information
    const wrappedClient = new Proxy(client, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        
        // If it's a function, bind it to the original target
        if (typeof value === 'function') {
          return value.bind(target);
        }
        
        return value;
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
  }/**
   * Get a client with runtime type checking and enhanced type information
   */
  public getTypedClient(databaseName: string) {
    const client = this.getClient(databaseName);
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

    // Return a function that provides the typed client
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
      const client = this.getClient(database);
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
    const client = this.getClient(database);
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
        const client = this.getClient(dbName);
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