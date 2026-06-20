import {
  CrudSchemaInfo,
  SchemaApiResponse,
  AllSchemasResponse,
  CRUD_ACTIONS
} from './crudSchemaTypes';
import { PrismaSchemaAnalyzer } from './prismaSchemaAnalyzer';
import { RelationshipConfigManager } from './relationshipConfig';
import { pluralize, createPaginationCursor } from '@ext/util';
import { log } from '@ext/winston';

/**
 * CRUD 스키마 정보를 등록하고 관리하는 레지스트리
 * 개발 모드에서만 사용됩니다.
 */
export class CrudSchemaRegistry {
  private static instance: CrudSchemaRegistry;
  private schemas: Map<string, CrudSchemaInfo> = new Map();
  private isEnabled: boolean = false;
  private relationshipManager: RelationshipConfigManager;
  private analyzers: Map<string, PrismaSchemaAnalyzer> = new Map();

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

    if (this.isEnabled) {
      log.Info('CRUD Schema API enabled', { nodeEnv, enableSchemaApi });
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

    // analyzer 캐시 (enum 조회용)
    if (!this.analyzers.has(dbName)) {
      this.analyzers.set(dbName, analyzer);
    }

    // 간단한 로그만 출력
    for (const model of allModels) {
      const modelName = model.name;
      const schemaKey = `${dbName}.${modelName}`;

      // 이미 등록된 모델은 건너뛰기
      if (this.schemas.has(schemaKey)) {
        continue;
      }

      // 모델을 기본 설정으로 자동 등록
      this.autoRegisterModel(dbName, modelName, analyzer);
    }
  }

