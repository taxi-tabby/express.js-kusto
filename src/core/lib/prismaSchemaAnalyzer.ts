import { log } from '@ext/winston';
import {
  PrismaModelInfo,
  PrismaFieldMetadata,
  PrismaRelationInfo,
  PrismaIndexInfo,
  PRISMA_TYPE_MAPPING
} from './crudSchemaTypes';

// Prisma 7: PrismaClient는 생성된 클라이언트에서 가져오므로 any 타입 사용
type PrismaClientAny = any;

/**
 * Prisma 클라이언트를 분석하여 스키마 정보를 추출하는 서비스
 * 개발 모드에서만 사용됩니다.
 */
export class PrismaSchemaAnalyzer {
  private static instances: Map<string, PrismaSchemaAnalyzer> = new Map();
  private prismaClient: PrismaClientAny;
  private modelCache: Map<string, PrismaModelInfo> = new Map();
  private databaseName: string;
  private loadedEnums: Record<string, any> = {};

  constructor(prismaClient: PrismaClientAny, databaseName: string = 'unknown') {
    this.prismaClient = prismaClient;
    this.databaseName = databaseName;
  }

  public static getInstance(prismaClient: PrismaClientAny, databaseName: string = 'default'): PrismaSchemaAnalyzer {
    if (!PrismaSchemaAnalyzer.instances.has(databaseName)) {
      PrismaSchemaAnalyzer.instances.set(databaseName, new PrismaSchemaAnalyzer(prismaClient, databaseName));
    }
    return PrismaSchemaAnalyzer.instances.get(databaseName)!;
  }

  /**
   * 분석기가 사용하고 있는 데이터베이스 이름을 반환합니다
   */
  public getDatabaseName(): string {
    return this.databaseName;
  }

  /**
   * 모든 Prisma 모델 정보를 반환합니다
   */
  public getAllModels(): PrismaModelInfo[] {
    if (this.modelCache.size === 0) {
      this.loadModelsFromDMMF();
    }
    return Array.from(this.modelCache.values());
  }

  /**
   * 특정 모델의 정보를 반환합니다 (대소문자 무시)
   */
  public getModel(modelName: string): PrismaModelInfo | null {
    if (this.modelCache.size === 0) {
      this.loadModelsFromDMMF();
    }
    
    // 정확한 이름으로 먼저 찾아봄
    let model = this.modelCache.get(modelName);
    if (model) {
      return model;
    }
    
    // 대소문자 무시하고 찾아봄
    const lowerModelName = modelName.toLowerCase();
    for (const [cachedName, cachedModel] of this.modelCache.entries()) {
      if (cachedName.toLowerCase() === lowerModelName) {
        return cachedModel;
      }
    }
    
    return null;
  }

