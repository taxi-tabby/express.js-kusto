// Auto-generated file - Do not edit manually
// Generated from ./src/app/db folder structure

/**
 * Import actual Prisma client types from each database
 */
type TemporaryClient = typeof import('../app/db/temporary/client')['PrismaClient'];

/**
 * Instantiated client types
 */
type TemporaryInstance = InstanceType<TemporaryClient>;

/**
 * Enhanced client type that preserves actual Prisma client type information
 */
export type DatabaseClientType<T extends string> = T extends keyof import('kusto-framework-core').DatabaseClientMap 
  ? import('kusto-framework-core').DatabaseClientMap[T] 
  : any;

/**
 * Type helper for extracting client type from database name
 * Use this when you need to get the client type for a specific database
 */
export type GetDatabaseClient<T extends string> = T extends keyof import('kusto-framework-core').DatabaseClientMap
  ? import('kusto-framework-core').DatabaseClientMap[T]
  : any;

/**
 * Valid database names
 */
export type DatabaseName = keyof import('kusto-framework-core').DatabaseClientMap;

/**
 * Database names as Union type
 */
export type DatabaseNamesUnion = keyof import('kusto-framework-core').DatabaseClientMap | string;


/**
 * Augment kusto-framework-core module with actual database types
 */
declare module 'kusto-framework-core' {
  /**
   * Type mapping for database names to their corresponding Prisma client instances
   */
  interface DatabaseClientMap {
  temporary: TemporaryInstance;
  }

  /**
   * Extend PrismaManager class with proper method overloads
   */
  interface PrismaManager {
  getWrap(databaseName: 'temporary'): TemporaryInstance;
  getClient(databaseName: 'temporary'): Promise<TemporaryInstance>;
  }
}
