/**
 * Prisma Client 추상화 (자동 생성 전 타입 오류 방지)
 */
interface BasePrismaClient {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $queryRaw<T = any>(query: TemplateStringsArray | string, ...values: any[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray | string, ...values: any[]): Promise<any>;
  $transaction<P extends Promise<any>[]>(arg: [...P]): Promise<any>;
  $transaction<T>(fn: (client: any) => Promise<T>): Promise<T>;
}

// 클라이언트 매니저 import
import { PrismaClientManager, clientManager } from './clientManager';

// 생성된 Prisma Client가 있으면 사용하고, 없으면 동적으로 로딩 시도
let PrismaClient: any;
let generatedTypes: any = {};

try {
  const generated = require('./generated');
  PrismaClient = generated.PrismaClient;
  generatedTypes = generated;
} catch (error) {
  console.warn('Prisma Client not generated yet. Run `npx prisma generate` first.');
  // 임시 클래스로 대체
  PrismaClient = class DummyPrismaClient implements BasePrismaClient {
    constructor(options?: any) {
      console.warn('Using dummy Prisma Client. Database operations will fail.');
    }
    async $connect() { return Promise.resolve(); }
    async $disconnect() { return Promise.resolve(); }
    async $queryRaw<T = any>(query: TemplateStringsArray | string, ...values: any[]): Promise<T> { 
      throw new Error('Prisma Client not initialized. Run `npx prisma generate` first.');
    }
    async $executeRaw(query: TemplateStringsArray | string, ...values: any[]): Promise<any> { 
      throw new Error('Prisma Client not initialized. Run `npx prisma generate` first.');
    }    
    async $transaction<P extends Promise<any>[]>(arg: [...P]): Promise<any>;
    async $transaction<T>(fn: (client: any) => Promise<T>): Promise<T>;
    async $transaction(arg: any): Promise<any> {
      throw new Error('Prisma Client not initialized. Run `npx prisma generate` first.');
    }
  };
}

// 타입 정의
type PrismaClientType = BasePrismaClient;

/**
 * 지원되는 데이터베이스 타입
 */
export type DatabaseProvider = 'sqlite' | 'postgresql' | 'mysql' | 'sqlserver' | 'mongodb' | 'cockroachdb';

/**
 * 데이터베이스별 연결 설정
 */
export interface DatabaseConnectionConfig {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  schema?: string;
  ssl?: boolean | {
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
  connectionLimit?: number;
  connectTimeout?: number;
  poolTimeout?: number;
  socketPath?: string; // MySQL용
  timezone?: string;
}

/**
 * Prisma Client 인스턴스를 관리하는 타입 정의
 */
export interface DatabaseConfig {
  name: string;
  provider: DatabaseProvider;
  url?: string; // 직접 URL을 제공하는 경우
  connection?: DatabaseConnectionConfig; // 개별 설정으로 URL을 생성하는 경우
  maxConnections?: number;
  timeout?: number;
  logging?: boolean | ('query' | 'info' | 'warn' | 'error')[];
}

/**
 * 다중 Prisma Client 관리자 클래스
 */
export class PrismaManager {
  private static instance: PrismaManager;
  private clients: Map<string, PrismaClientType> = new Map();
  private configs: Map<string, DatabaseConfig> = new Map();
  private migrationManager: any; // MigrationManager는 순환참조 방지를 위해 동적 import

  private constructor() {
    // MigrationManager를 동적으로 가져오기
    this.initMigrationManager();
  }

  private async initMigrationManager() {
    try {
      const { MigrationManager } = await import('./migration');
      this.migrationManager = new MigrationManager();
    } catch (error) {
      console.warn('Failed to initialize MigrationManager:', error);
    }
  }

