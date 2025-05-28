import { PrismaManager, getDefaultClient, addDatabase, type DatabaseConfig, type PrismaClientType } from './index';

/**
 * 고수준 데이터베이스 유틸리티 클래스
 */
export class DatabaseService {
	private manager: PrismaManager;

	constructor() {
		this.manager = PrismaManager.getInstance();
	}

	/**
	 * 여러 데이터베이스 일괄 설정
	 */
	public async setupDatabases(configs: DatabaseConfig[]): Promise<void> {
		for (const config of configs) {
			this.manager.addDatabase(config);
		}
	}

	/**
	 * 데이터베이스 헬스 체크
	 */
	public async healthCheck(): Promise<Record<string, boolean>> {
		const dbNames = this.manager.getDatabaseNames();
		const results: Record<string, boolean> = {};

		for (const dbName of dbNames) {
			results[dbName] = await this.manager.checkConnection(dbName);
		}

		return results;
	}
	/**
	 * 트랜잭션 실행 (기본 데이터베이스)
	 */
	public async executeTransaction<T>(fn: (client: PrismaClientType) => Promise<T>): Promise<T> {
		const client = getDefaultClient();
		return client.$transaction(fn);
	}

	/**
	 * 특정 데이터베이스에서 트랜잭션 실행
	 */
	public async executeTransactionOn<T>(dbName: string, fn: (client: PrismaClientType) => Promise<T>): Promise<T> {
		const client = this.manager.getClient(dbName);
		return client.$transaction(fn);
	}

	/**
	 * 데이터베이스 마이그레이션 상태 확인
	 */
	public async getMigrationStatus(dbName: string = 'default'): Promise<any> {
		const client = this.manager.getClient(dbName);
		try {
			// Prisma의 마이그레이션 테이블 조회
			const migrations = await client.$queryRaw`
        SELECT * FROM _prisma_migrations ORDER BY started_at DESC;
      `;
			return migrations;
		} catch (error) {
			console.warn('Migration table not found or accessible:', error);
			return [];
		}
	}


	/**
	 * 모든 연결 정리
	 */
	public async cleanup(): Promise<void> {
		await this.manager.disconnectAll();
	}
}

export const databaseService = new DatabaseService();
export default databaseService;
