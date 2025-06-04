// Auto-generated file - Do not edit manually
// Generated from src/app/db folder structure

/**
 * Import actual Prisma client types from each database
 */
type AdminClient = typeof import('@app/db/admin/client')['PrismaClient'];
type DefaultClient = typeof import('@app/db/default/client')['PrismaClient'];
type UserClient = typeof import('@app/db/user/client')['PrismaClient'];

/**
 * Instantiated client types
 */
type AdminInstance = InstanceType<AdminClient>;
type DefaultInstance = InstanceType<DefaultClient>;
type UserInstance = InstanceType<UserClient>;

/**
 * Type mapping for database names to their corresponding Prisma client instances
 */
export interface DatabaseClientMap {
  admin: AdminInstance;
  default: DefaultInstance;
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
 * Method overloads for getWrap
 */
export interface PrismaManagerWrapOverloads {
  getWrap(databaseName: 'admin'): AdminInstance;
  getWrap(databaseName: 'default'): DefaultInstance;
  getWrap(databaseName: 'user'): UserInstance;
  getWrap<T extends string>(databaseName: T): DatabaseClientType<T>;
}

/**
 * Method overloads for getClient
 */
export interface PrismaManagerClientOverloads {
  getClient(databaseName: 'admin'): AdminInstance;
  getClient(databaseName: 'default'): DefaultInstance;
  getClient(databaseName: 'user'): UserInstance;
  getClient<T = any>(databaseName: string): T;
}


/**
 * Extend PrismaManager class with proper method overloads
 */
declare module '../prismaManager' {
  interface PrismaManager {
  getWrap(databaseName: 'admin'): AdminInstance;
  getWrap(databaseName: 'default'): DefaultInstance;
  getWrap(databaseName: 'user'): UserInstance;
  getClient(databaseName: 'admin'): AdminInstance;
  getClient(databaseName: 'default'): DefaultInstance;
  getClient(databaseName: 'user'): UserInstance;
  }
}
