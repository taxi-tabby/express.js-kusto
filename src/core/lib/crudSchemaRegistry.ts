import { 
  CrudSchemaInfo, 
  CrudEndpointInfo, 
  PrismaModelInfo,
  SchemaApiResponse,
  AllSchemasResponse
} from './crudSchemaTypes';
import { PrismaSchemaAnalyzer } from './prismaSchemaAnalyzer';
import { RelationshipConfigManager } from './relationshipConfig';

/**
 * CRUD 스키마 정보를 등록하고 관리하는 레지스트리
 * 개발 모드에서만 사용됩니다.
 */
export class CrudSchemaRegistry {
  private static instance: CrudSchemaRegistry;
  private schemas: Map<string, CrudSchemaInfo> = new Map();
  private isEnabled: boolean = false;
  private relationshipManager: RelationshipConfigManager;

  private constructor() {
    this.checkEnvironment();
    this.relationshipManager = new RelationshipConfigManager();
  }

  public static getInstance(): CrudSchemaRegistry {
    if (!CrudSchemaRegistry.instance) {
      CrudSchemaRegistry.instance = new CrudSchemaRegistry();
    }
    return CrudSchemaRegistry.instance;
  }

  /**
   * 개발 환경인지 확인하고 스키마 API 활성화 여부를 결정합니다
   */
  private checkEnvironment(): void {
    const nodeEnv = process.env.NODE_ENV?.toLowerCase();
    const enableSchemaApi = process.env.ENABLE_SCHEMA_API?.toLowerCase();

    this.isEnabled = 
      nodeEnv === 'development' || 
      nodeEnv === 'dev' ||
      enableSchemaApi === 'true' ||
      enableSchemaApi === '1';

    console.log('🔍 CrudSchemaRegistry 환경 확인:');
    console.log(`   NODE_ENV: ${nodeEnv || 'undefined'}`);
    console.log(`   ENABLE_SCHEMA_API: ${enableSchemaApi || 'undefined'}`);
    console.log(`   스키마 API 활성화: ${this.isEnabled}`);

    if (this.isEnabled) {
      console.log('🔧 CRUD Schema API가 개발 모드에서 활성화되었습니다.');
    }
  }

  /**
   * 스키마 API가 활성화되어 있는지 확인합니다
   */
  public isSchemaApiEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * 모든 모델을 자동으로 스캔하여 등록합니다
   */
  public autoRegisterAllModels(analyzer: PrismaSchemaAnalyzer, databaseName?: string): void {
    if (!this.isEnabled) {
      return; // 개발 모드가 아니면 등록하지 않음
    }

    const dbName = databaseName || analyzer.getDatabaseName();
    const allModels = analyzer.getAllModels();

    // 간단한 로그만 출력
    // console.log(`🔍 [${dbName}] 모든 모델 자동 등록 시작: ${allModels.length}개 모델 발견`);

    for (const model of allModels) {
      const modelName = model.name;
      const schemaKey = `${dbName}.${modelName}`;

      // 이미 등록된 모델은 건너뛰기
      if (this.schemas.has(schemaKey)) {
        // console.log(`⏭️  [${dbName}] 이미 등록된 모델 건너뛰기: ${modelName}`);
        continue;
      }

      // 모델을 기본 설정으로 자동 등록
      this.autoRegisterModel(dbName, modelName, analyzer);
    }

    // console.log(`✅ [${dbName}] 모든 모델 자동 등록 완료: ${this.schemas.size}개 스키마 등록됨`);
  }

  /**
   * 개별 모델을 기본 설정으로 자동 등록합니다
   */
  private autoRegisterModel(databaseName: string, modelName: string, analyzer: PrismaSchemaAnalyzer): void {
    try {
      const modelInfo = analyzer.getModel(modelName);
      if (!modelInfo) {
        console.warn(`⚠️  [${databaseName}] 모델 정보를 찾을 수 없음: ${modelName}`);
        return;
      }

      const primaryKeyField = analyzer.getPrimaryKeyField(modelName);
      const primaryKey = primaryKeyField?.name || 'id';
      const primaryKeyType = primaryKeyField?.jsType || 'string';

      // 기본 경로 생성 (모델명을 소문자 복수형으로)
      const basePath = this.generateBasePath(modelName);

      // 기본 액션들 (CRUD 미사용 모델도 구조는 제공)
      const enabledActions = ['index', 'show', 'create', 'update', 'destroy'];

      // 소프트 삭제 필드 확인
      const softDeleteField = modelInfo.fields.find(field => 
        field.name === 'deletedAt' || field.name === 'deleted_at'
      );
      const softDeleteEnabled = !!softDeleteField;

      if (softDeleteEnabled) {
        enabledActions.push('recover');
      }

      const schemaInfo: CrudSchemaInfo = {
        databaseName,
        modelName,
        basePath,
        primaryKey,
        primaryKeyType,
        enabledActions,
        model: modelInfo,
        options: {
          softDelete: softDeleteEnabled ? {
            enabled: true,
            field: softDeleteField!.name
          } : undefined,
          includeMerge: false,
          middleware: {},
          validation: {},
          hooks: {}
        },
        createdAt: new Date(),
        isAutoRegistered: true // 자동 등록임을 표시
      };

      const schemaKey = `${databaseName}.${modelName}`;
      this.schemas.set(schemaKey, schemaInfo);

      // console.log(`✅ [${databaseName}] 자동 등록 완료: ${modelName} -> ${basePath}`);
    } catch (error) {
      console.error(`❌ [${databaseName}] 자동 등록 실패: ${modelName}`, error);
    }
  }