  /**
   * 개별 모델을 기본 설정으로 자동 등록합니다
   */
  private autoRegisterModel(databaseName: string, modelName: string, analyzer: PrismaSchemaAnalyzer): void {
    try {
      const modelInfo = analyzer.getModel(modelName);
      if (!modelInfo) {
        log.Warn(`Model not found: ${modelName}`, { databaseName });
        return;
      }

      const primaryKeyField = analyzer.getPrimaryKeyField(modelName);
      const primaryKey = primaryKeyField?.name || 'id';
      const primaryKeyType = primaryKeyField?.jsType || 'string';

      // 기본 경로 생성 (모델명을 소문자 복수형으로)
      const basePath = this.generateBasePath(modelName);

      // 기본 액션들 (CRUD 미사용 모델도 구조는 제공)
      const enabledActions = [...CRUD_ACTIONS];

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
    } catch (error) {
      log.Error(`Auto-register failed: ${modelName}`, { databaseName, error });
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
    
    return pluralize(kebabCase);
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
        log.Warn(`Model '${modelName}' not found in ${analyzer.getDatabaseName()}, skipping schema registration`);
        return;
      }

      const primaryKeyField = analyzer.getPrimaryKeyField(modelName);
      const primaryKey = options.primaryKey || primaryKeyField?.name || 'id';
      const primaryKeyType = primaryKeyField?.jsType || 'string';

      // 활성화된 액션들 결정
      const defaultActions = [...CRUD_ACTIONS];
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

      // analyzer 캐시 (enum 조회용)
      if (!this.analyzers.has(databaseName)) {
        this.analyzers.set(databaseName, analyzer);
      }
    } catch (error) {
      log.Error(`CRUD schema registration failed: ${databaseName}.${modelName}`, { error });
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
          nextCursor: createPaginationCursor(entities.length)
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

    // 컬럼 변환
    const columns = model.fields
      .filter(field => !field.relationName) // 관계 필드 제외
      .map(field => this.convertFieldToTypeOrmColumn(field, schema.databaseName));

    // 관계 변환 - many-to-many 관계를 우선적으로 처리
    const relations = this.convertRelationsToTypeOrmFormat(model.relations, model.name);

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
      name: `UQ_${model.name.toUpperCase()}_${constraint.fields.join('_').toUpperCase()}`,
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
  private convertFieldToTypeOrmColumn(field: any, databaseName?: string): any {
    const typeOrmType = this.mapPrismaTypeToTypeOrmType(field.type);
    const jsType = field.jsType;
    const fieldLength = this.getFieldLength(field.type, field.name);
    const isEnum = this.isEnumType(field.type);
    const enumValues = isEnum ? this.getEnumValues(field.type, databaseName) : undefined;

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
        isEnum,
        enumValues,
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
    if (isEnum) {
      column.enum = enumValues;
    }

    return column;
  }

  /**
   * 관계들을 TypeORM 형식으로 변환하며, many-to-many 관계를 특별히 처리합니다
   */
  private convertRelationsToTypeOrmFormat(relations: any[], modelName: string): any[] {
    const convertedRelations: any[] = [];

    for (const relation of relations) {
      // 우선 모든 관계를 변환해보자 (CRUD 등록 여부와 상관없이)
      
      // many-to-many 관계인지 확인
      if (this.relationshipManager.isManyToManyRelation(relation, modelName)) {
        const manyToManyConfig = this.relationshipManager.getManyToManyConfig(relation, modelName);
        if (manyToManyConfig) {
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
          log.Warn(`Many-to-Many config failed: ${modelName}.${relation.name} -> ${relation.model}`);
        }
      } 
      // 일반 관계들 처리
      else {
        // 중간 테이블과의 직접 관계가 아닌 경우에만 포함
        if (!this.relationshipManager.isIntermediateTableRelation(relation, modelName)) {
          const convertedRelation = this.convertRelationToTypeOrmRelation(relation, modelName);
          if (convertedRelation) {
            convertedRelations.push(convertedRelation);
          }
        }
      }
    }

    return convertedRelations;
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
   * Enum 타입인지 확인합니다 (PrismaSchemaAnalyzer에 위임)
   */
  private isEnumType(type: string): boolean {
    for (const analyzer of this.analyzers.values()) {
      if (analyzer.isEnumType(type)) return true;
    }
    if (this.analyzers.size > 0) return false;
    // analyzer가 없는 경우 fallback
    const builtInTypes = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes', 'BigInt', 'Decimal'];
    return !builtInTypes.includes(type) && type.charAt(0).toUpperCase() === type.charAt(0);
  }

  /**
   * Enum 값들을 반환합니다 (PrismaSchemaAnalyzer에서 로드된 DMMF 데이터 사용)
   */
  private getEnumValues(type: string, databaseName?: string): string[] | undefined {
    // 저장된 analyzer에서 실제 enum 값 조회
    if (databaseName && this.analyzers.has(databaseName)) {
      return this.analyzers.get(databaseName)!.getEnumValues(type);
    }
    // databaseName이 없으면 모든 analyzer를 순회하여 찾기
    for (const analyzer of this.analyzers.values()) {
      const values = analyzer.getEnumValues(type);
      if (values) return values;
    }
    return undefined;
  }

  /**
   * 모든 스키마를 삭제합니다 (테스트용)
   */
  public clearAllSchemas(): void {
    this.schemas.clear();
    log.Debug('All CRUD schemas cleared');
  }

  /**
   * 디버깅용: 등록된 스키마 정보를 출력합니다
   */
  public debugRegisteredSchemas(): void {
    if (!this.isEnabled) {
      log.Debug('Schema API is disabled');
      return;
    }

    const schemas = Array.from(this.schemas.values());
    const autoRegistered = schemas.filter(s => s.isAutoRegistered);
    const manualRegistered = schemas.filter(s => !s.isAutoRegistered);

    log.Debug('Registered CRUD schemas', {
      total: this.schemas.size,
      manual: manualRegistered.map(s => `${s.databaseName}.${s.modelName}`),
      auto: autoRegistered.map(s => `${s.databaseName}.${s.modelName}`)
    });
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
