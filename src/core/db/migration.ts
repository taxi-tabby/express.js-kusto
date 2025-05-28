import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';
import { DatabaseConfig } from './index';

/**
 * 데이터베이스별 마이그레이션 설정
 */
export interface DatabaseMigrationConfig {
  name: string;
  schemaPath: string;
  migrationsDir?: string;
}

/**
 * 마이그레이션 관리 클래스
 */
export class MigrationManager {
  private databases: Map<string, DatabaseMigrationConfig> = new Map();

  constructor() {
    // 기본 설정은 제거하고 동적으로 데이터베이스별 설정을 관리
  }

  /**
   * 데이터베이스별 마이그레이션 설정 추가
   */
  public addDatabaseMigration(config: DatabaseMigrationConfig): void {
    // 마이그레이션 디렉토리가 지정되지 않았으면 기본값 설정
    if (!config.migrationsDir) {
      config.migrationsDir = join(process.cwd(), 'src', 'app', 'db', 'migrations', config.name);
    }

    // 마이그레이션 디렉토리 생성
    if (!existsSync(config.migrationsDir)) {
      mkdirSync(config.migrationsDir, { recursive: true });
    }

    this.databases.set(config.name, config);
  }

  /**
   * 데이터베이스 설정에서 스키마 경로 추론
   */
  public addDatabaseFromConfig(dbConfig: DatabaseConfig): void {
    const schemaPath = this.getSchemaPathFromProvider(dbConfig.provider);
    
    this.addDatabaseMigration({
      name: dbConfig.name,
      schemaPath: schemaPath,
      migrationsDir: join(process.cwd(), 'src', 'app', 'db', 'migrations', dbConfig.name)
    });
  }

  /**
   * Provider에 따른 스키마 경로 반환
   */
  private getSchemaPathFromProvider(provider: string): string {
    const schemasDir = join(process.cwd(), 'src', 'app', 'db', 'schemas');
    
    switch (provider) {
      case 'postgresql':
        return join(schemasDir, 'postgresql.prisma');
      case 'mysql':
        return join(schemasDir, 'mysql.prisma');
      case 'sqlite':
        return join(schemasDir, 'sqlite.prisma');
      case 'sqlserver':
        return join(schemasDir, 'sqlserver.prisma');
      case 'mongodb':
        return join(schemasDir, 'mongodb.prisma');
      case 'cockroachdb':
        return join(schemasDir, 'cockroachdb.prisma');
      default:
        // 기본값으로 provider 이름을 사용
        return join(schemasDir, `${provider}.prisma`);
    }
  }

  /**
   * 데이터베이스 설정 가져오기
   */
  private getDatabaseConfig(dbName: string): DatabaseMigrationConfig {
    const config = this.databases.get(dbName);
    if (!config) {
      throw new Error(`Database migration configuration not found for: ${dbName}`);
    }
    return config;
  }
  /**
   * 새 마이그레이션 생성
   */
  public async createMigration(dbName: string, name: string): Promise<string> {
    const config = this.getDatabaseConfig(dbName);
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '').substring(0, 15);
    const migrationName = `${timestamp}_${name}`;
    const migrationPath = join(config.migrationsDir!, `${migrationName}.sql`);

    // 마이그레이션 파일 템플릿
    const template = `-- Migration: ${migrationName}
-- Database: ${dbName}
-- Created: ${new Date().toISOString()}

-- Add your SQL migration here
-- Example:
-- ALTER TABLE "User" ADD COLUMN "role" TEXT DEFAULT 'user';
`;

    writeFileSync(migrationPath, template);
    console.log(`✅ Created migration for ${dbName}: ${migrationName}.sql`);
    