  /**
   * 모델명으로부터 기본 베이스 경로를 생성합니다
   */
  private generateBasePath(modelName: string): string {
    // PascalCase를 kebab-case로 변환하고 복수형으로 만들기
    const kebabCase = modelName
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, '');
    
    return this.pluralize(kebabCase);
  }

  /**
   * CRUD 스키마를 등록합니다
   */
  public registerSchema(
    databaseName: string,
    modelName: string,
    basePath: string,
    options: {
      only?: ('index' | 'show' | 'create' | 'update' | 'destroy' | 'recover')[];
      except?: ('index' | 'show' | 'create' | 'update' | 'destroy' | 'recover')[];
      primaryKey?: string;
      primaryKeyParser?: (value: string) => any;
      resourceType?: string;
      includeMerge?: boolean;
      softDelete?: {
        enabled: boolean;
        field: string;
      };
      middleware?: {
        index?: string[];
        show?: string[];
        create?: string[];
        update?: string[];
        destroy?: string[];
        recover?: string[];
      };
      validation?: {
        create?: any;
        update?: any;
        recover?: any;
      };
      hooks?: {
        beforeCreate?: string;
        afterCreate?: string;
        beforeUpdate?: string;
        afterUpdate?: string;
        beforeDestroy?: string;
        afterDestroy?: string;
        beforeRecover?: string;
        afterRecover?: string;
      };
    } = {},
    analyzer: PrismaSchemaAnalyzer
  ): void {
    if (!this.isEnabled) {
      return; // 개발 모드가 아니면 등록하지 않음
    }

    try {
      const modelInfo = analyzer.getModel(modelName);
      if (!modelInfo) {
        console.warn(`모델 '${modelName}'을 ${analyzer.getDatabaseName()} 데이터베이스에서 찾을 수 없습니다. 스키마 등록을 건너뜁니다.`);
        return;
      }

      const primaryKeyField = analyzer.getPrimaryKeyField(modelName);
      const primaryKey = options.primaryKey || primaryKeyField?.name || 'id';
      const primaryKeyType = primaryKeyField?.jsType || 'string';

      // 활성화된 액션들 결정
      const defaultActions = ['index', 'show', 'create', 'update', 'destroy'];
      let enabledActions: string[];

      if (options.only) {
        enabledActions = options.only;
      } else if (options.except) {
        enabledActions = defaultActions.filter(action => !options.except!.includes(action as any));
      } else {
        enabledActions = defaultActions;
      }

      // soft delete가 활성화되어 있으면 recover 액션 추가
      if (options.softDelete?.enabled && !enabledActions.includes('recover')) {
        enabledActions.push('recover');
      }

    //   const endpoints = this.generateEndpoints(basePath, enabledActions, primaryKey);

      const schemaInfo: CrudSchemaInfo = {
        databaseName,
        modelName,
        basePath,
        primaryKey,
        primaryKeyType,
        enabledActions,
        // endpoints,
        model: modelInfo,
        options: {
          softDelete: options.softDelete,
          includeMerge: options.includeMerge,
          middleware: this.convertMiddlewareToStrings(options.middleware),
          validation: options.validation,
          hooks: this.convertHooksToStrings(options.hooks)
        },
        createdAt: new Date()
      };

      const schemaKey = `${databaseName}.${modelName}`;
      this.schemas.set(schemaKey, schemaInfo);

      // console.log(`✅ CRUD 스키마 등록: ${schemaKey} (${enabledActions.length}개 액션)`);
    } catch (error) {
      console.error(`CRUD 스키마 등록 실패 (${databaseName}.${modelName}):`, error);
    }
  }

  /**
   * 등록된 모든 스키마를 반환합니다
   */
  public getAllSchemas(): SchemaApiResponse<AllSchemasResponse> {
    if (!this.isEnabled) {
      throw new Error('스키마 API는 개발 환경에서만 사용할 수 있습니다.');
    }

    const schemas = Array.from(this.schemas.values());
    const models = schemas.map(schema => schema.model);
    const databases = Array.from(new Set(schemas.map(schema => schema.databaseName)));

    // 수동/자동 등록 통계
    const autoRegisteredCount = schemas.filter(s => s.isAutoRegistered).length;
    const manualRegisteredCount = schemas.length - autoRegisteredCount;

    return {
      success: true,
      data: {
        schemas,
        models,
        databases,
        totalSchemas: schemas.length,
        environment: process.env.NODE_ENV || 'unknown',
        registrationStats: {
          autoRegistered: autoRegisteredCount,
          manualRegistered: manualRegisteredCount,
          total: schemas.length
        }
      },
      meta: {
        total: schemas.length,
        timestamp: new Date(),
        environment: process.env.NODE_ENV || 'unknown'
      }
    };
  }

  /**
   * 특정 스키마를 반환합니다
   */
  public getSchema(databaseName: string, modelName: string): SchemaApiResponse<CrudSchemaInfo> {
    if (!this.isEnabled) {
      throw new Error('스키마 API는 개발 환경에서만 사용할 수 있습니다.');
    }

    const schemaKey = `${databaseName}.${modelName}`;
    const schema = this.schemas.get(schemaKey);

    if (!schema) {
      throw new Error(`스키마를 찾을 수 없습니다: ${schemaKey}`);
    }

    return {
      success: true,
      data: schema,
      meta: {
        timestamp: new Date(),
        environment: process.env.NODE_ENV || 'unknown'
      }
    };
  }

  /**
   * 특정 데이터베이스의 스키마들을 반환합니다
   */
  public getSchemasByDatabase(databaseName: string): SchemaApiResponse<CrudSchemaInfo[]> {
    if (!this.isEnabled) {
      throw new Error('스키마 API는 개발 환경에서만 사용할 수 있습니다.');
    }

    const schemas = Array.from(this.schemas.values())
      .filter(schema => schema.databaseName === databaseName);

    return {
      success: true,
      data: schemas,
      meta: {
        total: schemas.length,
        timestamp: new Date(),
        environment: process.env.NODE_ENV || 'unknown'
      }
    };
  }

  /**
   * 스키마가 등록되어 있는지 확인합니다
   */
  public hasSchema(databaseName: string, modelName: string): boolean {
    const schemaKey = `${databaseName}.${modelName}`;
    return this.schemas.has(schemaKey);
  }

  /**
   * 모델이 어떤 데이터베이스에서든 등록되어 있는지 확인합니다
   */
  public hasModelInAnyDatabase(modelName: string): boolean {
    for (const schema of this.schemas.values()) {
      if (schema.modelName === modelName) {
        return true;
      }
    }
    return false;
  }

  /**
   * 등록된 모델 이름들을 반환합니다
   */
  public getRegisteredModelNames(): string[] {
    return Array.from(this.schemas.values()).map(schema => schema.modelName);
  }


  /**
   * 미들웨어 정보를 문자열 배열로 변환합니다
   */
  private convertMiddlewareToStrings(middleware?: any): Record<string, string[]> {
    if (!middleware) return {};

    const result: Record<string, string[]> = {};
    for (const [action, handlers] of Object.entries(middleware)) {
      if (Array.isArray(handlers)) {
        result[action] = handlers.map((handler: any) => 
          typeof handler === 'function' ? handler.name || 'anonymous' : String(handler)
        );
      }
    }
    return result;
  }

  /**
   * 훅 정보를 문자열로 변환합니다
   */
  private convertHooksToStrings(hooks?: any): Record<string, string> {
    if (!hooks) return {};

    const result: Record<string, string> = {};
    for (const [hookName, handler] of Object.entries(hooks)) {
      if (typeof handler === 'function') {
        result[hookName] = handler.name || 'anonymous';
      } else {
        result[hookName] = String(handler);
      }
    }
    return result;
  }

  /**
   * 등록된 스키마 수를 반환합니다
   */
  public getSchemaCount(): number {
    return this.schemas.size;
  }

  /**
   * TypeORM 호환 형식으로 특정 스키마를 반환합니다
   */
  public getTypeOrmCompatibleSchema(databaseName?: string, modelName?: string): any {
    if (!this.isEnabled) {
      throw new Error('스키마 API는 개발 환경에서만 사용할 수 있습니다.');
    }

    // 특정 스키마가 요청된 경우
    if (databaseName && modelName) {
      const schemaKey = `${databaseName}.${modelName}`;
      const schema = this.schemas.get(schemaKey);
      
      if (!schema) {
        throw new Error(`스키마를 찾을 수 없습니다: ${schemaKey}`);
      }

      const entity = this.convertSchemaToTypeOrmEntity(schema);
      
      return {
        data: entity,
        metadata: {
          timestamp: new Date().toISOString(),
          affectedCount: 1
        }
      };
    }

    // 모든 스키마가 요청된 경우 (기존 로직)
    const schemas = Array.from(this.schemas.values());
    
    // 각 스키마의 모델 정보를 TypeORM 형식으로 변환
    const entities = schemas.map(schema => this.convertSchemaToTypeOrmEntity(schema));

    // 데이터베이스별 통계
    const databaseStats = schemas.reduce((stats, schema) => {
      stats[schema.databaseName] = (stats[schema.databaseName] || 0) + 1;
      return stats;
    }, {} as Record<string, number>);

    return {
      data: entities,
      metadata: {
        timestamp: new Date().toISOString(),
        affectedCount: entities.length,
        totalDatabases: Object.keys(databaseStats).length,
        databaseStats,
        databases: Object.keys(databaseStats),
        pagination: {
          type: "offset",
          total: entities.length,
          page: 1,
          pages: 1,
          offset: entities.length,
          nextCursor: Buffer.from(`{"nextCursor":"${Buffer.from(entities.length.toString()).toString('base64')}","total":${entities.length}}`).toString('base64')
        }
      }
    };
  }

  /**
   * CRUD 스키마를 TypeORM 엔티티 형식으로 변환합니다
   */
  private convertSchemaToTypeOrmEntity(schema: CrudSchemaInfo): any {
    const model = schema.model;

    // 상세 로그 제거
    // console.log(`🏗️ [${model.name}] TypeORM 엔티티 변환 시작`);
    // console.log(`   - 필드 수: ${model.fields.length}`);
    // console.log(`   - 관계 수: ${model.relations.length}`);
    // console.log(`   - 관계 목록: ${model.relations.map(r => `${r.name}(${r.type}) -> ${r.model}`).join(', ')}`);

    // 컬럼 변환
    const columns = model.fields
      .filter(field => !field.relationName) // 관계 필드 제외
      .map(field => this.convertFieldToTypeOrmColumn(field));

    // console.log(`   - 변환된 컬럼 수: ${columns.length}`);

    // 관계 변환 - many-to-many 관계를 우선적으로 처리
    const relations = this.convertRelationsToTypeOrmFormat(model.relations, model.name);

    // console.log(`   - 변환된 관계 수: ${relations.length}`);

    // 인덱스 변환
    const indices = model.indexes.map(index => ({
      name: `IDX_${model.name.toUpperCase()}_${index.fields.join('_').toUpperCase()}`,
      columns: index.fields,
      isUnique: index.type === 'unique'
    }));

    // 기본 키 변환
    const primaryKeys = model.primaryKey ? 
      model.primaryKey.fields.map(fieldName => {
        const field = model.fields.find(f => f.name === fieldName);
        return {
          name: fieldName,
          databaseName: fieldName,
          type: this.mapPrismaTypeToTypeOrmType(field?.type || 'String'),
          isGenerated: field?.isGenerated || false,
          generationStrategy: field?.isGenerated ? "increment" : undefined
        };
      }) : [];

    // 고유 제약조건 변환
    const uniques = model.uniqueConstraints.map(constraint => ({
      name: `UQ_${Math.random().toString(36).substr(2, 23)}`, // TypeORM 스타일 고유 이름
      columns: constraint.fields
    }));

    // CRUD 정보 생성
    const crudInfo = this.generateCrudInfo(schema);

    const result = {
      entityName: model.name,
      tableName: model.dbName || model.name.toLowerCase() + 's',
      targetName: model.name,
      databaseName: schema.databaseName, // 데이터베이스 명칭 추가
      primaryKeys,
      columns,
      relations,
      indices,
      checks: [],
      uniques,
      foreignKeys: [], // 관계에서 추출 가능
      synchronize: true,
      withoutRowid: false,
      crudInfo
    };

    // console.log(`✅ [${model.name}] TypeORM 엔티티 변환 완료: ${relations.length}개 관계 포함`);
    return result;
  }

  /**
   * CRUD 정보를 생성합니다
   */
  private generateCrudInfo(schema: CrudSchemaInfo): any {
    const { basePath, enabledActions, model, options, isAutoRegistered } = schema;
    
    // 자동 등록된 모델인 경우 기본 구조만 제공
    if (isAutoRegistered) {
      return {
        isConfigured: false, // 실제 CRUD 설정이 되지 않았음을 표시
        controllerPath: basePath,
        entityName: model.name,
        allowedMethods: [], // 실제 사용 가능한 메서드 없음
        allowedFilters: [], // 필터 사용 불가
        allowedParams: [], // 파라미터 사용 불가
        allowedIncludes: [], // 관계 포함 사용 불가
        routeSettings: {
          note: 'This model is auto-registered but not configured for CRUD operations',
          autoRegistered: true
        },
        availableEndpoints: [], // 실제 사용 가능한 엔드포인트 없음
        schemaStructure: {
          // 하지만 스키마 구조는 제공
          fields: model.fields.map(field => ({
            name: field.name,
            type: field.type,
            jsType: field.jsType,
            isOptional: field.isOptional,
            isId: field.isId,
            isUnique: field.isUnique
          })),
          relations: model.relations.map(relation => ({
            name: relation.name,
            type: relation.type,
            model: relation.model
          }))
        }
      };
    }
    
    // 수동 등록된 모델인 경우 기존 로직 사용
    
    // 허용된 메서드 생성
    const allowedMethods = enabledActions.map(action => {
      switch (action) {
        case 'index': return 'index';
        case 'show': return 'show';
        case 'create': return 'create';
        case 'update': return 'update';
        case 'destroy': return 'delete';
        case 'recover': return 'recover';
        default: return action;
      }
    });

    // 사용 가능한 엔드포인트 생성
    const availableEndpoints: string[] = [];
    enabledActions.forEach(action => {
      switch (action) {
        case 'index':
          availableEndpoints.push(`GET /${basePath}`);
          break;
        case 'show':
          availableEndpoints.push(`GET /${basePath}/:${schema.primaryKey}`);
          break;
        case 'create':
          availableEndpoints.push(`POST /${basePath}`);
          break;
        case 'update':
          availableEndpoints.push(`PUT /${basePath}/:${schema.primaryKey}`);
          availableEndpoints.push(`PATCH /${basePath}/:${schema.primaryKey}`);
          break;
        case 'destroy':
          availableEndpoints.push(`DELETE /${basePath}/:${schema.primaryKey}`);
          break;
        case 'recover':
          if (options.softDelete?.enabled) {
            availableEndpoints.push(`POST /${basePath}/:${schema.primaryKey}/recover`);
          }
          break;
      }
    });

    // 허용된 필터 (예시: 문자열 필드들)
    const allowedFilters = model.fields
      .filter(field => 
        field.jsType === 'string' && 
        !field.relationName && 
        !field.isId
      )
      .slice(0, 5) // 최대 5개만
      .map(field => field.name);

    // 허용된 파라미터 (예시: 선택적 필드들)
    const allowedParams = model.fields
      .filter(field => 
        field.isOptional && 
        !field.relationName && 
        !field.isId &&
        field.jsType === 'string'
      )
      .slice(0, 3) // 최대 3개만
      .map(field => field.name);

    // 허용된 포함 관계 (예시: 관계 필드들)
    const allowedIncludes = model.relations
      .slice(0, 5) // 최대 5개만
      .map(relation => relation.name);

    return {
      isConfigured: true,
      controllerPath: basePath,
      entityName: model.name,
      allowedMethods,
      allowedFilters,
      allowedParams,
      allowedIncludes,
      routeSettings: {
        softDelete: options.softDelete,
        includeMerge: options.includeMerge,
        middleware: options.middleware,
        validation: options.validation,
        hooks: options.hooks
      },
      availableEndpoints
    };
  }

  /**
   * Prisma 필드를 TypeORM 컬럼 형식으로 변환합니다
   */
  private convertFieldToTypeOrmColumn(field: any): any {
    const typeOrmType = this.mapPrismaTypeToTypeOrmType(field.type);
    const jsType = field.jsType;
    const fieldLength = this.getFieldLength(field.type, field.name);

    const column: any = {
      name: field.name,
      databaseName: field.name,
      type: typeOrmType,
      jsType: jsType,
      isPrimary: field.isId,
      isGenerated: field.isGenerated,
      generationStrategy: field.isGenerated ? "increment" : undefined,
      isNullable: field.isOptional,
      isArray: field.isList,
      length: fieldLength,
      zerofill: false,
      unsigned: false,
      metadata: {
        type: typeOrmType,
        jsType: jsType,
        isEnum: this.isEnumType(field.type),
        enumValues: this.getEnumValues(field.type),
        isNullable: field.isOptional,
        isPrimary: field.isId,
        isGenerated: field.isGenerated,
        length: fieldLength,
        default: field.default
      }
    };

    // 기본값이 있는 경우 추가
    if (field.default !== undefined) {
      column.default = field.default;
      column.metadata.default = field.default;
    }

    // Enum 타입인 경우 enum 값들 추가
    if (this.isEnumType(field.type)) {
      column.enum = this.getEnumValues(field.type);
    }

    return column;
  }

  /**
   * 관계들을 TypeORM 형식으로 변환하며, many-to-many 관계를 특별히 처리합니다
   */
  private convertRelationsToTypeOrmFormat(relations: any[], modelName: string): any[] {
    // console.log(`🔍 [${modelName}] 관계 변환 시작: ${relations.length}개 관계 발견`);
    
    const convertedRelations: any[] = [];

    for (const relation of relations) {
      // console.log(`🔄 [${modelName}] 관계 처리 중: ${relation.name} -> ${relation.model} (타입: ${relation.type})`);
      
      // 우선 모든 관계를 변환해보자 (CRUD 등록 여부와 상관없이)
      
      // many-to-many 관계인지 확인
      if (this.relationshipManager.isManyToManyRelation(relation, modelName)) {
        // console.log(`🎯 [${modelName}] Many-to-Many 관계 감지: ${relation.name} -> ${relation.model}`);
        
        const manyToManyConfig = this.relationshipManager.getManyToManyConfig(relation, modelName);
        if (manyToManyConfig) {
          // console.log(`✅ [${modelName}] Many-to-Many 설정 적용: ${JSON.stringify(manyToManyConfig)}`);
          
          convertedRelations.push({
            name: manyToManyConfig.relationName,
            type: 'many-to-many',
            target: manyToManyConfig.targetModel,
            inverseSide: manyToManyConfig.inverseSide,
            isOwner: true,
            isLazy: false,
            isCascade: {
              insert: false,
              update: false,
              remove: false,
              softRemove: false,
              recover: false
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
            nullable: true,
            joinColumns: [
              {
                name: manyToManyConfig.sourceColumn,
                referencedColumnName: 'id'
              }
            ],
            joinTable: manyToManyConfig.joinTable
          });
        } else {
          console.log(`❌ [${modelName}] Many-to-Many 설정 실패: ${relation.name} -> ${relation.model}`);
        }
      } 
      // 일반 관계들 처리
      else {
        // 중간 테이블과의 직접 관계가 아닌 경우에만 포함
        if (!this.relationshipManager.isIntermediateTableRelation(relation, modelName)) {
          console.log(`🔗 [${modelName}] 일반 관계 처리: ${relation.name} -> ${relation.model}`);
          
          const convertedRelation = this.convertRelationToTypeOrmRelation(relation, modelName);
          if (convertedRelation) {
            convertedRelations.push(convertedRelation);
            console.log(`✅ [${modelName}] 일반 관계 추가됨: ${relation.name}`);
          } else {
            console.log(`❌ [${modelName}] 일반 관계 변환 실패: ${relation.name}`);
          }
        } else {
          console.log(`🚫 [${modelName}] 중간 테이블 관계 숨김: ${relation.name} -> ${relation.model}`);
        }
      }
    }

    // console.log(`✅ [${modelName}] 관계 변환 완료: ${convertedRelations.length}개 관계 변환됨`);
    return convertedRelations;
  }

  /**
   * 중간 테이블과의 관계인지 확인합니다 (동적 패턴 사용)
   */
  private isIntermediateTableRelation(relation: any, modelName: string): boolean {
    return this.relationshipManager.isIntermediateTableRelation(relation, modelName);
  }

  /**
   * Prisma 관계를 TypeORM 관계 형식으로 변환합니다
   */
  private convertRelationToTypeOrmRelation(relation: any, sourceModel?: string): any {
    const isManyToMany = sourceModel ? 
      this.relationshipManager.isManyToManyRelation(relation, sourceModel) : 
      false;
    
    // 관계 타입을 TypeORM 스타일로 변환
    let typeOrmRelationType = relation.type;
    if (isManyToMany) {
      typeOrmRelationType = 'many-to-many';
    }

    // 관계가 외래 키를 소유하는지 확인 (relationFromFields가 있는 경우)
    const isOwner = relation.fields && relation.fields.length > 0;

    // many-to-many 관계인 경우 설정 사용
    let joinTable = null;
    let joinColumns: any[] = [];
    
    if (isManyToMany && sourceModel) {
      const config = this.relationshipManager.getManyToManyConfig(relation, sourceModel);
      if (config) {
        joinTable = config.joinTable;
        joinColumns = [
          {
            name: config.sourceColumn,
            referencedColumnName: 'id'
          }
        ];
      }
    } else {
      // one-to-many, many-to-one 관계인 경우 기존 로직
      joinColumns = isOwner && relation.fields ? 
        relation.fields.map((field: string, index: number) => ({
          name: field,
          referencedColumnName: relation.references?.[index] || 'id'
        })) : [];
    }

    // 타겟 모델 결정 - CRUD 등록 여부와 상관없이 모든 관계 허용
    const targetModel = sourceModel ? 
      this.relationshipManager.getActualTargetModel(relation, sourceModel) : 
      relation.model;

    // 역방향 관계 이름 생성
    const inverseSide = sourceModel ? 
      this.relationshipManager.generateInverseSideName(relation, sourceModel) : 
      relation.name;

    return {
      name: relation.name,
      type: typeOrmRelationType,
      target: targetModel,
      inverseSide: inverseSide,
      isOwner: isManyToMany ? true : isOwner, // many-to-many에서는 일반적으로 owner
      isLazy: false,
      isCascade: {
        insert: false,
        update: false,
        remove: false,
        softRemove: false,
        recover: false
      },
      onDelete: relation.onDelete || 'CASCADE',
      onUpdate: relation.onUpdate || 'CASCADE',
      nullable: isManyToMany ? true : !isOwner, // many-to-many는 nullable
      joinColumns: joinColumns,
      joinTable: joinTable
    };
  }

  /**
   * Prisma 타입을 TypeORM 타입으로 매핑합니다
   */
  private mapPrismaTypeToTypeOrmType(prismaType: string): any {
    const typeMapping: Record<string, any> = {
      'String': 'varchar',
      'Int': 'int',
      'BigInt': 'bigint', 
      'Float': 'float',
      'Decimal': 'decimal',
      'Boolean': 'boolean',
      'DateTime': 'timestamp',
      'Json': 'json',
      'Bytes': 'blob'
    };

    // Enum 타입인지 확인
    if (this.isEnumType(prismaType)) {
      return 'enum';
    }

    return typeMapping[prismaType] || 'varchar';
  }

  /**
   * 필드 길이를 반환합니다
   */
  private getFieldLength(type: string, fieldName?: string): string {
    // 기본 타입별 길이
    const lengthMapping: Record<string, string> = {
      'String': '255',
      'Int': '',
      'BigInt': '',
      'Float': '',
      'Decimal': '',
      'Boolean': '',
      'DateTime': '',
      'Json': '',
      'Bytes': ''
    };

    // 특정 필드명에 따른 길이 오버라이드
    if (fieldName) {
      const fieldLengthMapping: Record<string, string> = {
        'name': '100',
        'email': '200',
        'password': '255',
        'title': '200',
        'description': '1000',
        'content': '2000',
        'url': '500',
        'phone': '20',
        'address': '300'
      };
      
      if (fieldLengthMapping[fieldName]) {
        return fieldLengthMapping[fieldName];
      }
    }

    return lengthMapping[type] || '';
  }

  /**
   * Enum 타입인지 확인합니다
   */
  private isEnumType(type: string): boolean {
    // Prisma에서 Enum은 보통 대문자로 시작하고 내장 타입이 아닙니다
    const builtInTypes = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes'];
    return !builtInTypes.includes(type) && type.charAt(0).toUpperCase() === type.charAt(0);
  }

  /**
   * Enum 값들을 반환합니다 (실제로는 Prisma 스키마에서 추출해야 함)
   */
  private getEnumValues(type: string): string[] | undefined {
    // 실제 구현에서는 Prisma DMMF의 enum 정보를 사용해야 합니다
    // 지금은 예시 값들을 반환합니다
    const enumMapping: Record<string, string[]> = {
      'Provider': ['local', 'google', 'apple', 'kakao', 'naver'],
      'Category': ['user', 'admin', 'content', 'system', 'analytics'],
      'Action': ['create', 'read', 'update', 'delete', 'manage']
    };

    return enumMapping[type];
  }

  /**
   * 관계에서 소스 모델을 추출합니다
   */
  private getSourceModelFromRelation(relation: any): string {
    // many-to-many 관계에서 실제 소스 모델 추정
    if (relation.name === 'roles' && relation.model === 'UserRole') {
      return 'User';
    }
    if (relation.name === 'permissions' && relation.model === 'UserPermission') {
      return 'User';
    }
    if (relation.name === 'rolePermissions' && relation.model === 'RolePermission') {
      return 'Role';
    }
    
    // 기본적으로 관계 이름에서 추정
    return relation.name.charAt(0).toUpperCase() + relation.name.slice(1);
  }

  /**
   * 관계에서 타겟 모델을 추출합니다
   */
  private getTargetModelFromRelation(relation: any): string {
    // many-to-many 관계에서 실제 타겟 모델 추정
    if (relation.name === 'roles' && relation.model === 'UserRole') {
      return 'Role';
    }
    if (relation.name === 'permissions' && relation.model === 'UserPermission') {
      return 'Permission';
    }
    if (relation.name === 'userRoles' && relation.model === 'UserRole') {
      return 'User';
    }
    
    // 기본적으로 중간 테이블에서 타겟 추정
    const intermediateModel = relation.model;
    
    // UserRole -> Role, UserPermission -> Permission 등
    if (intermediateModel.startsWith('User')) {
      return intermediateModel.replace('User', '');
    }
    if (intermediateModel.startsWith('Role')) {
      return intermediateModel.replace('Role', '');
    }
    
    return relation.model;
  }

  /**
   * Many-to-many 관계인지 확인합니다
   */
  private isManyToManyRelation(relation: any): boolean {
    const modelName = relation.model;
    const relationName = relation.name;
    
    // 특정 관계 이름과 타겟 모델 조합을 정의
    const specificManyToManyPatterns = [
      // User와 Role 간의 관계 (UserRole 중간 테이블)
      { relation: 'roles', target: 'UserRole', isManyToMany: true },
      { relation: 'userRoles', target: 'UserRole', isManyToMany: false }, // 실제 중간 테이블 관계
      
      // 권한 관련
      { relation: 'permissions', target: 'UserPermission', isManyToMany: true },
      { relation: 'rolePermissions', target: 'RolePermission', isManyToMany: false },
    ];

    // 특정 관계 이름과 타겟 모델 조합 확인
    const specificPattern = specificManyToManyPatterns.find(pattern => 
      pattern.relation === relationName && pattern.target === modelName
    );
    
    if (specificPattern) {
      return specificPattern.isManyToMany;
    }

    // 관계가 이미 many-to-many로 정의된 경우
    if (relation.type === 'many-to-many') {
      return true;
    }

    // 일반적인 many-to-many 중간 테이블 패턴들
    const regexPatterns = [
      /^User.*Role.*$/,     // UserRole, UserRoleMapping 등
      /^.*Permission.*$/,   // 권한 관련 중간 테이블
      /^.*Mapping$/,        // ~Mapping으로 끝나는 테이블
      /^.*Bridge$/,         // ~Bridge로 끝나는 테이블
      /^.*Link$/           // ~Link로 끝나는 테이블
    ];

    // 중간 테이블 패턴에 매치되는지 확인
    return regexPatterns.some(pattern => pattern.test(modelName));
  }

  /**
   * 관계의 역방향 이름을 추정합니다
   */
  private getInverseSideName(relation: any): string {
    const relationName = relation.name;
    const targetModel = relation.model;
    
    // many-to-many 관계인 경우 특별 처리
    if (this.isManyToManyRelation(relation)) {
      // User의 roles -> Role의 users
      if (relationName === 'roles' && targetModel === 'UserRole') {
        return 'users';
      }
      // User의 permissions -> Permission의 users  
      if (relationName === 'permissions' && targetModel === 'UserPermission') {
        return 'users';
      }
      // Role의 users -> User의 roles
      if (relationName === 'users' && targetModel === 'UserRole') {
        return 'roles';
      }
      
      // 기본적으로 소스 모델의 복수형
      const sourceModel = this.getSourceModelFromRelation(relation);
      return this.pluralize(sourceModel.toLowerCase());
    }
    
    // one-to-many 관계인 경우
    if (relation.type === 'one-to-many') {
      // UserSession[] -> User 모델에서는 sessions, UserSession에서는 user
      const targetModelName = targetModel.toLowerCase();
      if (targetModelName.startsWith('user')) {
        return 'user';
      }
      return this.singularize(relationName);
    }
    
    // many-to-one 관계인 경우
    if (relation.type === 'many-to-one') {
      return this.pluralize(relationName);
    }
    
    // one-to-one 관계인 경우
    return relationName;
  }

  /**
   * 단어를 복수형으로 변환합니다 (간단한 구현)
   */
  private pluralize(word: string): string {
    if (word.endsWith('s') || word.endsWith('x') || word.endsWith('ch') || word.endsWith('sh')) {
      return word + 'es';
    }
    if (word.endsWith('y')) {
      return word.slice(0, -1) + 'ies';
    }
    return word + 's';
  }

  /**
   * 단어를 단수형으로 변환합니다 (간단한 구현)
   */
  private singularize(word: string): string {
    if (word.endsWith('ies')) {
      return word.slice(0, -3) + 'y';
    }
    if (word.endsWith('es')) {
      return word.slice(0, -2);
    }
    if (word.endsWith('s') && !word.endsWith('ss')) {
      return word.slice(0, -1);
    }
    return word;
  }

  /**
   * 모든 스키마를 삭제합니다 (테스트용)
   */
  public clearAllSchemas(): void {
    this.schemas.clear();
    console.log('모든 CRUD 스키마가 삭제되었습니다.');
  }

  /**
   * 디버깅용: 등록된 스키마 정보를 출력합니다
   */
  public debugRegisteredSchemas(): void {
    if (!this.isEnabled) {
      console.log('🚫 스키마 API가 비활성화되어 있습니다.');
      return;
    }

    const schemas = Array.from(this.schemas.values());
    const autoRegistered = schemas.filter(s => s.isAutoRegistered);
    const manualRegistered = schemas.filter(s => !s.isAutoRegistered);

    console.log('🔍 등록된 CRUD 스키마 목록:');
    console.log(`   총 스키마 수: ${this.schemas.size}개`);
    console.log(`   📝 수동 등록: ${manualRegistered.length}개`);
    console.log(`   🤖 자동 등록: ${autoRegistered.length}개`);
    
    if (manualRegistered.length > 0) {
      console.log('\n📝 수동 등록된 모델들 (CRUD 기능 활성화):');
      for (const schema of manualRegistered) {
        const key = `${schema.databaseName}.${schema.modelName}`;
        console.log(`   ✅ ${key}: ${schema.basePath} (${schema.enabledActions.join(', ')})`);
      }
    }

    if (autoRegistered.length > 0) {
      console.log('\n🤖 자동 등록된 모델들 (스키마 구조만 제공):');
      for (const schema of autoRegistered) {
        const key = `${schema.databaseName}.${schema.modelName}`;
        console.log(`   📋 ${key}: ${schema.basePath} (구조만, CRUD 미활성화)`);
      }
    }

    const registeredModels = this.getRegisteredModelNames();
    console.log(`\n� 등록된 모든 모델들: ${registeredModels.join(', ')}`);
  }

  /**
   * 자동 등록된 모델들만 반환합니다
   */
  public getAutoRegisteredSchemas(): SchemaApiResponse<CrudSchemaInfo[]> {
    if (!this.isEnabled) {
      throw new Error('스키마 API는 개발 환경에서만 사용할 수 있습니다.');
    }

    const autoRegisteredSchemas = Array.from(this.schemas.values())
      .filter(schema => schema.isAutoRegistered);

    return {
      success: true,
      data: autoRegisteredSchemas,
      meta: {
        total: autoRegisteredSchemas.length,
        timestamp: new Date(),
        environment: process.env.NODE_ENV || 'unknown'
      }
    };
  }

  /**
   * 수동 등록된 모델들만 반환합니다
   */
  public getManualRegisteredSchemas(): SchemaApiResponse<CrudSchemaInfo[]> {
    if (!this.isEnabled) {
      throw new Error('스키마 API는 개발 환경에서만 사용할 수 있습니다.');
    }

    const manualRegisteredSchemas = Array.from(this.schemas.values())
      .filter(schema => !schema.isAutoRegistered);

    return {
      success: true,
      data: manualRegisteredSchemas,
      meta: {
        total: manualRegisteredSchemas.length,
        timestamp: new Date(),
        environment: process.env.NODE_ENV || 'unknown'
      }
    };
  }

  /**
   * 관계 설정 관리자에 액세스할 수 있도록 노출합니다 (고급 사용자용)
   */
  public getRelationshipManager(): RelationshipConfigManager {
    return this.relationshipManager;
  }
}
