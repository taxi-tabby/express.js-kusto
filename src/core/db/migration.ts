import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

/**
 * 마이그레이션 관리 클래스
 */
export class MigrationManager {
  private readonly migrationsDir: string;
  private readonly schemaPath: string;
  constructor() {
    this.migrationsDir = join(process.cwd(), 'src', 'app', 'db', 'migrations');
    this.schemaPath = join(process.cwd(), 'src', 'app', 'db', 'schema.prisma');
    
    // 마이그레이션 디렉토리 생성
    if (!existsSync(this.migrationsDir)) {
      mkdirSync(this.migrationsDir, { recursive: true });
    }
  }

  /**
   * 새 마이그레이션 생성
   */
  public async createMigration(name: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '').substring(0, 15);
    const migrationName = `${timestamp}_${name}`;
    const migrationPath = join(this.migrationsDir, `${migrationName}.sql`);

    // 마이그레이션 파일 템플릿
    const template = `-- Migration: ${migrationName}
-- Created: ${new Date().toISOString()}

-- Add your SQL migration here
-- Example:
-- ALTER TABLE "User" ADD COLUMN "role" TEXT DEFAULT 'user';
`;

    writeFileSync(migrationPath, template);
    console.log(`✅ Created migration: ${migrationName}.sql`);
    
    return migrationPath;
  }

  /**
   * Prisma 마이그레이션 실행
   */
  public async runMigrations(name?: string): Promise<void> {
    try {
      console.log('🚀 Running Prisma migrations...');
        if (name) {
        execSync(`npx prisma migrate dev --name ${name} --schema=src/app/db/schema.prisma`, { 
          stdio: 'inherit',
          cwd: process.cwd()
        });
      } else {
        execSync('npx prisma migrate dev --schema=src/app/db/schema.prisma', { 
          stdio: 'inherit',
          cwd: process.cwd()
        });
      }
      
      console.log('✅ Migrations completed successfully');
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  /**
   * 마이그레이션 상태 확인
   */
  public async getStatus(): Promise<void> {
    try {      console.log('📊 Checking migration status...');
      execSync('npx prisma migrate status --schema=src/app/db/schema.prisma', { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
    } catch (error) {
      console.error('❌ Failed to get migration status:', error);
      throw error;
    }
  }

  /**
   * Prisma Client 생성
   */
  public async generateClient(): Promise<void> {
    try {      console.log('🔄 Generating Prisma Client...');
      execSync('npx prisma generate --schema=src/app/db/schema.prisma', { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
      console.log('✅ Prisma Client generated successfully');
    } catch (error) {
      console.error('❌ Failed to generate Prisma Client:', error);
      throw error;
    }
  }

  /**
   * 데이터베이스 리셋
   */
  public async resetDatabase(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve, reject) => {
      rl.question('⚠️  This will reset your database. Are you sure? (y/N): ', (answer) => {
        rl.close();
        
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          try {            console.log('🗑️  Resetting database...');
            execSync('npx prisma migrate reset --force --schema=src/app/db/schema.prisma', { 
              stdio: 'inherit',
              cwd: process.cwd()
            });
            console.log('✅ Database reset completed');
            resolve();
          } catch (error) {
            console.error('❌ Database reset failed:', error);
            reject(error);
          }
        } else {
          console.log('❌ Database reset cancelled');
          resolve();
        }
      });
    });
  }

  /**
   * 스키마 푸시 (프로덕션용)
   */
  public async pushSchema(): Promise<void> {
    try {      console.log('📤 Pushing schema to database...');
      execSync('npx prisma db push --schema=src/app/db/schema.prisma', { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
      console.log('✅ Schema pushed successfully');
    } catch (error) {
      console.error('❌ Schema push failed:', error);
      throw error;
    }
  }

  /**
   * 시드 실행
   */
  public async runSeed(): Promise<void> {
    try {      console.log('🌱 Running database seed...');
      execSync('npx prisma db seed --schema=src/app/db/schema.prisma', { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
      console.log('✅ Seed completed successfully');
    } catch (error) {
      console.error('❌ Seed failed:', error);
      throw error;
    }
  }

  /**
   * Prisma Studio 실행
   */
  public async openStudio(): Promise<void> {
    try {      console.log('🎨 Opening Prisma Studio...');
      execSync('npx prisma studio --schema=src/app/db/schema.prisma', { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
    } catch (error) {
      console.error('❌ Failed to open Prisma Studio:', error);
      throw error;
    }
  }
}

export const migrationManager = new MigrationManager();
export default migrationManager;
