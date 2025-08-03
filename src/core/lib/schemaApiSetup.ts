import { Application } from 'express';
import { SchemaApiRouter } from './schemaApiRouter';

/**
 * Express 애플리케이션에 스키마 API를 등록하는 헬퍼 함수
 * 개발 모드에서만 스키마 API 엔드포인트를 활성화합니다
 */
export class SchemaApiSetup {
  private static isRegistered = false;

  /**
   * Express 앱에 스키마 API 라우터를 등록합니다
   * @param app Express 애플리케이션 인스턴스
   * @param basePath 스키마 API의 기본 경로 (기본값: '/api/schema')
   */
  public static registerSchemaApi(app: Application, basePath: string = '/api/schema'): void {
    console.log('🔧 스키마 API 등록 시도 중...');
    
    if (this.isRegistered) {
      console.warn('⚠️  스키마 API가 이미 등록되어 있습니다. 중복 등록을 방지합니다.');
      return;
    }

    const nodeEnv = process.env.NODE_ENV?.toLowerCase();
    const enableSchemaApi = process.env.ENABLE_SCHEMA_API?.toLowerCase();

    console.log(`🔍 환경 변수 확인:`);
    console.log(`   NODE_ENV: ${nodeEnv || 'undefined'}`);
    console.log(`   ENABLE_SCHEMA_API: ${enableSchemaApi || 'undefined'}`);

    const isEnabled = 
      nodeEnv === 'development' || 
      nodeEnv === 'dev' ||
      enableSchemaApi === 'true' ||
      enableSchemaApi === '1';

    console.log(`🎯 스키마 API 활성화 여부: ${isEnabled}`);

    if (!isEnabled) {
      console.log('❌ 스키마 API는 개발 모드에서만 활성화됩니다.');
      console.log('💡 해결 방법: NODE_ENV=development 설정 또는 ENABLE_SCHEMA_API=true 설정');
      return;
    }

    try {
      const schemaRouter = new SchemaApiRouter();
      app.use(basePath, schemaRouter.getRouter());
      
      this.isRegistered = true;
      
      console.log('✅ CRUD 스키마 API가 성공적으로 등록되었습니다:');
      console.log(`   📋 GET ${basePath}/ - 모든 스키마 목록`);
      console.log(`   📋 GET ${basePath}/database/:databaseName - 데이터베이스별 스키마`);
      console.log(`   📋 GET ${basePath}/:databaseName/:modelName - 특정 스키마 상세`);
      console.log(`   📊 GET ${basePath}/meta/stats - 스키마 통계`);
      console.log(`   ❤️  GET ${basePath}/meta/health - 헬스체크`);
    } catch (error) {
      console.error('❌ 스키마 API 등록 실패:', error);
    }
  }

  /**
   * 스키마 API가 등록되어 있는지 확인합니다
   */
  public static isSchemaApiRegistered(): boolean {
    return this.isRegistered;
  }

  /**
   * 등록 상태를 초기화합니다 (테스트용)
   */
  public static resetRegistrationState(): void {
    this.isRegistered = false;
  }
}
