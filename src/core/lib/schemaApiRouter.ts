import { Router, Request, Response, NextFunction } from 'express';
import { CrudSchemaRegistry } from './crudSchemaRegistry';
import { createPaginationCursor } from '../external/util';
import { log } from '../external/winston';
import { ERROR_CODES } from './errorCodes';

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
    log.Debug('SchemaApiRouter initialized', { enabled: this.registry.isSchemaApiEnabled() });
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
          code: ERROR_CODES.FEATURE_DISABLED,
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
          code: ERROR_CODES.FORBIDDEN,
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

    // 헬스체크 (최우선)
    this.router.get('/meta/health', this.getHealthCheck);

    // API 도움말
    this.router.get('/meta/help', this.getApiHelp);

    // 스키마 통계 정보
    this.router.get('/meta/stats', this.getSchemaStats);

    // 자동 등록된 모델들만 조회
    this.router.get('/auto-registered', this.getAutoRegisteredSchemas);

    // 수동 등록된 모델들만 조회 (실제 CRUD 활성화된 모델들)
    this.router.get('/manual-registered', this.getManualRegisteredSchemas);

    // 데이터베이스 목록 조회
    this.router.get('/databases', this.getDatabases);

    // 모든 스키마 목록 조회 (TypeORM 호환 형식)
    this.router.get('/', this.getAllSchemas);

    // 특정 데이터베이스의 모든 스키마 조회
    this.router.get('/database/:databaseName', this.getSchemasByDatabase);

    // 특정 데이터베이스의 특정 모델 스키마 조회
    this.router.get('/database/:databaseName/:modelName', this.getSchemaDetail);

    // 레거시 지원: 특정 스키마 상세 조회 (기존 형식)
    this.router.get('/:databaseName/:modelName', this.getSchemaDetail);
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
   * 자동 등록된 모델들만 조회
   */
  private getAutoRegisteredSchemas = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = this.registry.getAutoRegisteredSchemas();
      res.json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * 수동 등록된 모델들만 조회 (실제 CRUD 활성화된 모델들)
   */
  private getManualRegisteredSchemas = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = this.registry.getManualRegisteredSchemas();
      res.json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * 사용 가능한 데이터베이스 목록 조회
   */
  private getDatabases = async (req: Request, res: Response): Promise<void> => {
    try {
      const allSchemas = this.registry.getAllSchemas();
      const databases = allSchemas.data.databases;
      
      const databasesWithInfo = databases.map(dbName => {
        const dbSchemas = allSchemas.data.schemas.filter(schema => schema.databaseName === dbName);
        return {
          name: dbName,
          modelCount: dbSchemas.length,
          models: dbSchemas.map(schema => ({
            name: schema.modelName,
            actionsCount: schema.enabledActions.length,
            basePath: schema.basePath,
            createdAt: schema.createdAt
          }))
        };
      });

      res.json({
        success: true,
        data: {
          databases: databasesWithInfo,
          totalDatabases: databases.length,
          totalModels: allSchemas.data.schemas.length
        },
        meta: {
          timestamp: new Date(),
          environment: process.env.NODE_ENV || 'unknown'
        }
      });
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
      const { format } = req.query;
      
      if (format === 'typeorm') {
        // TypeORM 호환 형식으로 특정 데이터베이스의 스키마만 반환
        const allSchemas = this.registry.getTypeOrmCompatibleSchema();
        const filteredEntities = allSchemas.data.filter((entity: any) => {
          // 데이터베이스별 필터링 로직
          // 스키마 레지스트리에서 해당 엔티티가 어느 데이터베이스에 속하는지 확인
          const schemaKey = `${databaseName}.${entity.entityName}`;
          return this.registry.hasSchema(databaseName, entity.entityName);
        });
        
        res.json({
          data: filteredEntities,
          metadata: {
            timestamp: new Date().toISOString(),
            affectedCount: filteredEntities.length,
            database: databaseName,
            pagination: {
              type: "offset",
              total: filteredEntities.length,
              page: 1,
              pages: 1,
              offset: filteredEntities.length,
              nextCursor: createPaginationCursor(filteredEntities.length)
            }
          }
        });
      } else {
        // 기본 형식
        const result = this.registry.getSchemasByDatabase(databaseName);
        res.json(result);
      }
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
      const { format } = req.query;
      
      // 기본적으로 TypeORM 형식 사용
      if (format !== 'raw') {
        // TypeORM 호환 형식으로 단일 엔티티 반환
        const result = this.registry.getTypeOrmCompatibleSchema(databaseName, modelName);
        res.json(result);
      } else {
        // 원시 형식 (레거시)
        const result = this.registry.getSchema(databaseName, modelName);
        res.json(result);
      }
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

      const autoRegistered = schemas.filter(s => s.isAutoRegistered);
      const manualRegistered = schemas.filter(s => !s.isAutoRegistered);

      const stats = {
        totalSchemas: schemas.length,
        autoRegisteredSchemas: autoRegistered.length,
        manualRegisteredSchemas: manualRegistered.length,
        totalDatabases: allSchemas.data.databases.length,
        totalModels: allSchemas.data.models.length,
        registrationBreakdown: {
          autoRegistered: autoRegistered.map(s => ({
            key: `${s.databaseName}.${s.modelName}`,
            basePath: s.basePath,
            note: 'Schema structure only, CRUD not enabled'
          })),
          manualRegistered: manualRegistered.map(s => ({
            key: `${s.databaseName}.${s.modelName}`,
            basePath: s.basePath,
            enabledActions: s.enabledActions,
            note: 'Full CRUD functionality enabled'
          }))
        },
        actionStats: this.calculateActionStats(schemas),
        databaseStats: this.calculateDatabaseStats(schemas),
        recentlyRegistered: schemas
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 5)
          .map(schema => ({
            key: `${schema.databaseName}.${schema.modelName}`,
            createdAt: schema.createdAt,
            actionsCount: schema.enabledActions.length,
            isAutoRegistered: schema.isAutoRegistered || false
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

      log.Debug('Health check requested', healthData);

      res.json({
        success: true,
        data: healthData
      });
    } catch (error) {
      log.Error('Health check error', { error });
      this.handleError(res, error);
    }
  };

  /**
   * API 도움말
   */
  private getApiHelp = async (req: Request, res: Response): Promise<void> => {
    try {
      const apiEndpoints = {
        meta: {
          health: {
            method: 'GET',
            path: '/api/schema/meta/health',
            description: '스키마 API 헬스체크 및 시스템 상태'
          },
          stats: {
            method: 'GET',
            path: '/api/schema/meta/stats',
            description: '등록된 스키마들의 통계 정보'
          },
          help: {
            method: 'GET',
            path: '/api/schema/meta/help',
            description: 'API 사용법 및 엔드포인트 목록'
          }
        },
        schemas: {
          all: {
            method: 'GET',
            path: '/api/schema/',
            description: '모든 스키마 조회 (TypeORM 호환 형식)',
            queryParams: {
              format: 'typeorm (기본값) | raw'
            }
          },
          autoRegistered: {
            method: 'GET',
            path: '/api/schema/auto-registered',
            description: '자동 등록된 모델들만 조회 (스키마 구조만 제공, CRUD 미활성화)'
          },
          manualRegistered: {
            method: 'GET',
            path: '/api/schema/manual-registered',
            description: '수동 등록된 모델들만 조회 (실제 CRUD 기능 활성화된 모델들)'
          },
          databases: {
            method: 'GET',
            path: '/api/schema/databases',
            description: '사용 가능한 데이터베이스 목록'
          },
          byDatabase: {
            method: 'GET',
            path: '/api/schema/database/:databaseName',
            description: '특정 데이터베이스의 모든 스키마',
            params: {
              databaseName: '데이터베이스 이름 (예: user, temporary)'
            },
            queryParams: {
              format: 'typeorm (기본값) | raw'
            }
          },
          detail: {
            method: 'GET',
            path: '/api/schema/database/:databaseName/:modelName',
            description: '특정 모델의 상세 스키마 정보',
            params: {
              databaseName: '데이터베이스 이름',
              modelName: '모델 이름 (예: User, Role)'
            },
            queryParams: {
              format: 'typeorm (기본값) | raw'
            }
          },
          legacyDetail: {
            method: 'GET',
            path: '/api/schema/:databaseName/:modelName',
            description: '특정 모델의 상세 스키마 정보 (레거시 형식)',
            params: {
              databaseName: '데이터베이스 이름',
              modelName: '모델 이름'
            },
            queryParams: {
              format: 'typeorm (기본값) | raw'
            }
          }
        }
      };

      const examples = {
        getAllSchemas: 'GET /api/schema/',
        getAutoRegistered: 'GET /api/schema/auto-registered',
        getManualRegistered: 'GET /api/schema/manual-registered',
        getDatabases: 'GET /api/schema/databases',
        getUserSchemas: 'GET /api/schema/database/user',
        getUserModel: 'GET /api/schema/database/default/User (TypeORM 기본)',
        getTypeOrmFormat: 'GET /api/schema/database/user?format=typeorm',
        getRawFormat: 'GET /api/schema/database/user?format=raw',
        getSingleEntity: 'GET /api/schema/database/default/User (기본: TypeORM)'
      };

      res.json({
        success: true,
        data: {
          title: 'CRUD Schema API 도움말',
          description: '개발 모드에서만 사용 가능한 스키마 조회 API입니다.',
          version: '1.0.0',
          multiDatabase: true,
          endpoints: apiEndpoints,
          examples,
          notes: [
            '이 API는 개발 환경(NODE_ENV=development)에서만 활성화됩니다.',
            'TypeORM 호환 형식을 기본으로 제공합니다.',
            '멀티 데이터베이스를 지원합니다.',
            '모든 응답은 JSON 형식입니다.'
          ]
        },
        meta: {
          timestamp: new Date(),
          environment: process.env.NODE_ENV || 'unknown'
        }
      });
    } catch (error) {
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
    log.Error('Schema API Error', { error });

    const statusCode = error.message?.includes('찾을 수 없습니다') ? 404 : 500;

    res.status(statusCode).json({
      success: false,
      error: {
        message: error.message || '내부 서버 오류가 발생했습니다.',
        code: statusCode === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.INTERNAL_ERROR,
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
