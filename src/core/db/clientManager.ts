/**
 * 자동 Prisma Client 탐지 및 관리 시스템
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaManager, DatabaseConfig, DatabaseProvider } from './index';

export interface AutoDetectedClient {
  name: string;
  path: string;
  schemaPath?: string;
  provider?: DatabaseProvider;
  isValid: boolean;
  clientModule?: any;
  error?: string;
}

export class PrismaClientManager {
  private static instance: PrismaClientManager;
  private clientsPath: string;
  private schemasPath: string;
  private detectedClients: Map<string, AutoDetectedClient> = new Map();
  private loadedClients: Map<string, any> = new Map();

  private constructor() {
    this.clientsPath = path.resolve(process.cwd(), 'src/app/db/schemas/clients');
    this.schemasPath = path.resolve(process.cwd(), 'src/app/db/schemas');
  }

  public static getInstance(): PrismaClientManager {
    if (!PrismaClientManager.instance) {
      PrismaClientManager.instance = new PrismaClientManager();
    }
    return PrismaClientManager.instance;
  }

  /**
   * clients 폴더를 스캔하여 모든 Prisma 클라이언트를 자동 탐지
   */
  public async scanClients(): Promise<AutoDetectedClient[]> {
    console.log('🔍 Scanning Prisma clients...');
    this.detectedClients.clear();

    if (!fs.existsSync(this.clientsPath)) {
      console.warn(`⚠️ Clients directory not found: ${this.clientsPath}`);
      return [];
    }

    const clientFolders = fs.readdirSync(this.clientsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    console.log(`📁 Found ${clientFolders.length} client folders:`, clientFolders);

    for (const folderName of clientFolders) {
      const clientInfo = await this.analyzeClient(folderName);
      this.detectedClients.set(folderName, clientInfo);
    }

    const results = Array.from(this.detectedClients.values());
    console.log(`✅ Detected ${results.filter(c => c.isValid).length}/${results.length} valid clients`);
    
    return results;
  }

  /**
   * 개별 클라이언트 폴더 분석
   */
  private async analyzeClient(clientName: string): Promise<AutoDetectedClient> {
    const clientPath = path.join(this.clientsPath, clientName);
    const clientInfo: AutoDetectedClient = {
      name: clientName,
      path: clientPath,
      isValid: false
    };

    try {
      // 1. 필수 파일 존재 확인
      const indexPath = path.join(clientPath, 'index.js');
      const packagePath = path.join(clientPath, 'package.json');
      
      if (!fs.existsSync(indexPath)) {
        clientInfo.error = 'index.js not found';
        return clientInfo;
      }

      // 2. 스키마 파일 찾기
      const schemaPath = path.join(clientPath, 'schema.prisma');
      if (fs.existsSync(schemaPath)) {
        clientInfo.schemaPath = schemaPath;
        clientInfo.provider = await this.extractProviderFromSchema(schemaPath);
      } else {
        // schemas 폴더에서 해당하는 스키마 파일 찾기
        const possibleSchemas = this.findMatchingSchema(clientName);
        if (possibleSchemas.length > 0) {
          clientInfo.schemaPath = possibleSchemas[0];
          clientInfo.provider = await this.extractProviderFromSchema(possibleSchemas[0]);
        }
      }

      // 3. 클라이언트 모듈 로드 시도
      try {
        const clientModule = require(indexPath);
        if (clientModule.PrismaClient) {
          clientInfo.clientModule = clientModule;
          clientInfo.isValid = true;
        } else {
          clientInfo.error = 'PrismaClient not exported';
        }
      } catch (loadError: any) {
        clientInfo.error = `Failed to load module: ${loadError.message}`;
      }

    } catch (error: any) {
      clientInfo.error = `Analysis failed: ${error.message}`;
    }

    return clientInfo;
  }
  /**
   * 스키마 파일에서 datasource provider 추출
   */
  private async extractProviderFromSchema(schemaPath: string): Promise<DatabaseProvider | undefined> {
    try {
      const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
      
      // datasource 블록을 찾고 그 안의 provider 추출
      const datasourceBlockMatch = schemaContent.match(/datasource\s+\w+\s*{([^}]*)}/s);
      if (datasourceBlockMatch) {
        const datasourceContent = datasourceBlockMatch[1];
        const providerMatch = datasourceContent.match(/provider\s*=\s*"([^"]+)"/);
        if (providerMatch && providerMatch[1]) {
          return providerMatch[1] as DatabaseProvider;
        }
      }
      
      console.warn(`No datasource provider found in schema: ${schemaPath}`);
    } catch (error) {
      console.warn(`Failed to read schema: ${schemaPath}`);
    }
    return undefined;
  }

  /**
   * 클라이언트 이름에 매칭되는 스키마 파일 찾기
   */
  private findMatchingSchema(clientName: string): string[] {
    if (!fs.existsSync(this.schemasPath)) return [];

    const schemaFiles = fs.readdirSync(this.schemasPath)
      .filter(file => file.endsWith('.prisma'))
      .map(file => path.join(this.schemasPath, file));

    // 이름 매칭 로직
    const matchingSchemas: string[] = [];
    
    for (const schemaFile of schemaFiles) {
      const fileName = path.basename(schemaFile, '.prisma');
      if (fileName === clientName || 
          fileName.includes(clientName) || 
          clientName.includes(fileName)) {
        matchingSchemas.push(schemaFile);
      }
    }

    return matchingSchemas;
  }

  /**
   * 탐지된 클라이언트를 PrismaManager에 자동 등록
   */
  public async autoRegisterClients(): Promise<void> {
    const clients = await this.scanClients();
    const prismaManager = PrismaManager.getInstance();

    for (const client of clients) {
      if (!client.isValid) {
        console.warn(`⚠️ Skipping invalid client: ${client.name} - ${client.error}`);
        continue;
      }

      try {
        // 환경 변수에서 URL 가져오기 또는 기본값 사용
        const databaseUrl = this.getDatabaseUrlForClient(client.name, client.provider);
        
        const config: DatabaseConfig = {
          name: client.name,
          provider: client.provider || 'postgresql',
          url: databaseUrl,
        };

        prismaManager.addDatabase(config);
        console.log(`✅ Auto-registered client: ${client.name} (${client.provider})`);
      } catch (error: any) {
        console.error(`❌ Failed to register client ${client.name}:`, error.message);
      }
    }
  }

  /**
   * 클라이언트별 데이터베이스 URL 결정
   */
  private getDatabaseUrlForClient(clientName: string, provider?: DatabaseProvider): string {
    // 환경 변수 이름 패턴들
    const envPatterns = [
      `${clientName.toUpperCase()}_DATABASE_URL`,
      `${clientName.toUpperCase()}_URL`,
      `DATABASE_URL_${clientName.toUpperCase()}`,
      'DATABASE_URL'  // 기본값
    ];

    for (const pattern of envPatterns) {
      const url = process.env[pattern];
      if (url) {
        console.log(`🔗 Using ${pattern} for ${clientName}`);
        return url;
      }
    }

    // 환경 변수가 없으면 provider별 기본 URL 반환
    return this.getDefaultUrlForProvider(provider || 'postgresql', clientName);
  }

  /**
   * Provider별 기본 URL 생성
   */
  private getDefaultUrlForProvider(provider: DatabaseProvider, dbName: string): string {
    switch (provider) {
      case 'postgresql':
        return `postgresql://postgres:postgres@localhost:5432/${dbName}`;
      case 'mysql':
        return `mysql://root:password@localhost:3306/${dbName}`;
      case 'sqlite':
        return `file:./${dbName}.db`;
      case 'sqlserver':
        return `sqlserver://localhost:1433;database=${dbName};user=sa;password=password`;
      case 'mongodb':
        return `mongodb://localhost:27017/${dbName}`;
      case 'cockroachdb':
        return `postgresql://root@localhost:26257/${dbName}?sslmode=disable`;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * 특정 클라이언트의 PrismaClient 인스턴스 직접 가져오기
   */
  public async getClientInstance(clientName: string): Promise<any> {
    if (this.loadedClients.has(clientName)) {
      return this.loadedClients.get(clientName);
    }

    const clientInfo = this.detectedClients.get(clientName);
    if (!clientInfo || !clientInfo.isValid || !clientInfo.clientModule) {
      throw new Error(`Client ${clientName} not found or invalid`);
    }

    const { PrismaClient } = clientInfo.clientModule;
    const databaseUrl = this.getDatabaseUrlForClient(clientName, clientInfo.provider);
    
    const client = new PrismaClient({
      datasources: {
        db: { url: databaseUrl }
      }
    });

    this.loadedClients.set(clientName, client);
    return client;
  }

  /**
   * 모든 탐지된 클라이언트 정보 반환
   */
  public getDetectedClients(): AutoDetectedClient[] {
    return Array.from(this.detectedClients.values());
  }

  /**
   * 유효한 클라이언트 목록만 반환
   */
  public getValidClients(): AutoDetectedClient[] {
    return this.getDetectedClients().filter(client => client.isValid);
  }

  /**
   * 클라이언트 상태 리포트 출력
   */
  public printClientReport(): void {
    const clients = this.getDetectedClients();
    
    console.log('\n📊 Prisma Client Manager Report');
    console.log('=' .repeat(50));
    
    if (clients.length === 0) {
      console.log('No clients detected.');
      return;
    }

    clients.forEach(client => {
      const status = client.isValid ? '✅ Valid' : '❌ Invalid';
      const provider = client.provider ? `[${client.provider}]` : '[Unknown]';
      const error = client.error ? ` - ${client.error}` : '';
      
      console.log(`${status} ${client.name} ${provider}${error}`);
      if (client.schemaPath) {
        console.log(`    Schema: ${client.schemaPath}`);
      }
      console.log(`    Path: ${client.path}`);
      console.log('');
    });
  }

  /**
   * 모든 로드된 클라이언트 연결 해제
   */
  public async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.loadedClients.values()).map(
      client => client.$disconnect ? client.$disconnect() : Promise.resolve()
    );
    
    await Promise.all(disconnectPromises);
    this.loadedClients.clear();
  }
}

// 편의 함수들
export const clientManager = PrismaClientManager.getInstance();

export const scanAndRegisterClients = async (): Promise<void> => {
  await clientManager.autoRegisterClients();
};

export const getAutoDetectedClient = async (clientName: string): Promise<any> => {
  return await clientManager.getClientInstance(clientName);
};

export const printClientReport = (): void => {
  clientManager.printClientReport();
};
