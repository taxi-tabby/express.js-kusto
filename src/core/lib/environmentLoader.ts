import { config } from 'dotenv';
import path from 'path';

/**
 * 환경변수 로더 유틸리티
 * 프로젝트 전체에서 일관된 환경변수 로딩을 보장
 */
export class EnvironmentLoader {
  private static isLoaded = false;

  /**
   * 환경변수 로드 (한 번만 실행)
   */
  static load(): void {
    if (this.isLoaded) {
      return;
    }

    // .env 파일 로드
    const envPath = path.resolve(process.cwd(), '.env');
    const result = config({ path: envPath });

    if (result.error) {
      console.warn('Warning: .env file not found or could not be loaded:', result.error.message);
    }

    this.isLoaded = true;
  }

  /**
   * 환경변수 강제 재로드
   */
  static reload(): void {
    this.isLoaded = false;
    this.load();
  }

  /**
   * 현재 환경이 프로덕션인지 확인
   */
  static isProduction(): boolean {
    this.load(); // 환경변수 로드 보장
    const env = process.env.NODE_ENV?.toLowerCase();
    return env === 'production' || env === 'prod';
  }

  /**
   * 현재 환경이 개발환경인지 확인
   */
  static isDevelopment(): boolean {
    return !this.isProduction();
  }

  /**
   * 환경변수 값 가져오기 (로드 보장)
   */
  static get(key: string, defaultValue?: string): string | undefined {
    this.load(); // 환경변수 로드 보장
    return process.env[key] || defaultValue;
  }

  /**
   * 필수 환경변수 값 가져오기 (없으면 에러)
   */
  static getRequired(key: string): string {
    this.load(); // 환경변수 로드 보장
    const value = process.env[key];
    if (!value) {
      throw new Error(`Required environment variable '${key}' is not set`);
    }
    return value;
  }

  /**
   * 현재 로드된 환경변수 상태 확인
   */
  static getLoadStatus(): { isLoaded: boolean; nodeEnv: string | undefined } {
    return {
      isLoaded: this.isLoaded,
      nodeEnv: process.env.NODE_ENV
    };
  }
}
