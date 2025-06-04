// Auto-generated file - Do not edit manually
// Generated from src/app/db folder structure

/**
 * Import actual Prisma client types from each database
 */
type DefaultClient = typeof import('@app/db/default/client')['PrismaClient'];

/**
 * Instantiated client types
 */
type DefaultInstance = InstanceType<DefaultClient>;

/**
 * Type mapping for database names to their corresponding Prisma client instances
 */
export interface DatabaseClientMap {
  default: DefaultInstance;
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
  getWrap(databaseName: 'default'): DefaultInstance;
  getWrap<T extends string>(databaseName: T): DatabaseClientType<T>;
}

/**
 * Method overloads for getClient
 */
export interface PrismaManagerClientOverloads {
  getClient(databaseName: 'default'): DefaultInstance;
  getClient<T = any>(databaseName: string): T;
}


/**
 * Extend PrismaManager class with proper method overloads
 */
declare module '../prismaManager' {
  interface PrismaManager {
  getWrap(databaseName: 'default'): DefaultInstance;
  getClient(databaseName: 'default'): DefaultInstance;
  }
}