  /**
   * 데이터베이스 연결 URL 생성
   */
  private generateDatabaseUrl(config: DatabaseConfig): string {
    if (config.url) {
      return config.url;
    }

    if (!config.connection) {
      throw new Error(`No URL or connection config provided for database: ${config.name}`);
    }

    const conn = config.connection;
    
    switch (config.provider) {
      case 'postgresql':
        return this.buildPostgreSQLUrl(conn);
      case 'mysql':
        return this.buildMySQLUrl(conn);
      case 'sqlserver':
        return this.buildSQLServerUrl(conn);
      case 'sqlite':
        return this.buildSQLiteUrl(conn);
      case 'mongodb':
        return this.buildMongoDBUrl(conn);
      case 'cockroachdb':
        return this.buildCockroachDBUrl(conn);
      default:
        throw new Error(`Unsupported database provider: ${config.provider}`);
    }
  }

  private buildPostgreSQLUrl(conn: DatabaseConnectionConfig): string {
    const { host = 'localhost', port = 5432, username, password, database, schema, ssl } = conn;
    
    if (!username || !database) {
      throw new Error('PostgreSQL requires username and database name');
    }

    let url = `postgresql://${username}`;
    if (password) url += `:${password}`;
    url += `@${host}:${port}/${database}`;
    
    const params: string[] = [];
    if (schema) params.push(`schema=${schema}`);
    if (ssl === true) params.push('sslmode=require');
    else if (ssl === false) params.push('sslmode=disable');
    else if (typeof ssl === 'object') {
      params.push('sslmode=require');
      if (ssl.rejectUnauthorized === false) params.push('sslaccept=strict');
    }
    if (conn.connectionLimit) params.push(`connection_limit=${conn.connectionLimit}`);
    if (conn.poolTimeout) params.push(`pool_timeout=${conn.poolTimeout}`);
    
    if (params.length > 0) url += `?${params.join('&')}`;
    return url;
  }

  private buildMySQLUrl(conn: DatabaseConnectionConfig): string {
    const { host = 'localhost', port = 3306, username, password, database, ssl } = conn;
    
    if (!username || !database) {
      throw new Error('MySQL requires username and database name');
    }

    let url = `mysql://${username}`;
    if (password) url += `:${password}`;
    url += `@${host}:${port}/${database}`;
    
    const params: string[] = [];
    if (ssl === true) params.push('sslaccept=strict');
    else if (ssl === false) params.push('sslaccept=accept_invalid_certs');
    if (conn.socketPath) params.push(`socket=${conn.socketPath}`);
    if (conn.timezone) params.push(`timezone=${conn.timezone}`);
    if (conn.connectionLimit) params.push(`connection_limit=${conn.connectionLimit}`);
    
    if (params.length > 0) url += `?${params.join('&')}`;
    return url;
  }

  private buildSQLServerUrl(conn: DatabaseConnectionConfig): string {
    const { host = 'localhost', port = 1433, username, password, database, schema } = conn;
    
    if (!username || !database) {
      throw new Error('SQL Server requires username and database name');
    }

    let url = `sqlserver://${host}:${port};database=${database};user=${username}`;
    if (password) url += `;password=${password}`;
    if (schema) url += `;schema=${schema}`;
    if (conn.ssl) url += ';encrypt=true';
    if (conn.connectTimeout) url += `;connectTimeout=${conn.connectTimeout}`;
    
    return url;
  }

  private buildSQLiteUrl(conn: DatabaseConnectionConfig): string {
    if (!conn.database) {
      throw new Error('SQLite requires database file path');
    }
    return `file:${conn.database}`;
  }

  private buildMongoDBUrl(conn: DatabaseConnectionConfig): string {
    const { host = 'localhost', port = 27017, username, password, database } = conn;
    
    let url = 'mongodb://';
    if (username && password) {
      url += `${username}:${password}@`;
    }
    url += `${host}:${port}`;
    if (database) url += `/${database}`;
    
    const params: string[] = [];
    if (conn.ssl) params.push('ssl=true');
    if (conn.connectionLimit) params.push(`maxPoolSize=${conn.connectionLimit}`);
    
    if (params.length > 0) url += `?${params.join('&')}`;
    return url;
  }

