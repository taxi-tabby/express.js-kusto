// Auto-generated file - Do not edit manually
// Generated from src/app/db folder structure

/**
 * Import actual Prisma client types from each database
 */
type MigrationsClient = typeof import('@app/db/migrations/client')['PrismaClient'];
type Testdb1Client = typeof import('@app/db/testdb1/client')['PrismaClient'];
type Testdb2Client = typeof import('@app/db/testdb2/client')['PrismaClient'];

/**
 * Instantiated client types
 */
type MigrationsInstance = InstanceType<MigrationsClient>;
type Testdb1Instance = InstanceType<Testdb1Client>;
type Testdb2Instance = InstanceType<Testdb2Client>;

/**
 * Type mapping for database names to their corresponding Prisma client instances
 */
export interface DatabaseClientMap {
  migrations: MigrationsInstance;
  testdb1: Testdb1Instance;
  testdb2: Testdb2Instance;
  [key: string]: any; // Allow for additional databases
}

/**
 * Enhanced client type that preserves actual Prisma client type information
 */
export type DatabaseClientType<T extends string> = T extends keyof DatabaseClientMap 
  ? DatabaseClientMap[T] 
  : any;

/**
 * Valid database names
 */
export type DatabaseName = keyof DatabaseClientMap;

/**
 * Method overloads for getWrap
 */
export interface PrismaManagerWrapOverloads {
  getWrap(databaseName: 'migrations'): MigrationsInstance;
  getWrap(databaseName: 'testdb1'): Testdb1Instance;
  getWrap(databaseName: 'testdb2'): Testdb2Instance;
  getWrap<T extends string>(databaseName: T): DatabaseClientType<T>;
}

/**
 * Method overloads for getClient
 */
export interface PrismaManagerClientOverloads {
  getClient(databaseName: 'migrations'): MigrationsInstance;
  getClient(databaseName: 'testdb1'): Testdb1Instance;
  getClient(databaseName: 'testdb2'): Testdb2Instance;
  getClient<T = any>(databaseName: string): T;
}


/**
 * Extend PrismaManager class with proper method overloads
 */
declare module '../prismaManager' {
  interface PrismaManager {
  getWrap(databaseName: 'migrations'): MigrationsInstance;
  getWrap(databaseName: 'testdb1'): Testdb1Instance;
  getWrap(databaseName: 'testdb2'): Testdb2Instance;
  getClient(databaseName: 'migrations'): MigrationsInstance;
  getClient(databaseName: 'testdb1'): Testdb1Instance;
  getClient(databaseName: 'testdb2'): Testdb2Instance;
  }
}
