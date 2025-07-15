// Auto-generated file - Do not edit manually
// Generated from src/app/db folder structure

/**
 * Import actual Prisma client types from each database
 */
type TemporaryClient = typeof import('@app/db/temporary/client')['PrismaClient'];
type UserClient = typeof import('@app/db/user/client')['PrismaClient'];

/**
 * Instantiated client types
 */
type TemporaryInstance = InstanceType<TemporaryClient>;
type UserInstance = InstanceType<UserClient>;

/**
 * Type mapping for database names to their corresponding Prisma client instances
 */
export interface DatabaseClientMap {
  temporary: TemporaryInstance;
  user: UserInstance;
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
 * Database names as Union type
 */
export type DatabaseNamesUnion = 'temporary' | 'user';

/**
 * Method overloads for getWrap
 */
export interface PrismaManagerWrapOverloads {
  getWrap(databaseName: 'temporary'): TemporaryInstance;
  getWrap(databaseName: 'user'): UserInstance;
  getWrap<T extends string>(databaseName: T): DatabaseClientType<T>;
}

/**
 * Method overloads for getClient
 */
export interface PrismaManagerClientOverloads {
  getClient(databaseName: 'temporary'): TemporaryInstance;
  getClient(databaseName: 'user'): UserInstance;
  getClient<T = any>(databaseName: string): T;
}


/**
 * Extend PrismaManager class with proper method overloads
 */
declare module '../prismaManager' {
  interface PrismaManager {
  getWrap(databaseName: 'temporary'): TemporaryInstance;
  getWrap(databaseName: 'user'): UserInstance;
  getClient(databaseName: 'temporary'): TemporaryInstance;
  getClient(databaseName: 'user'): UserInstance;
  }
}