    return migrationPath;
  }

  /**
   * Prisma 마이그레이션 실행
   */
  public async runMigrations(dbName: string, migrationName?: string): Promise<void> {
    const config = this.getDatabaseConfig(dbName);
    
    try {
      console.log(`🚀 Running Prisma migrations for ${dbName}...`);
      
      if (migrationName) {
        execSync(`npx prisma migrate dev --name ${migrationName} --schema=${config.schemaPath}`, { 
          stdio: 'inherit',
          cwd: process.cwd()
        });
      } else {
        execSync(`npx prisma migrate dev --schema=${config.schemaPath}`, { 
          stdio: 'inherit',
          cwd: process.cwd()
        });
      }
      
      console.log(`✅ Migrations completed successfully for ${dbName}`);
    } catch (error) {
      console.error(`❌ Migration failed for ${dbName}:`, error);
      throw error;
    }
  }

  /**
   * 마이그레이션 상태 확인
   */
  public async getStatus(dbName: string): Promise<void> {
    const config = this.getDatabaseConfig(dbName);
    
    try {
      console.log(`📊 Checking migration status for ${dbName}...`);
      execSync(`npx prisma migrate status --schema=${config.schemaPath}`, { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
    } catch (error) {
      console.error(`❌ Failed to get migration status for ${dbName}:`, error);
      throw error;
    }
  }

  /**
   * Prisma Client 생성
   */
  public async generateClient(dbName: string): Promise<void> {
    const config = this.getDatabaseConfig(dbName);
    
    try {
      console.log(`🔄 Generating Prisma Client for ${dbName}...`);
      execSync(`npx prisma generate --schema=${config.schemaPath}`, { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
      console.log(`✅ Prisma Client generated successfully for ${dbName}`);
    } catch (error) {
      console.error(`❌ Failed to generate Prisma Client for ${dbName}:`, error);
      throw error;
    }
  }
  /**
   * 데이터베이스 리셋
   */
  public async resetDatabase(dbName: string): Promise<void> {
    const config = this.getDatabaseConfig(dbName);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve, reject) => {
      rl.question(`⚠️  This will reset database '${dbName}'. Are you sure? (y/N): `, (answer) => {
        rl.close();
        
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          try {
            console.log(`🗑️  Resetting database ${dbName}...`);
            execSync(`npx prisma migrate reset --force --schema=${config.schemaPath}`, { 
              stdio: 'inherit',
              cwd: process.cwd()
            });
            console.log(`✅ Database ${dbName} reset completed`);
            resolve();
          } catch (error) {
            console.error(`❌ Database ${dbName} reset failed:`, error);
            reject(error);
          }
        } else {
          console.log(`❌ Database ${dbName} reset cancelled`);
          resolve();
        }
      });
    });
  }

  /**
   * 스키마 푸시 (프로덕션용)
   */
  public async pushSchema(dbName: string): Promise<void> {
    const config = this.getDatabaseConfig(dbName);
    
    try {
      console.log(`📤 Pushing schema to database ${dbName}...`);
      execSync(`npx prisma db push --schema=${config.schemaPath}`, { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
      console.log(`✅ Schema pushed successfully to ${dbName}`);
    } catch (error) {
      console.error(`❌ Schema push failed for ${dbName}:`, error);
      throw error;
    }
  }

  /**
   * 시드 실행
   */
  public async runSeed(dbName: string): Promise<void> {
    const config = this.getDatabaseConfig(dbName);
    
    try {
      console.log(`🌱 Running database seed for ${dbName}...`);
      execSync(`npx prisma db seed --schema=${config.schemaPath}`, { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
      console.log(`✅ Seed completed successfully for ${dbName}`);
    } catch (error) {
      console.error(`❌ Seed failed for ${dbName}:`, error);
      throw error;
    }
  }

  /**
   * Prisma Studio 실행
   */
  public async openStudio(dbName: string): Promise<void> {
    const config = this.getDatabaseConfig(dbName);
    
    try {
      console.log(`🎨 Opening Prisma Studio for ${dbName}...`);
      execSync(`npx prisma studio --schema=${config.schemaPath}`, { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
    } catch (error) {
      console.error(`❌ Failed to open Prisma Studio for ${dbName}:`, error);
      throw error;
    }
  }

  /**
   * 모든 등록된 데이터베이스 목록 반환
   */
  public getDatabaseNames(): string[] {
    return Array.from(this.databases.keys());
  }

  /**
   * 모든 데이터베이스에 대해 마이그레이션 실행
   */
  public async runAllMigrations(migrationName?: string): Promise<void> {
    const dbNames = this.getDatabaseNames();
    
    if (dbNames.length === 0) {
      console.log('⚠️  No databases configured for migration');
      return;
    }

    for (const dbName of dbNames) {
      try {
        console.log(`\n🔄 Processing migrations for ${dbName}...`);
        await this.runMigrations(dbName, migrationName);
      } catch (error) {
        console.error(`❌ Failed to migrate ${dbName}:`, error);
        // 계속해서 다른 데이터베이스 처리
      }
    }
  }

  /**
   * 모든 데이터베이스에 대해 클라이언트 생성
   */
  public async generateAllClients(): Promise<void> {
    const dbNames = this.getDatabaseNames();
    
    if (dbNames.length === 0) {
      console.log('⚠️  No databases configured for client generation');
      return;
    }

    for (const dbName of dbNames) {
      try {
        console.log(`\n🔄 Generating client for ${dbName}...`);
        await this.generateClient(dbName);
      } catch (error) {
        console.error(`❌ Failed to generate client for ${dbName}:`, error);
        // 계속해서 다른 데이터베이스 처리
      }
    }
  }
}

export const migrationManager = new MigrationManager();
export default migrationManager;
