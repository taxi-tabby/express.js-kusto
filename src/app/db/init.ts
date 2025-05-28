import { addDatabase } from "../../core/db";
import { migrationManager } from "../../core/db/migration";
/**
 * 데이터베이스 구성
 * 
 * 이 파일은 애플리케이션에서 사용할 각 데이터베이스 구성을 정의합니다.
 * 사용하려는 데이터베이스에 맞게 설정을 변경하세요.
 */

import { DatabaseConfig } from '../../core/db';

/**
 * 데이터베이스 초기화 함수
 * - 기본 데이터베이스 설정을 로드하고 연결을 설정합니다.
 * - 필요한 경우 여러 데이터베이스 연결을 추가할 수 있습니다.
 */
const initDb = () => {
	// 기본 PostgreSQL 데이터베이스 설정
	const defaultDbConfig: DatabaseConfig = {
		name: 'default',
		provider: 'postgresql',
		connection: {
			host: process.env.PG_HOST || 'localhost',
			port: parseInt(process.env.PG_PORT || '5432'),
			username: process.env.PG_USER || 'postgres',
			password: process.env.PG_PASSWORD || 'postgres',
			database: process.env.PG_DB || 'myapp',
			ssl: process.env.PG_SSL === 'true'
		},
		logging: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error']
	};
	addDatabase(defaultDbConfig);
	migrationManager.addDatabaseFromConfig(defaultDbConfig);

	// 예시: 추가 MySQL 데이터베이스
	if (process.env.MYSQL_HOST) {
		const mysqlDbConfig: DatabaseConfig = {
			name: 'mysql_analytics',
			provider: 'mysql',
			connection: {
				host: process.env.MYSQL_HOST,
				port: parseInt(process.env.MYSQL_PORT || '3306'),
				username: process.env.MYSQL_USER || 'root',
				password: process.env.MYSQL_PASSWORD || '',
				database: process.env.MYSQL_DB || 'analytics',
			},
			logging: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error']
		};
		addDatabase(mysqlDbConfig);
		migrationManager.addDatabaseFromConfig(mysqlDbConfig);
	}

	// 예시: SQLite 로컬 캐시 데이터베이스
	const cacheDbConfig: DatabaseConfig = {
		name: 'cache',
		provider: 'sqlite',
		connection: {
			database: process.env.SQLITE_PATH || './dev.db'
		},
		logging: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error']
	};
	addDatabase(cacheDbConfig);
	migrationManager.addDatabaseFromConfig(cacheDbConfig);

	// 예시: SQL Server 레거시 시스템
	if (process.env.SQLSERVER_HOST) {
		const legacyDbConfig: DatabaseConfig = {
			name: 'legacy',
			provider: 'sqlserver',
			connection: {
				host: process.env.SQLSERVER_HOST,
				port: parseInt(process.env.SQLSERVER_PORT || '1433'),
				username: process.env.SQLSERVER_USER || 'sa',
				password: process.env.SQLSERVER_PASSWORD || '',
				database: process.env.SQLSERVER_DB || 'legacy_system',
				ssl: process.env.SQLSERVER_SSL === 'true'
			},
			logging: ['error']
		};
		addDatabase(legacyDbConfig);
		migrationManager.addDatabaseFromConfig(legacyDbConfig);
	}
};

// 즉시 실행
initDb();

export default initDb;