  /**
   * 모델이 존재하는지 확인합니다 (대소문자 무시)
   */
  public hasModel(modelName: string): boolean {
    if (this.modelCache.size === 0) {
      this.loadModelsFromDMMF();
    }
    
    // 정확한 이름으로 먼저 확인
    if (this.modelCache.has(modelName)) {
      return true;
    }
    
    // 대소문자 무시하고 확인
    const lowerModelName = modelName.toLowerCase();
    for (const cachedName of this.modelCache.keys()) {
      if (cachedName.toLowerCase() === lowerModelName) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * DMMF(Data Model Meta Format)에서 모델 정보를 로드합니다
   * Prisma v6 이상에서는 _runtimeDataModel을 사용합니다
   */
  private loadModelsFromDMMF(): void {
    try {
      let dmmf = null;
      
      // Prisma v6에서 _runtimeDataModel 접근
      if ((this.prismaClient as any)._runtimeDataModel) {
        const runtimeDataModel = (this.prismaClient as any)._runtimeDataModel;
        
        if (runtimeDataModel && runtimeDataModel.models) {
          // enum 정보도 추출
          const enums = runtimeDataModel.enums || {};
          
          // RuntimeDataModel 형식을 DMMF 형식으로 변환
          const models = Object.entries(runtimeDataModel.models).map(([name, model]: [string, any]) => {
            let fields = [];
            if (model.fields) {
              // fields가 객체인 경우
              if (typeof model.fields === 'object' && !Array.isArray(model.fields)) {
                fields = Object.entries(model.fields).map(([fieldName, field]: [string, any]) => ({
                  name: fieldName,
                  kind: field.kind || 'scalar',
                  type: field.type || 'String',
                  isOptional: field.isOptional || false,
                  isList: field.isList || false,
                  isId: field.isId || false,
                  isUnique: field.isUnique || false,
                  isUpdatedAt: field.isUpdatedAt || false,
                  hasDefaultValue: field.hasDefaultValue || false,
                  relationName: field.relationName,
                  relationFromFields: field.relationFromFields,
                  relationToFields: field.relationToFields
                }));
              }
              // fields가 배열인 경우 (기존 DMMF 형식)
              else if (Array.isArray(model.fields)) {
                fields = model.fields;
              }
            }
            
            return {
              name,
              fields,
              primaryKey: model.primaryKey,
              uniqueFields: model.uniqueFields,
              dbName: model.dbName
            };
          });
          
          // enum 정보를 클래스 변수에 저장
          this.loadedEnums = enums;
          
          // 분석 완료 - 간단한 로그만 출력
          // log.Info(`✅ Prisma 스키마 분석 완료 (${this.databaseName}): ${models.length}개 모델, ${Object.keys(enums).length}개 enum 로드됨`);
          
          for (const model of models) {
            const modelInfo = this.parseModelFromDMMF(model);
            this.modelCache.set(model.name, modelInfo);
          }
          
          return;
        }
      }
      
      // 전통적인 DMMF 방법들 시도
      // 방법 1: 전통적인 _dmmf 접근
      if ((this.prismaClient as any)._dmmf) {
        dmmf = (this.prismaClient as any)._dmmf;
      }
      // 방법 2: dmmf 직접 접근
      else if ((this.prismaClient as any).dmmf) {
        dmmf = (this.prismaClient as any).dmmf;
      }
      // 방법 3: Prisma namespace 접근
      else if ((this.prismaClient as any).Prisma && (this.prismaClient as any).Prisma.dmmf) {
        dmmf = (this.prismaClient as any).Prisma.dmmf;
      }
      // 방법 4: 정적 DMMF 접근 (Prisma v6 이상 방식)
      else {
        try {
          const PrismaClass = this.prismaClient.constructor as any;
          if (PrismaClass.dmmf) {
            dmmf = PrismaClass.dmmf;
          }
        } catch (e) {
          log.Warn('정적 DMMF 접근 실패:', e);
        }
      }
      
      if (!dmmf) {
        log.Warn('DMMF 정보를 찾을 수 없습니다. 가능한 DMMF 속성들을 확인합니다...');
        log.Warn('클라이언트 속성:', Object.keys(this.prismaClient as any).filter(k => k.includes('dmmf') || k.includes('DMMF')));
        
        // 모든 클라이언트 속성 확인
        log.Warn('모든 클라이언트 속성:', Object.keys(this.prismaClient as any));
        
        if ((this.prismaClient as any).Prisma) {
          log.Warn('Prisma 네임스페이스 속성:', Object.keys((this.prismaClient as any).Prisma).filter(k => k.includes('dmmf') || k.includes('DMMF')));
        }
        
        // 생성자 속성 확인
        const constructor = this.prismaClient.constructor as any;
        if (constructor) {
          log.Warn('생성자 속성:', Object.keys(constructor).filter(k => k.includes('dmmf') || k.includes('DMMF')));
          log.Warn('생성자 정적 속성:', Object.getOwnPropertyNames(constructor).filter(k => k.includes('dmmf') || k.includes('DMMF')));
        }
        
        return;
      }

      if (!dmmf.datamodel || !dmmf.datamodel.models) {
        log.Warn('DMMF 구조가 예상과 다릅니다:', {
          hasDmmf: !!dmmf,
          hasDatamodel: !!(dmmf && dmmf.datamodel),
          hasModels: !!(dmmf && dmmf.datamodel && dmmf.datamodel.models),
          dmmfStructure: dmmf ? Object.keys(dmmf) : 'N/A'
        });
        return;
      }

      const models = dmmf.datamodel.models;

      for (const model of models) {
        const modelInfo = this.parseModelFromDMMF(model);
        this.modelCache.set(model.name, modelInfo);
      }

      // 분석 완료 - 로그 제거
      // log.Info(`✅ Prisma 스키마 분석 완료 (${this.databaseName}): ${this.modelCache.size}개 모델 로드됨`);
    } catch (error) {
      log.Error('Prisma DMMF 로드 중 오류 발생:', error);
    }
  }

  /**
   * DMMF 모델을 PrismaModelInfo로 변환합니다
   */
  private parseModelFromDMMF(dmmfModel: any): PrismaModelInfo {
    const fields: PrismaFieldMetadata[] = dmmfModel.fields.map((field: any) => 
      this.parseFieldFromDMMF(field)
    );

    const relations: PrismaRelationInfo[] = dmmfModel.fields
      .filter((field: any) => field.kind === 'object')
      .map((field: any) => this.parseRelationFromDMMF(field));

    const indexes: PrismaIndexInfo[] = [];
    
    // 고유 제약조건을 인덱스로 처리
    if (dmmfModel.uniqueFields && Array.isArray(dmmfModel.uniqueFields)) {
      for (const uniqueField of dmmfModel.uniqueFields) {
        if (Array.isArray(uniqueField)) {
          indexes.push({
            fields: uniqueField,
            type: 'unique'
          });
        }
      }
    }

    // 기본 키 정보 추출
    const primaryKey = dmmfModel.primaryKey ? {
      name: dmmfModel.primaryKey.name,
      fields: dmmfModel.primaryKey.fields
    } : {
      fields: fields.filter(f => f.isId).map(f => f.name)
    };

    // 고유 제약조건 정보 추출
    const uniqueConstraints = dmmfModel.uniqueFields ? 
      dmmfModel.uniqueFields.map((fields: string[]) => ({ fields })) : [];

    return {
      name: dmmfModel.name,
      dbName: dmmfModel.dbName,
      fields,
      relations,
      indexes,
      primaryKey: primaryKey.fields.length > 0 ? primaryKey : undefined,
      uniqueConstraints,
      documentation: dmmfModel.documentation
    };
  }

  /**
   * DMMF 필드를 PrismaFieldMetadata로 변환합니다
   */
  private parseFieldFromDMMF(dmmfField: any): PrismaFieldMetadata {
    const fieldType = dmmfField.type;
    const jsType = PRISMA_TYPE_MAPPING[fieldType] || 'unknown';

    return {
      name: dmmfField.name,
      type: fieldType,
      jsType,
      isOptional: dmmfField.isOptional || false,
      isList: dmmfField.isList || false,
      isId: dmmfField.isId || false,
      isUnique: dmmfField.isUnique || false,
      isReadOnly: dmmfField.isReadOnly || false,
      isGenerated: dmmfField.isGenerated || false,
      isUpdatedAt: dmmfField.isUpdatedAt || false,
      default: dmmfField.default,
      relationName: dmmfField.relationName,
      relationFromFields: dmmfField.relationFromFields,
      relationToFields: dmmfField.relationToFields,
      documentation: dmmfField.documentation,
      nativeType: dmmfField.nativeType // @db.Uuid, @db.VarChar 등의 네이티브 타입 정보
    };
  }

  /**
   * DMMF 관계를 PrismaRelationInfo로 변환합니다
   */
  private parseRelationFromDMMF(dmmfField: any): PrismaRelationInfo {
    // 관계 타입 결정
    let relationType: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
    
    if (dmmfField.isList) {
      relationType = 'one-to-many';
    } else if (dmmfField.relationFromFields && dmmfField.relationFromFields.length > 0) {
      relationType = 'many-to-one';
    } else {
      relationType = 'one-to-one';
    }

    return {
      name: dmmfField.name,
      type: relationType,
      model: dmmfField.type,
      fields: dmmfField.relationFromFields,
      references: dmmfField.relationToFields,
      onDelete: dmmfField.relationOnDelete,
      onUpdate: dmmfField.relationOnUpdate
    };
  }

  /**
   * 모델의 기본 키 필드를 반환합니다
   */
  public getPrimaryKeyField(modelName: string): PrismaFieldMetadata | null {
    const model = this.getModel(modelName);
    if (!model) return null;

    // @id 데코레이터가 있는 필드 찾기
    const idField = model.fields.find(field => field.isId);
    if (idField) return idField;

    // @@id로 정의된 복합 기본 키의 첫 번째 필드
    if (model.primaryKey && model.primaryKey.fields.length > 0) {
      const firstPrimaryKeyField = model.primaryKey.fields[0];
      return model.fields.find(field => field.name === firstPrimaryKeyField) || null;
    }

    return null;
  }

  /**
   * 모델의 필수 필드들을 반환합니다 (create 시 필요한 필드들)
   */
  public getRequiredFields(modelName: string): PrismaFieldMetadata[] {
    const model = this.getModel(modelName);
    if (!model) return [];

    return model.fields.filter(field => 
      !field.isOptional && 
      !field.isReadOnly && 
      !field.isGenerated &&
      !field.isUpdatedAt &&
      !field.relationName // 관계 필드 제외
    );
  }

  /**
   * 모델의 업데이트 가능한 필드들을 반환합니다
   */
  public getUpdatableFields(modelName: string): PrismaFieldMetadata[] {
    const model = this.getModel(modelName);
    if (!model) return [];

    return model.fields.filter(field => 
      !field.isReadOnly && 
      !field.isGenerated &&
      !field.isId &&
      !field.isUpdatedAt &&
      !field.relationName // 관계 필드 제외
    );
  }

  /**
   * 모델의 Json 타입 필드 이름들을 반환합니다
   */
  public getJsonFields(modelName: string): string[] {
    const model = this.getModel(modelName);
    if (!model) return [];

    return model.fields
      .filter(field => field.type === 'Json')
      .map(field => field.name);
  }

  /**
   * Enum 타입인지 확인합니다
   */
  public isEnumType(type: string): boolean {
    // Prisma에서 Enum은 보통 대문자로 시작하고 내장 타입이 아닙니다
    const builtInTypes = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes', 'BigInt', 'Decimal'];
    return !builtInTypes.includes(type) && type.charAt(0).toUpperCase() === type.charAt(0);
  }

  /**
   * Enum 값들을 반환합니다 (DMMF에서 로드된 실제 enum 사용)
   */
  public getEnumValues(type: string): string[] | undefined {
    // DMMF에서 로드된 실제 enum 값 사용
    if (this.loadedEnums[type] && Array.isArray(this.loadedEnums[type].values)) {
      return this.loadedEnums[type].values;
    }

    // 로드된 enum이 다른 형식인 경우 처리
    if (this.loadedEnums[type] && typeof this.loadedEnums[type] === 'object') {
      const enumObj = this.loadedEnums[type];
      if (enumObj.values) {
        return Array.isArray(enumObj.values) ? enumObj.values : Object.values(enumObj.values);
      }
      return Object.values(enumObj).filter(value => typeof value === 'string') as string[];
    }

    return undefined;
  }

  /**
   * 캐시를 클리어합니다 (테스트용)
   */
  public clearCache(): void {
    this.modelCache.clear();
  }
}
