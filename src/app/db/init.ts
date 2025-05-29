import { addDatabase, initializeAllClients, scanAndRegisterClients } from "../../core/db";
import { migrationManager } from "../../core/db/migration";
/**
 * 데이터베이스 구성
 * 
 * 이 파일은 애플리케이션에서 사용할 각 데이터베이스 구성을 정의합니다.
 * 사용하려는 데이터베이스에 맞게 설정을 변경하세요.
 * 
 * 자동 클라이언트 탐지 기능:
 * - src/app/db/schemas/clients 폴더의 모든 Prisma 클라이언트를 자동으로 탐지
 * - 각 클라이언트에 맞는 환경 변수를 찾아 자동 연결 설정
 */

import { DatabaseConfig } from '../../core/db';

/**
 * 데이터베이스 초기화 함수
 * - 기본 데이터베이스 설정을 로드하고 연결을 설정합니다.
 * - clients 폴더에서 Prisma 클라이언트를 자동으로 탐지하고 등록합니다.
 * - 필요한 경우 여러 데이터베이스 연결을 추가할 수 있습니다.
 */
const initDb = async () => {

	const env = process.env;

	await scanAndRegisterClients();

	
	const defaultDbConfig: DatabaseConfig = {
		name: 'default',
		provider: 'postgresql',
		connection: {
			host: env.RDS_DEFAULT_HOST || 'localhost',
			port: parseInt(env.RDS_DEFAULT_PORT || '5432'),
			username: env.RDS_DEFAULT_USER || 'postgres',
			password: env.RDS_DEFAULT_PASSWORD || 'postgres',
			database: env.RDS_DEFAULT_DB || 'default1',
			ssl: env.RDS_DEFAULT_SSL === 'true'
		},
		logging: env.NODE_ENV === 'development' ? ['query', 'error'] : ['error']
	};
	addDatabase(defaultDbConfig);
	migrationManager.addDatabaseFromConfig(defaultDbConfig);


	console.log(process.env.RDS_DEFAULT_HOST);
	console.log(process.env.RDS_DEFAULT_HOST);
	console.log(process.env.RDS_DEFAULT_HOST);
	console.log(process.env.RDS_DEFAULT_HOST);
	console.log(process.env.RDS_DEFAULT_HOST);


	await initializeAllClients();
};

// 즉시 실행
initDb();

export default initDb;
