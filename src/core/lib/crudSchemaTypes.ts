/**
 * Prisma 기반 CRUD 스키마 API 타입 정의
 * Express.js 환경에서 개발 모드일 때만 사용되는 스키마 정보
 */

/**
 * Prisma 필드 타입 매핑
 */
export const PRISMA_TYPE_MAPPING: Record<string, string> = {
  String: 'string',
  Int: 'number', 
  BigInt: 'bigint',
  Float: 'number',
  Decimal: 'number',
  Boolean: 'boolean',
  DateTime: 'Date',
  Json: 'object',
  Bytes: 'Buffer',
};

/**
 * Prisma 필드 메타데이터
 */
export interface PrismaFieldMetadata {
  name: string;
  type: string;
  jsType: string;
  isOptional: boolean;
  isList: boolean;
  isId: boolean;
  isUnique: boolean;
  isReadOnly: boolean;
  isGenerated: boolean;
  isUpdatedAt: boolean;
  default?: any;
  relationName?: string;
  relationFromFields?: string[];
  relationToFields?: string[];
  documentation?: string;
}

/**
 * Prisma 관계 정보
 */
export interface PrismaRelationInfo {
  name: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  model: string;
  fields?: string[];
  references?: string[];
  onDelete?: 'Cascade' | 'Restrict' | 'NoAction' | 'SetNull' | 'SetDefault';
  onUpdate?: 'Cascade' | 'Restrict' | 'NoAction' | 'SetNull' | 'SetDefault';
}

/**
 * Prisma 인덱스 정보
 */
export interface PrismaIndexInfo {
  name?: string;
  fields: string[];
  type?: 'unique' | 'normal' | 'fulltext';
  map?: string;
}

/**
 * Prisma 모델 정보
 */
export interface PrismaModelInfo {
  name: string;
  dbName?: string;
  fields: PrismaFieldMetadata[];
  relations: PrismaRelationInfo[];
  indexes: PrismaIndexInfo[];
  primaryKey?: {
    name?: string;
    fields: string[];
  };
  uniqueConstraints: Array<{
    name?: string;
    fields: string[];
  }>;
  documentation?: string;
}

/**
 * CRUD 엔드포인트 정보
 */
export interface CrudEndpointInfo {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  action: 'index' | 'show' | 'create' | 'update' | 'destroy' | 'recover';
  description: string;
  requestSchema?: any;
  responseSchema?: any;
  middleware?: string[];
  validation?: {
    create?: any;
    update?: any;
    recover?: any;
  };
}

/**
 * CRUD 스키마 정보
 */
export interface CrudSchemaInfo {
  databaseName: string;
  modelName: string;
  basePath: string;
  primaryKey: string;
  primaryKeyType: string;
  enabledActions: string[];
//   endpoints: CrudEndpointInfo[];
  model: PrismaModelInfo;
  options: {
    softDelete?: {
      enabled: boolean;
      field: string;
    };
    includeMerge?: boolean;
    middleware?: Record<string, string[]>;
    validation?: Record<string, any>;
    hooks?: Record<string, string>;
  };
  createdAt: Date;
  isAutoRegistered?: boolean; // 자동 등록된 모델인지 표시
}

/**
 * 스키마 API 응답 형태
 */
export interface SchemaApiResponse<T = any> {
  success: boolean;
  data: T;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    timestamp: Date;
    environment: string;
  };
}

/**
 * 전체 스키마 정보 응답
 */
export interface AllSchemasResponse {
  schemas: CrudSchemaInfo[];
  models: PrismaModelInfo[];
  databases: string[];
  totalSchemas: number;
  environment: string;
  registrationStats?: {
    autoRegistered: number;
    manualRegistered: number;
    total: number;
  };
}
