import { 
  CrudSchemaInfo, 
  CrudEndpointInfo, 
  PrismaModelInfo,
  SchemaApiResponse,
  AllSchemasResponse
} from './crudSchemaTypes';
import { PrismaSchemaAnalyzer } from './prismaSchemaAnalyzer';

/**
 * CRUD 스키마 정보를 등록하고 관리하는 레지스트리
 * 개발 모드에서만 사용됩니다.
 */
export class CrudSchemaRegistry {
  private static instance: CrudSchemaRegistry;
  private schemas: Map<string, CrudSchemaInfo> = new Map();
  private isEnabled: boolean = false;

  private constructor() {
    this.checkEnvironment();
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

      const endpoints = this.generateEndpoints(basePath, enabledActions, primaryKey);

      const schemaInfo: CrudSchemaInfo = {
        databaseName,
        modelName,
        basePath,
        primaryKey,
        primaryKeyType,
        enabledActions,
        endpoints,
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

      console.log(`✅ CRUD 스키마 등록: ${schemaKey} (${enabledActions.length}개 액션)`);
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

    return {
      success: true,
      data: {
        schemas,
        models,
        databases,
        totalSchemas: schemas.length,
        environment: process.env.NODE_ENV || 'unknown'
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
   * 엔드포인트 정보를 생성합니다
   */
  private generateEndpoints(basePath: string, actions: string[], primaryKey: string): CrudEndpointInfo[] {
    const endpoints: CrudEndpointInfo[] = [];

    const endpointMap = {
      index: {
        method: 'GET' as const,
        path: basePath,
        description: '리스트 조회 (필터링, 정렬, 페이징 지원)'
      },
      show: {
        method: 'GET' as const,
        path: `${basePath}/:${primaryKey}`,
        description: '단일 레코드 조회'
      },
      create: {
        method: 'POST' as const,
        path: basePath,
        description: '새 레코드 생성'
      },
      update: {
        method: 'PUT' as const,
        path: `${basePath}/:${primaryKey}`,
        description: '레코드 전체 업데이트'
      },
      destroy: {
        method: 'DELETE' as const,
        path: `${basePath}/:${primaryKey}`,
        description: '레코드 삭제'
      },
      recover: {
        method: 'POST' as const,
        path: `${basePath}/:${primaryKey}/recover`,
        description: '소프트 삭제된 레코드 복구'
      }
    };

    for (const action of actions) {
      const template = endpointMap[action as keyof typeof endpointMap];
      if (template) {
        endpoints.push({
          ...template,
          action: action as any
        });
      }
    }

    return endpoints;
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
   * TypeORM 호환 형식으로 모든 스키마를 반환합니다
   */
  public getTypeOrmCompatibleSchema(): any {
    if (!this.isEnabled) {
      throw new Error('스키마 API는 개발 환경에서만 사용할 수 있습니다.');
    }

    const schemas = Array.from(this.schemas.values());
    
    // 각 스키마의 모델 정보를 TypeORM 형식으로 변환
    const entities = schemas.map(schema => this.convertSchemaToTypeOrmEntity(schema));

    return {
      data: entities,
      metadata: {
        timestamp: new Date().toISOString(),
        affectedCount: entities.length,
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

    // 컬럼 변환
    const columns = model.fields
      .filter(field => !field.relationName) // 관계 필드 제외
      .map(field => this.convertFieldToTypeOrmColumn(field));

    // 관계 변환
    const relations = model.relations.map(relation => this.convertRelationToTypeOrmRelation(relation));

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

    return {
      entityName: model.name,
      tableName: model.dbName || model.name.toLowerCase() + 's',
      targetName: model.name,
      primaryKeys,
      columns,
      relations,
      indices,
      checks: [],
      uniques,
      foreignKeys: [], // 관계에서 추출 가능
      synchronize: true,
      withoutRowid: false
    };
  }

  /**
   * Prisma 필드를 TypeORM 컬럼 형식으로 변환합니다
   */
  private convertFieldToTypeOrmColumn(field: any): any {
    const typeOrmType = this.mapPrismaTypeToTypeOrmType(field.type);
    const jsType = field.jsType;

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
      length: this.getFieldLength(field.type),
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
        length: this.getFieldLength(field.type),
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
   * Prisma 관계를 TypeORM 관계 형식으로 변환합니다
   */
  private convertRelationToTypeOrmRelation(relation: any): any {
    return {
      name: relation.name,
      type: relation.type,
      target: relation.model,
      inverseSide: this.getInverseSideName(relation),
      isOwner: relation.fields && relation.fields.length > 0,
      isLazy: false,
      isCascade: {
        insert: false,
        update: false,
        remove: false,
        softRemove: false,
        recover: false
      },
      onDelete: relation.onDelete,
      onUpdate: relation.onUpdate,
      nullable: true,
      joinColumns: relation.fields ? relation.fields.map((field: string) => ({
        name: field,
        referencedColumnName: relation.references?.[0] || 'id'
      })) : [],
      joinTable: relation.type === 'many-to-many' ? `${relation.name}_${relation.model.toLowerCase()}` : null
    };
  }

  /**
   * Prisma 타입을 TypeORM 타입으로 매핑합니다
   */
  private mapPrismaTypeToTypeOrmType(prismaType: string): any {
    const typeMapping: Record<string, any> = {
      'String': 'varchar',
      'Int': 0,
      'Float': 'float',
      'Boolean': 'boolean',
      'DateTime': 'timestamp',
      'Json': 'json',
      'Bytes': 'blob'
    };

    return typeMapping[prismaType] || 'varchar';
  }

  /**
   * 필드 길이를 반환합니다
   */
  private getFieldLength(type: string): string {
    const lengthMapping: Record<string, string> = {
      'String': '255',
      'Int': '',
      'Float': '',
      'Boolean': '',
      'DateTime': '',
      'Json': '',
      'Bytes': ''
    };

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
   * 관계의 역방향 이름을 추정합니다
   */
  private getInverseSideName(relation: any): string {
    // 간단한 추정 로직 - 실제로는 더 정교해야 합니다
    if (relation.type === 'many-to-many') {
      return relation.name;
    }
    return relation.name + 's';
  }

  /**
   * 모든 스키마를 삭제합니다 (테스트용)
   */
  public clearAllSchemas(): void {
    this.schemas.clear();
    console.log('모든 CRUD 스키마가 삭제되었습니다.');
  }
}
