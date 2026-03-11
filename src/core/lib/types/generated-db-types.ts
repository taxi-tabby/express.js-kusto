// Auto-generated file - Do not edit manually
// Generated from src/app/db folder structure
// Prisma 7+ compatible

/**
 * Import PrismaClient from each database
 */
import { PrismaClient as DefaultPrismaClient } from '@app/db/default/client';

/**
 * Instance types for each database client
 */
type DefaultInstance = DefaultPrismaClient;

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
 * Database names as Union type
 */
export type DatabaseNamesUnion = 'default';

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
  getClient(databaseName: 'default'): Promise<DefaultInstance>;
  getClient<T = any>(databaseName: string): Promise<T>;
}


/**
 * Extend PrismaManager class with proper method overloads
 */
declare module '../prismaManager' {
  interface PrismaManager {
  getWrap(databaseName: 'default'): DefaultInstance;
  getClient(databaseName: 'default'): Promise<DefaultInstance>;
  }
}