  private buildCockroachDBUrl(conn: DatabaseConnectionConfig): string {
    // CockroachDB는 PostgreSQL 호환이므로 PostgreSQL URL 형식 사용
    return this.buildPostgreSQLUrl(conn);
  }

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
    
    // 마이그레이션 매니저가 초기화되었으면 데이터베이스 설정 추가
    if (this.migrationManager) {
      this.migrationManager.addDatabaseFromConfig(config);
    } else {
      // 아직 초기화되지 않았으면 초기화 후 추가
      this.initMigrationManager().then(() => {
        if (this.migrationManager) {
          this.migrationManager.addDatabaseFromConfig(config);
        }
      });
    }
  }

  /**
   * 마이그레이션 매니저 반환
   */
  public getMigrationManager(): any {
    return this.migrationManager;
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

      const databaseUrl = this.generateDatabaseUrl(config);
      
      const clientOptions: any = {
        datasources: {
          db: {
            url: databaseUrl
          }
        }
      };

      // 로깅 설정
      if (config.logging !== undefined) {
        clientOptions.log = config.logging;
      }

      const client = new PrismaClient(clientOptions);

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

// 자동 클라이언트 관리 함수들 내보내기
export { 
  PrismaClientManager, 
  clientManager, 
  scanAndRegisterClients, 
  getAutoDetectedClient, 
  printClientReport 
} from './clientManager';
export type { AutoDetectedClient } from './clientManager';

/**
 * 모든 클라이언트 (기존 + 자동 탐지) 연결 해제
 */
export const disconnectAllClients = async (): Promise<void> => {
  await Promise.all([
    prismaManager.disconnectAll(),
    clientManager.disconnectAll()
  ]);
};

/**
 * 통합 클라이언트 초기화 함수
 * 기존 등록된 클라이언트 + 자동 탐지된 클라이언트 모두 초기화
 */
export const initializeAllClients = async (): Promise<void> => {
  console.log('🚀 Initializing all Prisma clients...');
  
  // 1. 자동 탐지 및 등록
  await clientManager.autoRegisterClients();
  
  // 2. 클라이언트 상태 리포트 출력
  clientManager.printClientReport();
  
  console.log('✅ All clients initialized successfully!');
};

/**
 * 통합 클라이언트 가져오기 함수
 * 먼저 PrismaManager에서 찾고, 없으면 자동 탐지된 클라이언트에서 찾기
 */
export const getAnyClient = async (clientName: string): Promise<PrismaClientType> => {
  try {
    // 먼저 기존 PrismaManager에서 시도
    return prismaManager.getClient(clientName);
  } catch (error) {
    // 없으면 자동 탐지된 클라이언트에서 시도
    console.log(`🔄 Fallback to auto-detected client: ${clientName}`);
    return await clientManager.getClientInstance(clientName);
  }
};

/**
 * 사용 가능한 모든 클라이언트 이름 반환
 */
export const getAllClientNames = (): string[] => {
  const registeredClients = prismaManager.getDatabaseNames();
  const autoDetectedClients = clientManager.getValidClients().map(c => c.name);
  
  // 중복 제거하여 반환
  return [...new Set([...registeredClients, ...autoDetectedClients])];
};

// 타입 재내보내기
export { PrismaClient };
export type { PrismaClientType };

// 생성된 타입이 있으면 재내보내기
if (generatedTypes.Prisma) {
  Object.defineProperty(exports, 'Prisma', {
    get: () => generatedTypes.Prisma
  });
}
if (generatedTypes.User) {
  Object.defineProperty(exports, 'User', {
    get: () => generatedTypes.User
  });
}
if (generatedTypes.Post) {
  Object.defineProperty(exports, 'Post', {
    get: () => generatedTypes.Post
  });
}

// 기본 내보내기
export default prismaManager;
