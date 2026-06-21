import { Application } from 'express';
import { SchemaApiRouter } from '@lib/devtools/schema-api/schemaApiRouter';
import { CrudSchemaRegistry } from '@lib/devtools/schema-api/crudSchemaRegistry';
import { log } from '@ext/winston';

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
        if (this.isRegistered) {
            log.Warn('Schema API is already registered. Preventing duplicate registration.');
            return;
        }

        const nodeEnv = process.env.NODE_ENV?.toLowerCase();
        const enableSchemaApi = process.env.ENABLE_SCHEMA_API?.toLowerCase();

        log.Silly(
            `Environment variable check: NODE_ENV=${nodeEnv || 'undefined'}, ENABLE_SCHEMA_API=${enableSchemaApi || 'undefined'}`,
        );

        // 스키마 API 활성화 판정은 CrudSchemaRegistry 의 단일 캐논 헬퍼로 위임 (중복 제거)
        const isEnabled = CrudSchemaRegistry.getInstance().isSchemaApiEnabled();

        if (!isEnabled) {
            log.Debug(
                'Schema API is enabled only in development mode. Set NODE_ENV=development or ENABLE_SCHEMA_API=true.',
            );
            return;
        }

        try {
            const schemaRouter = new SchemaApiRouter();
            app.use(basePath, schemaRouter.getRouter());

            this.isRegistered = true;

            log.Info(
                `CRUD schema API registered: ${basePath}/ (list), ${basePath}/database/:databaseName, ${basePath}/:databaseName/:modelName, ${basePath}/meta/stats, ${basePath}/meta/health`,
            );
        } catch (error) {
            log.Error('Failed to register schema API:', error);
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
