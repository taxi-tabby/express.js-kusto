import { Router, Request, Response, NextFunction } from 'express';
import { CrudSchemaRegistry } from './crudSchemaRegistry';

/**
 * 개발 모드에서만 활성화되는 스키마 API 라우터
 * CRUD 스키마 정보를 조회할 수 있는 엔드포인트를 제공합니다
 */
export class SchemaApiRouter {
  private router: Router;
  private registry: CrudSchemaRegistry;

  constructor() {
    this.router = Router();
    this.registry = CrudSchemaRegistry.getInstance();
    console.log('🔧 SchemaApiRouter 생성 중...');
    console.log(`🎯 스키마 API 활성화 상태: ${this.registry.isSchemaApiEnabled()}`);
    this.setupRoutes();
  }

  /**
   * 개발 모드 체크 미들웨어
   */
  private developmentOnlyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    if (!this.registry.isSchemaApiEnabled()) {
      res.status(403).json({
        success: false,
        error: {
          code: 'SCHEMA_API_DISABLED',
          message: '스키마 API는 개발 환경에서만 사용할 수 있습니다.',
          hint: 'NODE_ENV=development로 설정하거나 ENABLE_SCHEMA_API=true 환경변수를 설정하세요.'
        }
      });
      return;
    }

    // 로컬호스트 체크 (보안강화)
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    const isLocalhost = 
      clientIP === '127.0.0.1' || 
      clientIP === '::1' || 
      clientIP === 'localhost' ||
      clientIP?.includes('127.0.0.1') ||
      clientIP?.includes('::1');

    if (!isLocalhost && process.env.ENABLE_SCHEMA_API !== 'true') {
      res.status(403).json({
        success: false,
        error: {
          code: 'IP_ACCESS_DENIED',
          message: '스키마 API는 로컬호스트에서만 접근 가능합니다.',
          hint: 'localhost에서 접근하거나 ENABLE_SCHEMA_API=true로 설정하세요.',
          clientIP: clientIP
        }
      });
      return;
    }

    next();
  };

  /**
   * 라우트 설정
   */
  private setupRoutes(): void {
    // 모든 라우트에 개발 모드 체크 미들웨어 적용
    this.router.use(this.developmentOnlyMiddleware);

    // 모든 스키마 목록 조회
    this.router.get('/', this.getAllSchemas);

    // 특정 데이터베이스의 스키마들 조회
    this.router.get('/database/:databaseName', this.getSchemasByDatabase);

    // 특정 스키마 상세 조회
    this.router.get('/:databaseName/:modelName', this.getSchemaDetail);

    // 스키마 통계 정보
    this.router.get('/meta/stats', this.getSchemaStats);

    // 헬스체크
    this.router.get('/meta/health', this.getHealthCheck);
  }

  /**
   * 모든 스키마 목록 조회
   */
  private getAllSchemas = async (req: Request, res: Response): Promise<void> => {
    try {
      // TypeORM 호환 형식으로 응답
      const result = this.registry.getTypeOrmCompatibleSchema();
      res.json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * 특정 데이터베이스의 스키마들 조회
   */
  private getSchemasByDatabase = async (req: Request, res: Response): Promise<void> => {
    try {
      const { databaseName } = req.params;
      const result = this.registry.getSchemasByDatabase(databaseName);
      res.json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * 특정 스키마 상세 조회
   */
  private getSchemaDetail = async (req: Request, res: Response): Promise<void> => {
    try {
      const { databaseName, modelName } = req.params;
      const result = this.registry.getSchema(databaseName, modelName);
      res.json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * 스키마 통계 정보
   */
  private getSchemaStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const allSchemas = this.registry.getAllSchemas();
      const schemas = allSchemas.data.schemas;

      const stats = {
        totalSchemas: schemas.length,
        totalDatabases: allSchemas.data.databases.length,
        totalModels: allSchemas.data.models.length,
        actionStats: this.calculateActionStats(schemas),
        databaseStats: this.calculateDatabaseStats(schemas),
        recentlyRegistered: schemas
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 5)
          .map(schema => ({
            key: `${schema.databaseName}.${schema.modelName}`,
            createdAt: schema.createdAt,
            actionsCount: schema.enabledActions.length
          })),
        environment: process.env.NODE_ENV || 'unknown',
        timestamp: new Date()
      };

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * 헬스체크
   */
  private getHealthCheck = async (req: Request, res: Response): Promise<void> => {
    try {
      const healthData = {
        status: 'healthy',
        schemaApiEnabled: this.registry.isSchemaApiEnabled(),
        registeredSchemas: this.registry.getSchemaCount(),
        environment: process.env.NODE_ENV || 'unknown',
        timestamp: new Date(),
        debug: {
          nodeEnv: process.env.NODE_ENV,
          enableSchemaApi: process.env.ENABLE_SCHEMA_API,
          clientIP: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent')
        }
      };

      console.log('🏥 헬스체크 요청됨:', healthData);

      res.json({
        success: true,
        data: healthData
      });
    } catch (error) {
      console.error('헬스체크 오류:', error);
      this.handleError(res, error);
    }
  };

  /**
   * 액션 통계 계산
   */
  private calculateActionStats(schemas: any[]): Record<string, number> {
    const actionStats: Record<string, number> = {};
    
    for (const schema of schemas) {
      for (const action of schema.enabledActions) {
        actionStats[action] = (actionStats[action] || 0) + 1;
      }
    }

    return actionStats;
  }

  /**
   * 데이터베이스별 통계 계산
   */
  private calculateDatabaseStats(schemas: any[]): Record<string, number> {
    const dbStats: Record<string, number> = {};
    
    for (const schema of schemas) {
      dbStats[schema.databaseName] = (dbStats[schema.databaseName] || 0) + 1;
    }

    return dbStats;
  }

  /**
   * 에러 처리
   */
  private handleError(res: Response, error: any): void {
    console.error('Schema API Error:', error);

    const statusCode = error.message?.includes('찾을 수 없습니다') ? 404 : 500;

    res.status(statusCode).json({
      success: false,
      error: {
        message: error.message || '내부 서버 오류가 발생했습니다.',
        code: statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
        timestamp: new Date()
      }
    });
  }

  /**
   * Express Router 반환
   */
  public getRouter(): Router {
    return this.router;
  }
}
