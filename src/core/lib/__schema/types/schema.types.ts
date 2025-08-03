import { ColumnMetadata as TypeORMColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata';
import { IndexMetadata } from 'typeorm/metadata/IndexMetadata';

/**
 * 컬럼 메타데이터 인터페이스
 */
export interface ColumnMetadata {
  name: string;
  databaseName: string;
  type: string;
  jsType: string;
  isPrimary: boolean;
  isGenerated: boolean;
  generationStrategy?: 'uuid' | 'increment' | 'rowid' | 'identity';
  isNullable: boolean;
  isArray?: boolean;
  default?: any;
  length?: string | number;
  width?: number;
  precision?: number;
  scale?: number;
  zerofill?: boolean;
  unsigned?: boolean;
  charset?: string;
  collation?: string;
  comment?: string;
  enum?: any[];
  enumName?: string;
  asExpression?: string;
  generatedType?: 'VIRTUAL' | 'STORED';
  metadata: {
    type: string;
    jsType: string;
    isEnum: boolean;
    enumValues?: any[];
    isNullable: boolean;
    isPrimary: boolean;
    isGenerated: boolean;
    length?: string | number;
    default?: any;
  };
}

/**
 * 관계 메타데이터 인터페이스
 */
export interface RelationInfo {
  name: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  target: string;
  inverseSide?: string;
  isOwner: boolean;
  isLazy?: boolean;
  isCascade: {
    insert: boolean;
    update: boolean;
    remove: boolean;
    softRemove: boolean;
    recover: boolean;
  };
  onDelete?: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'DEFAULT' | 'NO ACTION';
  onUpdate?: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'DEFAULT' | 'NO ACTION';
  nullable?: boolean;
  joinColumns?: Array<{
    name: string;
    referencedColumnName?: string;
  }>;
  joinTable?: string | null;
}

/**
 * 인덱스 정보 인터페이스
 */
export interface IndexInfo {
  name?: string;
  columns: string[];
  isUnique: boolean;
  where?: string;
}

/**
 * 기본 키 정보 인터페이스
 */
export interface PrimaryKeyInfo {
  name: string;
  databaseName: string;
  type: string;
  isGenerated: boolean;
  generationStrategy?: 'uuid' | 'increment' | 'rowid' | 'identity';
}

/**
 * 체크 제약조건 인터페이스
 */
export interface CheckInfo {
  name?: string;
  expression: string;
}

/**
 * 유니크 제약조건 인터페이스
 */
export interface UniqueInfo {
  name?: string;
  columns: string[];
}

/**
 * 외래키 정보 인터페이스
 */
export interface ForeignKeyInfo {
  name?: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

/**
 * 엔티티 정보 인터페이스
 */
export interface SchemaEntityInfo {
  entityName: string;
  tableName: string;
  schema?: string;
  database?: string;
  targetName: string;
  primaryKeys: PrimaryKeyInfo[];
  columns: ColumnMetadata[];
  relations: RelationInfo[];
  indices: IndexInfo[];
  checks: CheckInfo[];
  uniques: UniqueInfo[];
  foreignKeys: ForeignKeyInfo[];
  engine?: string;
  synchronize?: boolean;
  withoutRowid?: boolean;
  crudInfo?: CrudInfo;
}

/**
 * CRUD 설정 정보 인터페이스
 */
export interface CrudConfiguration {
  controllerName?: string;
  entityName: string;
  allowedFilters?: string[];
  allowedParams?: string[];
  allowedIncludes?: string[];
  allowedMethods?: string[];
  routes?: {
    [method: string]: {
      allowedFilters?: string[];
      allowedParams?: string[];
      allowedIncludes?: string[];
    };
  };
}

/**
 * TypeORM 컬럼 타입 유니언
 */
export type TypeORMColumnType =
  | 'varchar'
  | 'text'
  | 'int'
  | 'integer'
  | 'bigint'
  | 'float'
  | 'double'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'timestamp'
  | 'time'
  | 'json'
  | 'uuid'
  | 'enum'
  | string;

/**
 * JavaScript 타입 매핑
 */
export const JS_TYPE_MAPPING: Record<string, string> = {
  varchar: 'string',
  text: 'string',
  char: 'string',
  int: 'number',
  integer: 'number',
  smallint: 'number',
  bigint: 'number',
  float: 'number',
  double: 'number',
  decimal: 'number',
  numeric: 'number',
  boolean: 'boolean',
  bool: 'boolean',
  date: 'Date',
  datetime: 'Date',
  timestamp: 'Date',
  time: 'string',
  json: 'object',
  jsonb: 'object',
  uuid: 'string',
  enum: 'string',
};

export interface CrudMetadata {
  controllerName: string;
  controllerPath: string;
  entityName: string;
  allowedMethods: string[];
  allowedFilters: string[];
  allowedParams: string[];
  allowedIncludes: string[];
  routeSettings: Record<string, any>;
  paginationType?: string;
  softDelete?: boolean;
  logging?: boolean;
}

export interface CrudInfo {
  isConfigured: boolean;
  controllerPath?: string;
  entityName?: string;
  allowedMethods?: string[];
  allowedFilters?: string[];
  allowedParams?: string[];
  allowedIncludes?: string[];
  routeSettings?: Record<string, any>;
  availableEndpoints: string[];
  note?: string;
}

export interface ControllerWrapper {
  metatype: any;
}

export interface SecurityValidationResult {
  isAllowed: boolean;
  errorMessage?: string;
  errorCode?: string;
  hint?: string;
  clientIP?: string;
} 