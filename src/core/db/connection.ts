/**
 * 데이터베이스 연결 테스트 유틸리티
 */
import prismaManager, { DatabaseConfig, DatabaseProvider } from './index';

/**
 * 데이터베이스 연결을 테스트하는 함수
 */
export const testConnection = async (config: DatabaseConfig): Promise<boolean> => {
  try {
    // 임시로 설정 추가
    prismaManager.addDatabase(config);
    
    // 연결 테스트
    const result = await prismaManager.checkConnection(config.name);
    
    // 임시 설정 제거
    await prismaManager.disconnect(config.name);
    
    return result;
  } catch (error) {
    console.error(`테스트 연결 실패 (${config.name} - ${config.provider}):`, error);
    return false;
  }
};

/**
 * 모든 지원 데이터베이스에 대한 연결 테스트 정보 반환
 */
export const getDatabaseStatus = async (): Promise<Record<string, boolean>> => {
  const registeredDbs = prismaManager.getDatabaseNames();
  const statuses: Record<string, boolean> = {};
  
  // 등록된 데이터베이스 상태 확인
  for (const dbName of registeredDbs) {
    statuses[dbName] = await prismaManager.checkConnection(dbName);
  }
  
  return statuses;
};

/**
 * 데이터베이스 연결 정보 출력
 */
export const printDatabaseInfo = async (): Promise<void> => {
  const statuses = await getDatabaseStatus();
  
  console.log('\n=== 데이터베이스 연결 상태 ===');
  
  for (const [dbName, status] of Object.entries(statuses)) {
    console.log(`- ${dbName}: ${status ? '연결됨 ✅' : '연결 실패 ❌'}`);
  }
  
  console.log('===============================\n');
};
