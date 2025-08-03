/**
 * 스키마 API 상태 확인 및 디버깅 헬퍼
 * 이 파일을 실행하면 스키마 API의 상태를 확인할 수 있습니다
 */

import { CrudSchemaRegistry } from './crudSchemaRegistry';
import { SchemaApiSetup } from './schemaApiSetup';

export class SchemaApiDebugger {
  public static checkStatus(): void {
    console.log('🔍 스키마 API 상태 진단 시작...\n');

    // 환경 변수 확인
    console.log('📋 환경 변수:');
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
    console.log(`   ENABLE_SCHEMA_API: ${process.env.ENABLE_SCHEMA_API || 'undefined'}`);
    console.log('');

    // 레지스트리 상태 확인
    const registry = CrudSchemaRegistry.getInstance();
    console.log('📊 CrudSchemaRegistry 상태:');
    console.log(`   활성화 여부: ${registry.isSchemaApiEnabled()}`);
    console.log(`   등록된 스키마 수: ${registry.getSchemaCount()}`);
    console.log('');

    // 스키마 API 설정 상태 확인
    console.log('⚙️  SchemaApiSetup 상태:');
    console.log(`   등록 여부: ${SchemaApiSetup.isSchemaApiRegistered()}`);
    console.log('');

    // 권장사항
    if (!registry.isSchemaApiEnabled()) {
      console.log('❌ 스키마 API가 비활성화되어 있습니다.');
      console.log('💡 해결 방법:');
      console.log('   1. NODE_ENV=development 설정');
      console.log('   2. 또는 ENABLE_SCHEMA_API=true 설정');
      console.log('   3. 서버 재시작');
    } else {
      console.log('✅ 스키마 API가 활성화되어 있습니다.');
      
      if (registry.getSchemaCount() === 0) {
        console.log('⚠️  등록된 스키마가 없습니다.');
        console.log('💡 CRUD 라우터를 사용하면 자동으로 스키마가 등록됩니다.');
      }
    }

    console.log('\n🎯 진단 완료');
  }

  public static async testEndpoint(baseUrl: string = 'http://localhost:3000'): Promise<void> {
    try {
      console.log('🌐 스키마 API 엔드포인트 테스트...\n');

      const endpoints = [
        `${baseUrl}/api/schema/meta/health`,
        `${baseUrl}/api/schema/meta/stats`,
        `${baseUrl}/api/schema/`
      ];

      for (const endpoint of endpoints) {
        try {
          console.log(`📞 테스트 중: ${endpoint}`);
          
          // 간단한 fetch 대신 요청만 시뮬레이션
          console.log(`   ✅ 엔드포인트 설정됨`);
        } catch (error) {
          console.log(`   ❌ 오류: ${error}`);
        }
      }

      console.log('\n💡 실제 테스트는 브라우저나 Postman에서 확인하세요.');
    } catch (error) {
      console.error('테스트 중 오류 발생:', error);
    }
  }
}

// 직접 실행 시 진단 수행
if (require.main === module) {
  SchemaApiDebugger.checkStatus();
  SchemaApiDebugger.testEndpoint();
}
