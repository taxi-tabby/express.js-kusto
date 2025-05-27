import { PrismaClient } from './generated';
import type { 
  PrismaClient as PrismaClientType,
  User,
  Post,
  Prisma
} from './generated';

/**
 * Prisma Client 인스턴스를 관리하는 타입 정의
 */
export interface DatabaseConfig {
  name: string;
  url: string;
  maxConnections?: number;
  timeout?: number;
}

/**
 * 다중 Prisma Client 관리자 클래스
 */
export class PrismaManager {
  private static instance: PrismaManager;
  private clients: Map<string, PrismaClientType> = new Map();
  private configs: Map<string, DatabaseConfig> = new Map();

  private constructor() {}

  /**
   * 싱글톤 인스턴스 반환
   */
  public static getInstance(): PrismaManager {
    if (!PrismaManager.instance) {
      PrismaManager.instance = new PrismaManager();
    }
    return PrismaManager.instance;
  }

  /**
   * 데이터베이스 설정 추가
   */
  public addDatabase(config: DatabaseConfig): void {
    this.configs.set(config.name, config);
  }

  /**
   * 특정 데이터베이스의 Prisma Client 반환
   */
  public getClient(dbName: string): PrismaClientType {
    if (!this.clients.has(dbName)) {
      const config = this.configs.get(dbName);
      if (!config) {
        throw new Error(`Database configuration not found for: ${dbName}`);
      }

      const client = new PrismaClient({
        datasources: {
          db: {
            url: config.url
          }
        }
      });

      this.clients.set(dbName, client);
    }

    return this.clients.get(dbName)!;
  }

  /**
   * 모든 클라이언트 연결 해제
   */
  public async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.clients.values()).map(
      client => client.$disconnect()
    );
    
    await Promise.all(disconnectPromises);
    this.clients.clear();
  }

  /**
   * 특정 클라이언트 연결 해제
   */
  public async disconnect(dbName: string): Promise<void> {
    const client = this.clients.get(dbName);
    if (client) {
      await client.$disconnect();
      this.clients.delete(dbName);
    }
  }

  /**
   * 등록된 모든 데이터베이스 이름 반환
   */
  public getDatabaseNames(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * 데이터베이스 연결 상태 확인
   */
  public async checkConnection(dbName: string): Promise<boolean> {
    try {
      const client = this.getClient(dbName);
      await client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      console.error(`Connection check failed for ${dbName}:`, error);
      return false;
    }
  }
}

/**
 * 기본 데이터베이스 설정
 */
const prismaManager = PrismaManager.getInstance();

// 기본 데이터베이스 설정
prismaManager.addDatabase({
  name: 'default',
  url: process.env.DATABASE_URL || 'file:./src/app/db/dev.db'
});

/**
 * 편의 함수들
 */
export const getDefaultClient = (): PrismaClientType => {
  return prismaManager.getClient('default');
};

export const addDatabase = (config: DatabaseConfig): void => {
  prismaManager.addDatabase(config);
};

export const getClient = (dbName: string): PrismaClientType => {
  return prismaManager.getClient(dbName);
};

export const disconnectAll = (): Promise<void> => {
  return prismaManager.disconnectAll();
};

// 타입 재내보내기
export type { User, Post, Prisma, PrismaClientType };
export { PrismaClient };

// 기본 내보내기
export default prismaManager;
