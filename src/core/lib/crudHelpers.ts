import { Request } from 'express';

import { ErrorHandler, ErrorResponseFormat } from './errorHandler';
import { ERROR_CODES, PRISMA_ERROR_CODES } from './errorCodes';

/**
 * CRUD 쿼리 파싱 및 필터링을 위한 헬퍼 유틸리티
 */

export interface CrudQueryParams {
  include?: string[];
  select?: string[];  // 필드 선택 파라미터 추가
  fields?: Record<string, string[]>;  // JSON:API Sparse Fieldsets
  sort?: SortParam[];
  page?: PageParam;
  filter?: Record<string, any>;
}

/**
 * JSON:API Atomic Operations 인터페이스
 */
export interface JsonApiAtomicOperation {
  op: 'add' | 'update' | 'remove';
  data?: JsonApiResource;
  ref?: {
    type: string;
    id: string;
    relationship?: string;
  };
}

export interface JsonApiAtomicOperationsDocument {
  'atomic:operations': JsonApiAtomicOperation[];
  jsonapi?: JsonApiObject;
}

export interface JsonApiAtomicResultsDocument {
  'atomic:results': (JsonApiResource | null)[];
  jsonapi?: JsonApiObject;
  meta?: Record<string, any>;
}

/**
 * JSON:API 객체 (확장)
 */
export interface JsonApiObject {
  version?: string;
  ext?: string[]; // Applied extensions URIs
  profile?: string[]; // Applied profiles URIs  
  meta?: {
    implementedFeatures?: string[];
    supportedExtensions?: string[];
    supportedProfiles?: string[];
    implementation?: string;
    [key: string]: any;
  };
}

/**
 * JSON:API 관계 데이터 - 리소스 식별자 또는 완전한 리소스 객체
 * 새로운 리소스 생성 시에는 attributes를 포함한 완전한 리소스 객체 사용
 */
export type JsonApiRelationshipData = JsonApiResourceIdentifier | JsonApiResource;

/**
 * JSON:API 관계 객체 인터페이스
 */
export interface JsonApiRelationship {
  data?: JsonApiRelationshipData | JsonApiRelationshipData[] | null;
  links?: JsonApiRelationshipLinks;
  meta?: Record<string, any>;
}

/**
 * JSON:API 리소스 객체
 */
export interface JsonApiResource {
  type: string;
  id?: string;
  lid?: string; // Local ID for client-generated resources
  attributes?: Record<string, any>;
  relationships?: Record<string, JsonApiRelationship>;
  links?: JsonApiLinks;
  meta?: Record<string, any>;
}

/**
 * JSON:API 리소스 식별자 객체 (확장)
 */
export interface JsonApiResourceIdentifier {
  type: string;
  id?: string;
  lid?: string; // Local ID for client-generated resources
  meta?: Record<string, any>; // Non-standard meta-information
}

/**
 * JSON:API 링크 객체 인터페이스
 */
export interface JsonApiLinks {
  self?: string;
  related?: string;
  first?: string;
  last?: string;
  prev?: string;
  next?: string;
}

/**
 * JSON:API 관계 링크 객체 인터페이스
 */
export interface JsonApiRelationshipLinks {
  self?: string;
  related?: string;
}

/**
 * JSON:API 응답 인터페이스
 */
export interface JsonApiResponse {
  data: JsonApiResource | JsonApiResource[] | null;
  included?: JsonApiResource[];
  links?: JsonApiLinks;
  meta?: Record<string, any>;
  jsonapi?: JsonApiObject;
}

/**
 * JSON:API 에러 객체 인터페이스
 */
export interface JsonApiError {
  id?: string;
  links?: {
    about?: string;
    type?: string;
  };
  status?: string;
  code?: string;
  title?: string;
  detail?: string;
  source?: {
    pointer?: string;
    parameter?: string;
    header?: string;
  };
  meta?: Record<string, any>;
}

/**
 * 에러 정보 보안 처리 옵션
 */
export interface ErrorSecurityOptions {
  isDevelopment?: boolean;
  sanitizeDetails?: boolean;
  includeStackTrace?: boolean;
  maxDetailLength?: number;
}

/**
 * JSON:API 에러 응답 인터페이스
 */
export interface JsonApiErrorResponse {
  errors: JsonApiError[];
  jsonapi?: JsonApiObject;
  meta?: Record<string, any>;
  links?: JsonApiLinks;
}

export interface SortParam {
  field: string;
  direction: 'asc' | 'desc';
}

export interface PageParam {
  number?: number;
  size?: number;
  offset?: number;
  limit?: number;
  cursor?: string;
}

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: any;
}

export type FilterOperator = 
  | 'eq' | 'ne' 
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'like' | 'ilike' | 'start' | 'end' | 'contains'
  | 'in' | 'not_in'
  | 'null' | 'not_null' | 'present' | 'blank'
  | 'regex' | 'exists' | 'size' | 'all' | 'elemMatch';

/**
 * 쿼리 파라미터를 파싱하여 CRUD 파라미터로 변환
 */
export class CrudQueryParser {
  
  /**
   * Express 요청 객체에서 CRUD 쿼리 파라미터를 파싱
   */
  static parseQuery(req: Request, modelName?: string, schemaAnalyzer?: any): CrudQueryParams {
    const query = req.query;
    
    return {
      include: this.parseInclude(query.include as string),
      select: this.parseSelect(query.select as string),
      fields: this.parseFields(query),
      sort: this.parseSort(query.sort as string),
      page: this.parsePage(query),
      filter: this.parseFilter(query, modelName, schemaAnalyzer)
    };
  }

  /**
   * include 파라미터 파싱
   * ?include=author,comments.author
   */
  private static parseInclude(include?: string): string[] | undefined {
    if (!include) return undefined;
    return include.split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0); // 빈 문자열 제거
  }

  /**
   * select 파라미터 파싱
   * ?select=id,name,author.name,author.email
   */
  private static parseSelect(select?: string): string[] | undefined {
    if (!select) return undefined;
    return select.split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0); // 빈 문자열 제거
  }

  /**
   * JSON:API Sparse Fieldsets 파라미터 파싱
   * ?fields[users]=name,email&fields[posts]=title,content
   */
  private static parseFields(query: any): Record<string, string[]> | undefined {
    const fields: Record<string, string[]> = {};
    let hasFields = false;

    Object.keys(query).forEach(key => {
      // fields[type] 패턴 매칭
      const match = key.match(/^fields\[([^\]]+)\]$/);
      if (match) {
        const resourceType = match[1];
        const fieldValue = query[key];
        
        if (typeof fieldValue === 'string' && fieldValue.length > 0) {
          fields[resourceType] = fieldValue.split(',')
            .map(field => field.trim())
            .filter(field => field.length > 0);
          hasFields = true;
        }
      }
    });

    return hasFields ? fields : undefined;
  }

  /**
   * sort 파라미터 파싱
   * ?sort=age,-created_at
   */
  private static parseSort(sort?: string): SortParam[] | undefined {
    if (!sort) return undefined;
    
    return sort.split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0) // 빈 문자열 제거
      .map(item => {
        if (item.startsWith('-')) {
          return { field: item.slice(1), direction: 'desc' as const };
        }
        return { field: item, direction: 'asc' as const };
      });
  }

  /**
   * page 파라미터 파싱
   * ?page[number]=3&page[size]=10
   * ?page[offset]=20&page[limit]=10
   * 또는 중첩 객체 형태: { page: { offset: "0", limit: "10" } }
   */
  private static parsePage(query: any): PageParam | undefined {
    const page: any = {};
    
    // 1. 중첩 객체 형태 처리 (Express에서 page[key]=value를 { page: { key: value } }로 파싱하는 경우)
    if (query.page && typeof query.page === 'object') {
      Object.entries(query.page).forEach(([key, value]) => {
        if (key === 'cursor') {
          page[key] = value;
        } else {
          const numValue = parseInt(value as string, 10);
          if (!isNaN(numValue)) {
            page[key] = numValue;
          }
        }
      });
    }
    
    // 2. 플랫 형태 처리 (page[key]=value가 그대로 키로 들어오는 경우)
    Object.keys(query).forEach(key => {
      const match = key.match(/^page\[(.+)\]$/);
      if (match) {
        const pageKey = match[1];
        const value = parseInt(query[key] as string, 10);
        if (!isNaN(value)) {
          page[pageKey] = value;
        } else if (pageKey === 'cursor') {
          page[pageKey] = query[key];
        }
      }
    });

    // 페이지네이션 파라미터가 명시적으로 제공되었는지 확인
    const hasPageParams = Object.keys(page).length > 0;
    
    // 페이지네이션 파라미터가 하나도 제공되지 않은 경우 undefined 반환
    if (!hasPageParams) {
      return undefined;
    }
    
    // number 방식인지 offset 방식인지 확인하여 적절한 기본값만 설정
    const hasNumberParams = page.number !== undefined || page.size !== undefined;
    const hasOffsetParams = page.offset !== undefined || page.limit !== undefined;
    
    // number 방식과 offset 방식이 동시에 사용된 경우 number 방식 우선
    if (hasNumberParams && hasOffsetParams) {
      // number 방식만 유지
      delete page.offset;
      delete page.limit;
    }
    
    // number 방식: number만 있고 size가 없는 경우에만 기본 size 설정
    if (page.number !== undefined && page.size === undefined) {
      page.size = 10;
    }
    
    // offset 방식: offset만 있고 limit이 없는 경우에만 기본 limit 설정
    if (page.offset !== undefined && page.limit === undefined) {
      page.limit = 10;
    }
    
    return page;
  }

  /**
   * filter 파라미터 파싱
   * ?filter[name_eq]=John&filter[age_gt]=18
   * 또는 중첩 객체 형태: { filter: { name_eq: "John", age_gt: 18 } }
   * OR 조건 지원: ?filter[or][0][name_eq]=John&filter[or][0][age_gt]=18&filter[or][1][name_eq]=Jane
   */
  private static parseFilter(query: any, modelName?: string, schemaAnalyzer?: any): Record<string, any> | undefined {
    const filters: Record<string, any> = {};
    let orConditions: any[] = [];
    
    // 1. 중첩 객체 형태 처리 (Express에서 filter[key]=value를 { filter: { key: value } }로 파싱하는 경우)
    if (query.filter && typeof query.filter === 'object') {
      Object.entries(query.filter).forEach(([filterExpression, value]) => {
        // OR 조건 처리 (대소문자 구분 없음)
        if (filterExpression.toLowerCase() === 'or' && typeof value === 'object') {
          orConditions = this.parseOrConditions(value, modelName, schemaAnalyzer);
        } else {
          // 일반 필터 조건 처리
          const parsed = this.parseFilterExpression(filterExpression, value, modelName, schemaAnalyzer);
          
          if (parsed) {
            filters[parsed.field] = {
              ...filters[parsed.field],
              [parsed.operator]: parsed.value
            };
          }
        }
      });
    }
    
    // 2. 평면 키 형태 처리 (filter[key]=value)
    Object.keys(query).forEach(key => {
      // OR 조건 패턴 매칭: filter[or][0][field_op]=value (대소문자 구분 없음)
      const orMatch = key.match(/^filter\[(or|Or|OR)\]\[(\d+)\]\[(.+)\]$/i);
      if (orMatch) {
        const orIndex = parseInt(orMatch[2], 10);
        const filterExpression = orMatch[3];
        const value = query[key];
        
        // OR 조건 배열 초기화
        if (!orConditions[orIndex]) {
          orConditions[orIndex] = {};
        }
        
        const parsed = this.parseFilterExpression(filterExpression, value, modelName, schemaAnalyzer);
        if (parsed) {
          orConditions[orIndex][parsed.field] = {
            ...orConditions[orIndex][parsed.field],
            [parsed.operator]: parsed.value
          };
        }
        return;
      }
      
      // 일반 필터 패턴 매칭: filter[field_op]=value
      const match = key.match(/^filter\[(.+)\]$/);
      if (match) {
        const filterExpression = match[1];
        const value = query[key];
        
        // OR 조건이 아닌 경우에만 처리 (대소문자 구분 없음)
        if (filterExpression.toLowerCase() !== 'or') {
          const parsed = this.parseFilterExpression(filterExpression, value, modelName, schemaAnalyzer);
          if (parsed) {
            filters[parsed.field] = {
              ...filters[parsed.field],
              [parsed.operator]: parsed.value
            };
          }
        }
      }
    });

    // OR 조건이 있는 경우 처리
    if (orConditions.length > 0) {
      // 빈 조건 제거
      const validOrConditions = orConditions.filter(condition => 
        condition && Object.keys(condition).length > 0
      );
      
      if (validOrConditions.length > 0) {
        filters._or = validOrConditions;
      }
    }

    return Object.keys(filters).length > 0 ? filters : undefined;
  }

  /**
   * OR 조건 파싱 (중첩 객체 형태)
   * filter: { or: { "0": { name_eq: "John" }, "1": { name_eq: "Jane" } } }
   */
  private static parseOrConditions(orObject: any, modelName?: string, schemaAnalyzer?: any): any[] {
    const orConditions: any[] = [];
    
    Object.entries(orObject).forEach(([index, condition]) => {
      if (typeof condition === 'object' && condition !== null) {
        const orIndex = parseInt(index, 10);
        if (!isNaN(orIndex)) {
          orConditions[orIndex] = {};
          
          Object.entries(condition).forEach(([filterExpression, value]) => {
            const parsed = this.parseFilterExpression(filterExpression, value, modelName, schemaAnalyzer);
            if (parsed) {
              orConditions[orIndex][parsed.field] = {
                ...orConditions[orIndex][parsed.field],
                [parsed.operator]: parsed.value
              };
            }
          });
        }
      }
    });
    
    return orConditions;
  }

  /**
   * 필터 표현식 파싱 (field_operator 형태)
   * 관계 필터링도 지원: author.name_like, tags.name_in 등
   */
  private static parseFilterExpression(expression: string, value: any, modelName?: string, schemaAnalyzer?: any) {
    const operators = [
      'not_null', 'not_in', 'between', 'present', 'blank', 'elemMatch',
      'ilike', 'like', 'start', 'end', 'contains', 'regex', 'exists', 'size', 'all',
      'gte', 'lte', 'gt', 'lt', 'ne', 'eq', 'in', 'null'
    ];

    for (const op of operators) {
      if (expression.endsWith('_' + op)) {
        const field = expression.slice(0, -(op.length + 1));
        const parsedValue = this.parseFilterValue(op as FilterOperator, value, field, modelName, schemaAnalyzer);
        
        return {
          field,
          operator: op as FilterOperator,
          value: parsedValue
        };
      }
    }

    // 연산자가 명시되지 않은 경우 값의 패턴을 보고 자동 감지
    const autoDetectedOperator = this.autoDetectOperator(value);
    
    return {
      field: expression,
      operator: autoDetectedOperator,
      value: this.parseFilterValue(autoDetectedOperator, value, expression, modelName, schemaAnalyzer)
    };
  }

  /**
   * 값의 패턴을 보고 연산자를 자동 감지
   */
  private static autoDetectOperator(value: any): FilterOperator {
    if (typeof value === 'string') {
      // %로 시작하고 끝나는 경우: LIKE 패턴
      if (value.startsWith('%') && value.endsWith('%')) {
        return 'like';
      }
      // %로 시작하는 경우: ENDS WITH 패턴
      if (value.startsWith('%')) {
        return 'end';
      }
      // %로 끝나는 경우: STARTS WITH 패턴
      if (value.endsWith('%')) {
        return 'start';
      }
      // 쉼표로 구분된 값들: IN 패턴
      if (value.includes(',')) {
        return 'in';
      }
    }
    
    // 기본값: 정확한 일치
    return 'eq';
  }

  /**
   * 필터 값을 올바른 타입으로 변환
   */
  private static parseFilterValue(operator: FilterOperator, value: any, fieldName?: string, modelName?: string, schemaAnalyzer?: any): any {
    if (value === null || value === undefined) return value;

    switch (operator) {
      case 'in':
      case 'not_in':
        if (typeof value === 'string') {
          return value.split(',')
            .map(v => v.trim())
            .filter(v => v.length > 0) // 빈 문자열 제거
            .map(v => this.smartTypeConversion(v, fieldName, modelName, schemaAnalyzer)); // 각 값에 대해 타입 변환
        }
        return Array.isArray(value) ? value.filter(v => v !== '' && v != null) : value;
      
      case 'between':
        if (typeof value === 'string') {
          const parts = value.split(',')
            .map(v => v.trim())
            .filter(v => v.length > 0) // 빈 문자열 제거
            .map(v => this.smartTypeConversion(v, fieldName, modelName, schemaAnalyzer)); // 각 값에 대해 타입 변환
          return parts.length === 2 ? parts : value;
        }
        return value;
      
      case 'null':
      case 'not_null':
      case 'present':
      case 'blank':
        return value === 'true' || value === true;
      
      case 'like':
      case 'ilike':
      case 'start':
      case 'end':
      case 'contains':
        return String(value);
      
      default:
        // 스마트 타입 변환: 특정 패턴에 따라 자동 변환
        return this.smartTypeConversion(value, fieldName, modelName, schemaAnalyzer);
    }
  }

  /**
   * 스마트 타입 변환: 스키마 정보를 기반으로 적절한 타입으로 변환
   */
  private static smartTypeConversion(value: any, fieldName?: string, modelName?: string, schemaAnalyzer?: any): any {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'string') return value;

    // 스키마 정보가 있는 경우 정확한 타입 변환
    if (fieldName && modelName && schemaAnalyzer) {
      const fieldType = this.getFieldTypeFromSchema(fieldName, modelName, schemaAnalyzer);
      if (fieldType) {
        return this.convertValueByType(value, fieldType);
      }
    }

    // 스키마 정보가 없는 경우 기존 휴리스틱 방법 사용
    return this.fallbackTypeConversion(value);
  }

  /**
   * 스키마에서 필드 타입 정보 가져오기
   */
  private static getFieldTypeFromSchema(fieldName: string, modelName: string, schemaAnalyzer: any): string | null {
    try {
      const model = schemaAnalyzer.getModel(modelName);
      if (!model) return null;

      // 중첩된 필드 처리 (author.name 등)
      if (fieldName.includes('.')) {
        // 관계 필드는 현재 구현에서는 문자열로 처리
        return 'String';
      }

      const field = model.fields.find((f: any) => f.name === fieldName);
      return field ? field.type : null;
    } catch (error) {
      // 스키마 분석 실패 시 null 반환
      return null;
    }
  }

  /**
   * 필드 타입에 따른 값 변환
   */
  private static convertValueByType(value: string, fieldType: string): any {
    switch (fieldType) {
      case 'String':
        return value; // 문자열은 그대로 유지
      
      case 'Int':
      case 'BigInt':
        const intValue = parseInt(value, 10);
        return isNaN(intValue) ? value : intValue;
      
      case 'Float':
      case 'Decimal':
        const floatValue = parseFloat(value);
        return isNaN(floatValue) ? value : floatValue;
      
      case 'Boolean':
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
        return value;
      
      case 'DateTime':
        return this.convertToDate(value);
      
      case 'Json':
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      
      default:
        // 알 수 없는 타입이거나 enum 등은 문자열로 유지
        return value;
    }
  }

  /**
   * 스키마 정보가 없을 때 사용하는 fallback 타입 변환
   */
  private static fallbackTypeConversion(value: string): any {
    // 날짜 패턴 감지 및 변환
    if (this.isDatePattern(value)) {
      return this.convertToDate(value);
    }

    // boolean 패턴
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // 숫자 패턴 감지 (순수 숫자만)
    if (this.isPureNumber(value)) {
      return Number(value);
    }

    // 기본값: 문자열 그대로 반환
    return value;
  }


  /**
   * 날짜 패턴인지 확인
   */
  private static isDatePattern(value: string): boolean {
    // YYYYMMDD 형식 (8자리 숫자)
    if (/^\d{8}$/.test(value)) return true;
    
    // YYYY-MM-DD 형식
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
    
    // ISO 8601 형식
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return true;
    
    // MM/DD/YYYY 또는 DD/MM/YYYY 형식
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) return true;

    return false;
  }

  /**
   * 문자열을 Date 객체로 변환
   */
  private static convertToDate(value: string): Date {
    // YYYYMMDD 형식 처리
    if (/^\d{8}$/.test(value)) {
      const year = parseInt(value.substring(0, 4), 10);
      const month = parseInt(value.substring(4, 6), 10) - 1; // JavaScript Date는 0-based month
      const day = parseInt(value.substring(6, 8), 10);
      return new Date(year, month, day);
    }

    // 다른 형식들은 Date 생성자가 처리
    const date = new Date(value);
    
    // 유효하지 않은 날짜인 경우 원본 문자열 반환
    if (isNaN(date.getTime())) {
      return value as any;
    }

    return date;
  }

  /**
   * 순수 숫자인지 확인 (ID나 코드가 아닌)
   */
  private static isPureNumber(value: string): boolean {
    // 빈 문자열이면 false
    if (!value.trim()) return false;
    
    // 숫자로 변환 가능하지만 특정 패턴은 제외
    if (!isNaN(Number(value))) {
      // 전화번호 패턴 (010으로 시작하는 11자리)
      if (/^010\d{8}$/.test(value)) return false;
      
      // 주민등록번호 앞자리 (6자리 숫자)
      if (/^\d{6}$/.test(value)) return false;
      
      // 8자리 날짜 형식 (YYYYMMDD)
      if (/^\d{8}$/.test(value)) return false;
      
      // 매우 긴 숫자 (ID로 추정)
      if (value.length > 10) return false;
      
      return true;
    }
    
    return false;
  }
}

/**
 * Prisma 쿼리 빌더
 */
export class PrismaQueryBuilder {
  
  /**
   * CRUD 파라미터를 Prisma findMany 옵션으로 변환
   */
  static buildFindManyOptions(params: CrudQueryParams) {
    const options: any = {};

    // Select 처리 (include보다 우선 처리)
    if (params.select) {
      options.select = this.buildSelectOptions(params.select);
    } else if (params.include) {
      // Select가 없을 때만 include 처리
      options.include = this.buildIncludeOptions(params.include);
    }

    // Sort 처리
    if (params.sort) {
      options.orderBy = this.buildOrderByOptions(params.sort);
    }

    // Pagination 처리
    if (params.page) {
      const pagination = this.buildPaginationOptions(params.page);
      Object.assign(options, pagination);
    }

    // Filter 처리
    if (params.filter) {
      options.where = this.buildWhereOptions(params.filter);
    }

    return options;
  }

  /**
   * Include 옵션 빌드
   */
  static buildIncludeOptions(includes: string[]) {
    const includeObj: any = {};
    
    includes.forEach(path => {
      const parts = path.split('.');
      let current = includeObj;
      
      parts.forEach((part, index) => {
        if (!current[part]) {
          current[part] = index === parts.length - 1 ? true : { include: {} };
        }
        if (index < parts.length - 1) {
          current = current[part].include;
        }
      });
    });

    return includeObj;
  }

  /**
   * Select 옵션 빌드 (관계 필드 지원)
   */
  static buildSelectOptions(selects: string[]): any {
    const selectObj: any = {};
    const relationFields: Record<string, string[]> = {};

    // 필드들을 일반 필드와 관계 필드로 분류
    selects.forEach(field => {
      if (field.includes('.')) {
        // 관계 필드 (author.name, category.title)
        const [relationField, ...nestedPath] = field.split('.');
        if (!relationFields[relationField]) {
          relationFields[relationField] = [];
        }
        relationFields[relationField].push(nestedPath.join('.'));
      } else {
        // 일반 필드
        selectObj[field] = true;
      }
    });

    // 관계 필드 select 처리
    Object.entries(relationFields).forEach(([relationField, nestedFields]) => {
      selectObj[relationField] = {
        select: this.buildSelectOptions(nestedFields)
      };
    });

    return selectObj;
  }

  /**
   * OrderBy 옵션 빌드 (관계 필드 정렬 지원)
   */
  private static buildOrderByOptions(sorts: SortParam[]) {
    return sorts.map(sort => {
      // JSON:API relationships 접두사 제거
      let cleanFieldPath = sort.field;
      if (cleanFieldPath.startsWith('relationships.')) {
        cleanFieldPath = cleanFieldPath.replace('relationships.', '');
      }

      // 관계 필드 정렬 처리 (author.name, category.title 등)
      if (cleanFieldPath.includes('.')) {
        return this.buildNestedOrderBy(cleanFieldPath, sort.direction);
      } else {
        // 일반 필드 정렬
        return { [cleanFieldPath]: sort.direction };
      }
    });
  }


  /**
   * 중첩된 관계 정렬 조건 빌드
   * author.name => { author: { name: 'asc' } }
   */
  private static buildNestedOrderBy(fieldPath: string, direction: 'asc' | 'desc') {
    const parts = fieldPath.split('.');
    let orderBy: any = {};
    let current = orderBy;

    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        // 마지막 필드에 정렬 방향 설정
        current[part] = direction;
      } else {
        // 중간 관계 필드
        current[part] = {};
        current = current[part];
      }
    });

    return orderBy;
  }

  /**
   * Pagination 옵션 빌드
   */
  private static buildPaginationOptions(page: PageParam) {
    const options: any = {};

    if (page.number !== undefined && page.size !== undefined) {
      // Page-based pagination
      options.skip = (page.number - 1) * page.size;
      options.take = page.size;
    } else if (page.offset !== undefined && page.limit !== undefined) {
      // Offset-based pagination
      options.skip = page.offset;
      options.take = page.limit;
    } else if (page.limit !== undefined) {
      // Limit only
      options.take = page.limit;
    }

    if (page.cursor !== undefined) {
      options.cursor = { id: page.cursor };
    }

    return options;
  }

  /**
   * Where 옵션 빌드 (관계 필터링 및 OR 조건 지원)
   */
  private static buildWhereOptions(filters: Record<string, any>) {
    const where: any = {};
    const orConditions: any[] = [];

    Object.entries(filters).forEach(([field, conditions]) => {
      // OR 조건 처리 (대소문자 구분 없음)
      if (field === '_or' && Array.isArray(conditions)) {
        conditions.forEach(orCondition => {
          const orWhere: any = {};
          
          Object.entries(orCondition).forEach(([orField, orConditions]) => {
            // 타입 검증
            if (typeof orConditions !== 'object' || orConditions === null) {
              return;
            }
            
            // 관계 필터링 처리 (author.name, tags.name 등)
            if (orField.includes('.')) {
              this.buildNestedWhereCondition(orWhere, orField, orConditions as Record<string, any>);
            } else {
              // 일반 필드 필터링
              const fieldConditions = this.buildFieldConditions(orConditions as Record<string, any>);
              if (fieldConditions !== undefined) {
                orWhere[orField] = fieldConditions;
              }
            }
          });
          
          // 유효한 OR 조건만 추가
          if (Object.keys(orWhere).length > 0) {
            orConditions.push(orWhere);
          }
        });
      } else {
        // 일반 AND 조건 처리
        // 관계 필터링 처리 (author.name, tags.name 등)
        if (field.includes('.')) {
          this.buildNestedWhereCondition(where, field, conditions);
        } else {
          // 일반 필드 필터링
          const fieldConditions = this.buildFieldConditions(conditions);
          if (fieldConditions !== undefined) {
            where[field] = fieldConditions;
          }
        }
      }
    });

    // OR 조건이 있는 경우 추가
    if (orConditions.length > 0) {
      where.OR = orConditions;
    }

    return where;
  }

  /**
   * 중첩된 관계 필터링 조건 빌드
   * author.name_like => { author: { name: { contains: "value" } } }
   * tags.name_in => { tags: { some: { name: { in: ["val1", "val2"] } } } }
   */
  private static buildNestedWhereCondition(where: any, fieldPath: string, conditions: Record<string, any>) {
    const parts = fieldPath.split('.');
    const relationField = parts[0];
    const targetField = parts.slice(1).join('.');

    if (!where[relationField]) {
      where[relationField] = {};
    }

    // 중첩된 필드 조건 빌드
    const fieldConditions = this.buildFieldConditions(conditions);
    
    if (fieldConditions !== undefined) {
      if (targetField.includes('.')) {
        // 더 깊은 중첩 관계 처리
        this.buildNestedWhereCondition(where[relationField], targetField, conditions);
      } else {
        // 관계 타입에 따른 처리
        if (this.isArrayRelation(conditions)) {
          // 배열 관계 (hasMany, manyToMany): some/every 사용
          where[relationField].some = {
            ...where[relationField].some,
            [targetField]: fieldConditions
          };
        } else {
          // 단일 관계 (hasOne, belongsTo): 직접 조건 적용
          where[relationField] = {
            ...where[relationField],
            [targetField]: fieldConditions
          };
        }
      }
    }
  }

  /**
   * 배열 관계인지 판단하는 헬퍼 메서드
   * 일반적으로 'in', 'not_in' 연산자나 복수형 필드명으로 판단
   */
  private static isArrayRelation(conditions: Record<string, any>): boolean {
    // 'in', 'not_in' 연산자가 있으면 배열 관계로 가정
    return Object.keys(conditions).some(op => ['in', 'not_in'].includes(op));
  }

  /**
   * 필드 조건 빌드
   */
  private static buildFieldConditions(conditions: Record<string, any>): any {
    const fieldCondition: any = {};
    let hasConditions = false;

    Object.entries(conditions).forEach(([operator, value]) => {
      switch (operator) {
        case 'eq':
          // eq 연산자는 직접 값 반환 (Prisma에서 { field: value }로 처리)
          fieldCondition._directValue = value;
          hasConditions = true;
          break;
          
        case 'ne':
          fieldCondition.not = value;
          hasConditions = true;
          break;
          
        case 'gt':
          fieldCondition.gt = value;
          hasConditions = true;
          break;
          
        case 'gte':
          fieldCondition.gte = value;
          hasConditions = true;
          break;
          
        case 'lt':
          fieldCondition.lt = value;
          hasConditions = true;
          break;
          
        case 'lte':
          fieldCondition.lte = value;
          hasConditions = true;
          break;
          
        case 'between':
          if (Array.isArray(value) && value.length === 2) {
            fieldCondition.gte = value[0];
            fieldCondition.lte = value[1];
            hasConditions = true;
          }
          break;
          
        case 'like':
          // SQL LIKE를 Prisma contains로 변환 (%는 제거)
          fieldCondition.contains = value.replace(/%/g, '');
          hasConditions = true;
          break;
          
        case 'ilike':
          // 대소문자 구분 없는 LIKE
          fieldCondition.contains = value.replace(/%/g, '');
          fieldCondition.mode = 'insensitive';
          hasConditions = true;
          break;
          
        case 'start':
          // 특정 문자로 시작
          fieldCondition.startsWith = value;
          hasConditions = true;
          break;
          
        case 'end':
          // 특정 문자로 끝남
          fieldCondition.endsWith = value;
          hasConditions = true;
          break;
          
        case 'contains':
          // 문자열 포함
          fieldCondition.contains = value;
          hasConditions = true;
          break;
          
        case 'in':
          // 배열에 포함
          fieldCondition.in = Array.isArray(value) ? value : [value];
          hasConditions = true;
          break;
          
        case 'not_in':
          // 배열에 미포함
          fieldCondition.notIn = Array.isArray(value) ? value : [value];
          hasConditions = true;
          break;
          
        case 'null':
          // NULL 값 체크
          if (value === true || value === 'true') {
            fieldCondition._directValue = null; // field IS NULL
          } else {
            fieldCondition.not = null; // field IS NOT NULL
          }
          hasConditions = true;
          break;
          
        case 'not_null':
          // NOT NULL 체크
          if (value === true || value === 'true') {
            fieldCondition.not = null; // field IS NOT NULL
          } else {
            fieldCondition._directValue = null; // field IS NULL
          }
          hasConditions = true;
          break;
          
        case 'present':
          // 존재 체크 (NULL도 빈값도 아님)
          if (value === true || value === 'true') {
            // 간단한 방식: NOT NULL을 의미. 빈 문자열 체크는 별도로 처리하지 않음
            // 대부분의 경우 NULL이 아닌 것만으로도 충분함
            fieldCondition.not = null;
          } else {
            // NULL 값
            fieldCondition._directValue = null;
          }
          hasConditions = true;
          break;
          
        case 'blank':
          // 공백 체크 (NULL이거나 빈값)
          if (value === true || value === 'true') {
            // NULL이거나 빈 문자열인 경우 - 간단한 방식으로 NULL만 체크
            fieldCondition._directValue = null;
          } else {
            // NOT NULL
            fieldCondition.not = null;
          }
          hasConditions = true;
          break;

        case 'regex':
          // 정규식 매칭 (DB에 따라 지원되지 않을 수 있음)
          fieldCondition.regex = value;
          hasConditions = true;
          break;

        case 'exists':
          // 필드 존재 여부 (NoSQL용, Prisma에서는 not null로 처리)
          if (value === true || value === 'true') {
            fieldCondition.not = null;
          } else {
            fieldCondition._directValue = null;
          }
          hasConditions = true;
          break;

        case 'size':
          // 배열 크기 (JSON 필드용)
          fieldCondition.array_length = parseInt(value);
          hasConditions = true;
          break;

        case 'all':
          // 배열의 모든 요소가 조건 만족 (JSON 필드용)
          fieldCondition.array_contains = Array.isArray(value) ? value : [value];
          hasConditions = true;
          break;

        case 'elemMatch':
          // 배열 요소 중 하나가 조건 만족 (JSON 필드용)
          fieldCondition.array_element_match = value;
          hasConditions = true;
          break;
          
        default:
          console.warn(`Unknown filter operator: ${operator}`);
          break;
      }
    });

    // eq 연산자나 null 체크의 경우 직접 값 반환
    if (fieldCondition._directValue !== undefined) {
      return fieldCondition._directValue;
    }

    // 다른 조건들이 있는 경우 조건 객체 반환
    return hasConditions ? fieldCondition : undefined;
  }
}

/**
 * 응답 포맷터
 */
export class CrudResponseFormatter {
  


  /**
   * 페이지네이션 메타데이터 생성
   */
  static createPaginationMeta(
    items: any[],
    total: number,
    page?: PageParam,
    operation: string = 'index',
    includedRelations?: string[],
    queryParams?: CrudQueryParams  // 추가: 쿼리 파라미터에서 자동으로 include 추출
  ) {
    const currentTimestamp = new Date().toISOString();
    
    // includedRelations가 없으면 queryParams에서 추출
    const finalIncludedRelations = includedRelations || queryParams?.include;
    
    // operation에 따라 적절한 카운트 필드 결정
    const isModifyOperation = ['create', 'update', 'delete', 'upsert'].includes(operation);
    
    const metadata: any = {
      operation,
      timestamp: currentTimestamp,
      ...(isModifyOperation 
        ? { affectedCount: items.length }  // 생성/수정/삭제 작업
        : { count: items.length }          // 조회 작업
      ),
      ...(finalIncludedRelations && finalIncludedRelations.length > 0 && {
        includedRelations: finalIncludedRelations
      })
    };

    if (!page) {
      metadata.pagination = {
        type: 'none',
        total,
        count: items.length
      };
      return metadata;
    }

    if (page.number !== undefined && page.size !== undefined) {
      // Page-based pagination
      const totalPages = Math.ceil(total / page.size);
      const hasNext = page.number < totalPages;
      const hasPrev = page.number > 1;
      
      metadata.pagination = {
        type: 'page',
        total,
        page: page.number,
        pages: totalPages,
        size: page.size,
        count: items.length,
        ...(hasNext && { hasNext: true }),
        ...(hasPrev && { hasPrev: true }),
        ...(hasNext && { nextCursor: this.generateNextCursor(page.number) }),
        ...(hasPrev && { prevCursor: this.generatePrevCursor(page.number) })
      };
    } else if (page.offset !== undefined && page.limit !== undefined) {
      // Offset-based pagination
      const hasMore = page.offset + page.limit < total;
      const currentPage = Math.floor(page.offset / page.limit) + 1;
      const totalPages = Math.ceil(total / page.limit);
      const hasNext = currentPage < totalPages;
      const hasPrev = currentPage > 1;
      
      metadata.pagination = {
        type: 'offset',
        total,
        page: currentPage,
        pages: totalPages,
        offset: page.offset,
        limit: page.limit,
        count: items.length,
        ...(hasMore && { hasMore: true }),
        ...(hasNext && { nextCursor: this.generateNextCursor(currentPage) }),
        ...(hasPrev && { prevCursor: this.generatePrevCursor(currentPage) })
      };
    } else if (page.cursor !== undefined) {
      // Cursor-based pagination
      metadata.pagination = {
        type: 'cursor',
        total,
        count: items.length,
        cursor: page.cursor,
        ...(items.length > 0 && {
          nextCursor: this.generateNextCursor(1) // cursor 기반에서는 페이지 개념 없음
        })
      };
    } else if (page.limit !== undefined) {
      // Limit only
      const hasMore = items.length === page.limit && total > page.limit;
      
      metadata.pagination = {
        type: 'limit',
        total,
        limit: page.limit,
        count: items.length,
        ...(hasMore && { hasMore: true })
      };
    }

    return metadata;
  }

  /**
   * 다음 커서 생성 (페이지 번호를 base64로 인코딩)
   */
  private static generateNextCursor(currentPage: number): string {
    try {
      const cursorData = { page: currentPage + 1 };
      return Buffer.from(JSON.stringify(cursorData)).toString('base64');
    } catch (error) {
      return '';
    }
  }

  /**
   * 이전 커서 생성 (페이지 번호를 base64로 인코딩)
   */
  private static generatePrevCursor(currentPage: number): string {
    if (currentPage <= 1) return '';
    
    try {
      const cursorData = { page: currentPage - 1 };
      return Buffer.from(JSON.stringify(cursorData)).toString('base64');
    } catch (error) {
      return '';
    }
  }

  /**
   * 표준 CRUD 응답 포맷
   */
  static formatResponse(
    data: any, 
    metadata?: any,
    operation: string = 'index',
    includedRelations?: string[],
    queryParams?: CrudQueryParams  // 추가: 쿼리 파라미터에서 자동으로 include 추출
  ) {
    // includedRelations가 없으면 queryParams에서 추출
    const finalIncludedRelations = includedRelations || queryParams?.include;
    
    // 기본 메타데이터가 없는 경우 기본값 생성
    if (!metadata && Array.isArray(data)) {
      metadata = this.createPaginationMeta(
        data, 
        data.length, 
        queryParams?.page, 
        operation, 
        finalIncludedRelations,
        queryParams
      );
    }

    // operation에 따라 적절한 카운트 필드 결정
    const isModifyOperation = ['create', 'update', 'delete', 'upsert'].includes(operation);

    return {
      data,
      metadata: metadata || {
        operation,
        timestamp: new Date().toISOString(),
        ...(isModifyOperation 
          ? { affectedCount: Array.isArray(data) ? data.length : 1 }  // 생성/수정/삭제 작업
          : { count: Array.isArray(data) ? data.length : 1 }          // 조회 작업
        ),
        ...(finalIncludedRelations && finalIncludedRelations.length > 0 && {
          includedRelations: finalIncludedRelations
        })
      },
      success: true
    };
  }

  /**
   * 에러 응답 포맷 (통합 ErrorHandler 사용)
   */
  static formatError(
    message: string, 
    code?: string, 
    details?: any,
    operation: string = 'unknown',
    securityOptions?: ErrorSecurityOptions
  ) {
    const error = new Error(message);
    (error as any).code = code;
    (error as any).meta = details;

    return ErrorHandler.handleError(error, {
      format: ErrorResponseFormat.CRUD,
      context: {
        operation,
        code: code || 'UNKNOWN_ERROR'
      },
      security: securityOptions
    });
  }

  /**
   * 에러 세부 정보 보안 처리
   */
  private static sanitizeErrorDetail(
    message: string,
    details: any,
    options: {
      isDevelopment: boolean;
      sanitizeDetails: boolean;
      maxDetailLength: number;
    }
  ): { message: string; details: any } {
    // 개발 모드에서는 원본 정보 그대로 반환
    if (options.isDevelopment && !options.sanitizeDetails) {
      return {
        message: CrudResponseFormatter.truncateMessage(message, options.maxDetailLength),
        details: details || null
      };
    }

    // 프로덕션 모드에서는 보안을 위해 정보 제한
    const sanitizedMessage = CrudResponseFormatter.sanitizePrismaError(message);
    const sanitizedDetails = CrudResponseFormatter.sanitizeDetails(details);

    return {
      message: CrudResponseFormatter.truncateMessage(sanitizedMessage, options.maxDetailLength),
      details: sanitizedDetails
    };
  }

  /**
   * 에러 메시지 보안 처리 (구조적 접근법)
   */
  static sanitizePrismaError(message: string): string {
    // 1. 라이브러리별 에러 처리기 적용
    let sanitizedMessage = this.applyLibrarySpecificSanitizers(message);
    
    // 2. 일반적인 민감한 정보 제거
    sanitizedMessage = this.removeSensitiveInformation(sanitizedMessage);
    
    return sanitizedMessage;
  }

  /**
   * 라이브러리별 에러 처리기 적용
   */
  private static applyLibrarySpecificSanitizers(message: string): string {
    const sanitizers = [
      this.sanitizePrismaSpecificErrors
    ];

    let result = message;
    for (const sanitizer of sanitizers) {
      result = sanitizer(result);
    }

    return result;
  }

  /**
   * Prisma 특화 에러 처리
   */
  private static sanitizePrismaSpecificErrors(message: string): string {
    // Prisma 에러인지 확인
    if (!message.includes('Prisma') && !message.includes('prisma')) {
      return message;
    }

    const prismaErrorMappings = new Map([
      ['PrismaClientValidationError', 'Validation error occurred'],
      ['PrismaClientKnownRequestError', 'Database operation failed'],
      ['PrismaClientUnknownRequestError', 'Database request failed'],
      ['PrismaClientRustPanicError', 'Database engine error'],
      ['PrismaClientInitializationError', 'Database connection error'],
      ['Invalid.*invocation', 'Invalid request parameters'],
      ['Argument `[^`]+` is missing', 'Required parameter is missing'],
      ['Unknown argument `[^`]+`', 'Invalid parameter provided'],
      ['Unique constraint failed on the fields: \\(`[^`]+`\\)', 'Duplicate entry detected'],
      ['Foreign key constraint failed', 'Related record not found'],
      ['Record to (update|delete) does not exist', 'Record not found'],
      ['Database connection string is invalid', 'Database configuration error'],
      ['Query interpretation error', 'Query processing error']
    ]);

    let sanitized = message;
    for (const [pattern, replacement] of prismaErrorMappings) {
      const regex = new RegExp(pattern, 'gi');
      sanitized = sanitized.replace(regex, replacement);
    }

    return sanitized;
  }

  /**
   * 일반적인 민감한 정보 제거
   */
  private static removeSensitiveInformation(message: string): string {
    const sensitivePatternCategories = {
      // 데이터베이스 연결 문자열
      connectionStrings: [
        /postgres:\/\/[^\s]+/gi,
        /mysql:\/\/[^\s]+/gi,
        /mongodb:\/\/[^\s]+/gi,
        /sqlite:[^\s]+/gi,
        /mssql:\/\/[^\s]+/gi,
        /oracle:\/\/[^\s]+/gi
      ],
      
      // 인증 정보
      credentials: [
        /password=[^\s&]+/gi,
        /pwd=[^\s&]+/gi,
        /token=[^\s&]+/gi,
        /api[_-]?key=[^\s&]+/gi,
        /secret=[^\s&]+/gi,
        /bearer\s+[^\s]+/gi,
        /authorization:\s*[^\s]+/gi
      ],
      
      // 파일 경로
      filePaths: [
        /\/[a-zA-Z]:[^\s]*\.(db|sqlite|mdb)/gi,  // 윈도우 DB 파일
        /\/home\/[^\s]*/gi,                       // 리눅스 홈 디렉토리
        /\/Users\/[^\s]*/gi,                      // macOS 사용자 디렉토리
        /C:\\Users\\[^\s]*/gi,                    // 윈도우 사용자 디렉토리
        /\/var\/lib\/[^\s]*/gi,                   // 시스템 라이브러리 경로
        /\/opt\/[^\s]*/gi                         // 옵셔널 소프트웨어 경로
      ],
      
      // 스택 트레이스 (프로덕션에서만)
      stackTrace: process.env.NODE_ENV === 'production' ? [
        /at .+:\d+:\d+/gi,
        /\s+at\s+[^\n]+/gi,
        /\(\/.+:\d+:\d+\)/gi
      ] : [],
      
      // IP 주소 및 포트
      networkInfo: [
        /\b(?:\d{1,3}\.){3}\d{1,3}:\d+\b/gi,     // IP:Port
        /localhost:\d+/gi,                        // localhost:port
        /127\.0\.0\.1:\d+/gi                      // 127.0.0.1:port
      ]
    };

    let sanitized = message;
    
    // 각 카테고리별로 민감한 정보 제거
    Object.entries(sensitivePatternCategories).forEach(([category, patterns]) => {
      patterns.forEach(pattern => {
        sanitized = sanitized.replace(pattern, `[${category.toUpperCase()}_REDACTED]`);
      });
    });

    return sanitized;
  }

  /**
   * 에러 상세 정보 보안 처리 (구조적 접근법)
   */
  static sanitizeDetails(details: any): any {
    if (!details || typeof details !== 'object') {
      return null;
    }

    // 라이브러리별 상세 정보 처리기
    const detailsSanitizers = [
      this.sanitizePrismaDetails,
      this.sanitizeSequelizeDetails,
      this.sanitizeMongooseDetails,
      this.sanitizeTypeORMDetails
    ];

    let sanitizedDetails = { ...details };

    // 각 라이브러리별 처리기 적용
    for (const sanitizer of detailsSanitizers) {
      sanitizedDetails = sanitizer(sanitizedDetails);
    }

    // 일반적인 보안 처리 적용
    sanitizedDetails = this.applyGenericDetailsSecurity(sanitizedDetails);

    // 빈 객체인 경우 null 반환
    return Object.keys(sanitizedDetails).length > 0 ? sanitizedDetails : null;
  }

  /**
   * Prisma 상세 정보 보안 처리
   */
  private static sanitizePrismaDetails(details: any): any {
    const allowedPrismaFields = [
      'type', 'field', 'constraint', 'table', 'model', 
      'operation', 'count', 'affected', 'target'
    ];

    const sanitized: any = {};

    // Prisma 관련 필드만 허용
    for (const field of allowedPrismaFields) {
      if (details[field] !== undefined) {
        sanitized[field] = details[field];
      }
    }

    // Prisma 에러 코드 매핑
    if (details.code) {
      sanitized.errorCode = this.mapPrismaSpecificCodes(details.code);
    }

    // Prisma 메타 정보 처리
    if (details.meta && typeof details.meta === 'object') {
      sanitized.meta = this.sanitizePrismaMetaInfo(details.meta);
    }

    return sanitized;
  }

  /**
   * Prisma 메타 정보 보안 처리
   */
  private static sanitizePrismaMetaInfo(meta: any): any {
    const allowedMetaFields = [
      'target', 'field_name', 'constraint_type', 
      'database_error', 'table_name', 'column_name'
    ];

    const sanitizedMeta: any = {};

    for (const field of allowedMetaFields) {
      if (meta[field] !== undefined) {
        // 민감한 정보 제거 후 추가
        sanitizedMeta[field] = this.sanitizeMetaValue(meta[field]);
      }
    }

    return Object.keys(sanitizedMeta).length > 0 ? sanitizedMeta : undefined;
  }

  /**
   * Sequelize 상세 정보 보안 처리
   */
  private static sanitizeSequelizeDetails(details: any): any {
    const allowedSequelizeFields = [
      'name', 'message', 'type', 'sql', 'errno', 'sqlState', 
      'index', 'parent', 'original', 'fields'
    ];

    const sanitized: any = {};

    for (const field of allowedSequelizeFields) {
      if (details[field] !== undefined) {
        // SQL 쿼리는 민감한 정보 제거 후 추가
        if (field === 'sql') {
          sanitized[field] = this.sanitizeSqlQuery(details[field]);
        } else {
          sanitized[field] = details[field];
        }
      }
    }

    return sanitized;
  }

  /**
   * Mongoose 상세 정보 보안 처리
   */
  private static sanitizeMongooseDetails(details: any): any {
    const allowedMongooseFields = [
      'name', 'message', 'kind', 'path', 'value', 
      'reason', 'properties', 'errors'
    ];

    const sanitized: any = {};

    for (const field of allowedMongooseFields) {
      if (details[field] !== undefined) {
        sanitized[field] = details[field];
      }
    }

    return sanitized;
  }

  /**
   * TypeORM 상세 정보 보안 처리
   */
  private static sanitizeTypeORMDetails(details: any): any {
    const allowedTypeORMFields = [
      'name', 'message', 'query', 'parameters', 'driverError',
      'length', 'severity', 'code', 'detail', 'hint', 'position',
      'internalQuery', 'where', 'table', 'constraint'
    ];

    const sanitized: any = {};

    for (const field of allowedTypeORMFields) {
      if (details[field] !== undefined) {
        // 쿼리 관련 필드는 민감한 정보 제거
        if (['query', 'internalQuery'].includes(field)) {
          sanitized[field] = this.sanitizeSqlQuery(details[field]);
        } else {
          sanitized[field] = details[field];
        }
      }
    }

    return sanitized;
  }

  /**
   * 일반적인 상세 정보 보안 처리
   */
  private static applyGenericDetailsSecurity(details: any): any {
    const sanitized = { ...details };

    // 민감한 필드 제거
    const sensitiveFields = [
      'password', 'pwd', 'token', 'apiKey', 'secret', 'authorization',
      'connectionString', 'host', 'port', 'username', 'user',
      'stack', 'stackTrace', 'trace'
    ];

    for (const field of sensitiveFields) {
      delete sanitized[field];
    }

    // 중첩된 객체 처리
    Object.keys(sanitized).forEach(key => {
      if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        if (Array.isArray(sanitized[key])) {
          // 배열인 경우: 각 요소 처리
          sanitized[key] = sanitized[key].map((item: any) => 
            typeof item === 'object' ? this.applyGenericDetailsSecurity(item) : item
          );
        } else {
          // 객체인 경우: 재귀적 처리
          sanitized[key] = this.applyGenericDetailsSecurity(sanitized[key]);
        }
      }
    });

    return sanitized;
  }

  /**
   * SQL 쿼리 민감한 정보 제거
   */
  private static sanitizeSqlQuery(sql: string): string {
    if (typeof sql !== 'string') {
      return sql;
    }

    // SQL에서 민감한 정보 패턴 제거
    const sqlPatterns = [
      /password\s*=\s*['"][^'"]*['"]/gi,
      /pwd\s*=\s*['"][^'"]*['"]/gi,
      /token\s*=\s*['"][^'"]*['"]/gi,
      /secret\s*=\s*['"][^'"]*['"]/gi,
      /'[^']*password[^']*'/gi,
      /"[^"]*password[^"]*"/gi
    ];

    let sanitizedSql = sql;
    for (const pattern of sqlPatterns) {
      sanitizedSql = sanitizedSql.replace(pattern, '[REDACTED_SQL_VALUE]');
    }

    return sanitizedSql;
  }

  /**
   * 메타 값 민감한 정보 제거
   */
  private static sanitizeMetaValue(value: any): any {
    if (typeof value === 'string') {
      return this.removeSensitiveInformation(value);
    }
    
    if (typeof value === 'object' && value !== null) {
      return this.applyGenericDetailsSecurity(value);
    }

    return value;
  }

  /**
   * 에러 코드를 일반적인 설명으로 매핑 (구조적 접근법)
   */
  static mapPrismaErrorCode(code: string): string {

    // 라이브러리별 에러 코드 매핑
    const errorCodeMappers = [
      this.mapPrismaSpecificCodes,
    ];

    for (const mapper of errorCodeMappers) {
      const mapped = mapper(code);
      if (mapped !== code) {
        return mapped; // 매핑이 성공한 경우
      }
    }

    // 일반적인 HTTP 상태 코드 처리
    return this.mapGenericErrorCodes(code);
  }


  /**
   * Prisma 특화 에러 코드 매핑
   */
  private static mapPrismaSpecificCodes(code: string): string {
    const prismaCodeMap = new Map([
      // 데이터 관련 에러
      ['P2001', PRISMA_ERROR_CODES.RECORD_NOT_FOUND],
      ['P2002', PRISMA_ERROR_CODES.UNIQUE_CONSTRAINT_VIOLATION],
      ['P2003', PRISMA_ERROR_CODES.FOREIGN_KEY_CONSTRAINT_VIOLATION],
      ['P2004', PRISMA_ERROR_CODES.CONSTRAINT_VIOLATION],
      ['P2005', PRISMA_ERROR_CODES.INVALID_VALUE],
      ['P2006', PRISMA_ERROR_CODES.INVALID_VALUE],
      ['P2007', PRISMA_ERROR_CODES.DATA_VALIDATION_ERROR],
      
      // 쿼리 관련 에러
      ['P2008', PRISMA_ERROR_CODES.QUERY_PARSING_ERROR],
      ['P2009', PRISMA_ERROR_CODES.QUERY_VALIDATION_ERROR],
      ['P2010', PRISMA_ERROR_CODES.RAW_QUERY_ERROR],
      ['P2016', PRISMA_ERROR_CODES.QUERY_INTERPRETATION_ERROR],
      
      // 제약 조건 에러
      ['P2011', PRISMA_ERROR_CODES.NULL_CONSTRAINT_VIOLATION],
      ['P2012', ERROR_CODES.MISSING_REQUIRED_FIELD],
      ['P2013', ERROR_CODES.MISSING_REQUIRED_FIELD],
      ['P2014', PRISMA_ERROR_CODES.RELATIONSHIP_VIOLATION],
      ['P2015', ERROR_CODES.RELATIONSHIP_NOT_FOUND],
      ['P2017', PRISMA_ERROR_CODES.RELATIONSHIP_VIOLATION],
      ['P2018', ERROR_CODES.RELATIONSHIP_NOT_FOUND],
      
      // 입력 관련 에러
      ['P2019', ERROR_CODES.VALIDATION_ERROR],
      ['P2020', PRISMA_ERROR_CODES.VALUE_OUT_OF_RANGE],
      ['P2033', PRISMA_ERROR_CODES.VALUE_OUT_OF_RANGE],
      
      // 스키마 관련 에러
      ['P2021', PRISMA_ERROR_CODES.TABLE_NOT_FOUND],
      ['P2022', PRISMA_ERROR_CODES.COLUMN_NOT_FOUND],
      ['P2023', PRISMA_ERROR_CODES.INCONSISTENT_COLUMN_DATA],
      
      // 연결 및 성능 에러
      ['P2024', PRISMA_ERROR_CODES.CONNECTION_TIMEOUT],
      ['P2025', ERROR_CODES.OPERATION_FAILED],
      ['P2026', ERROR_CODES.OPERATION_NOT_ALLOWED],
      ['P2027', ERROR_CODES.OPERATION_FAILED],
      ['P2028', PRISMA_ERROR_CODES.TRANSACTION_API_ERROR],
      ['P2034', 'TRANSACTION_CONFLICT'],
      
      // 특수 기능 에러
      ['P2030', 'FULLTEXT_INDEX_NOT_FOUND'],
      ['P2031', 'MONGODB_REPLICA_SET_REQUIRED']
    ]);

    return prismaCodeMap.get(code) || code;
  }

  
  /**
   * 일반적인 에러 코드 매핑
   */
  private static mapGenericErrorCodes(code: string): string {
    const genericCodeMap = new Map([
      ['400', 'BAD_REQUEST'],
      ['401', 'UNAUTHORIZED'],
      ['403', 'FORBIDDEN'],
      ['404', 'NOT_FOUND'],
      ['409', 'CONFLICT'],
      ['422', 'UNPROCESSABLE_ENTITY'],
      ['500', 'INTERNAL_SERVER_ERROR'],
      ['502', 'BAD_GATEWAY'],
      ['503', 'SERVICE_UNAVAILABLE'],
      ['504', 'GATEWAY_TIMEOUT']
    ]);

    return genericCodeMap.get(code) || 'UNKNOWN_ERROR';
  }

  /**
   * 메시지 길이 제한 (public static으로 변경)
   */
  static truncateMessage(message: string, maxLength: number): string {
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength - 3) + '...';
  }

  /**
   * CrudQueryParams에서 직접 메타데이터 생성 (편의 메서드)
   */
  static createMetaFromQuery(
    items: any[],
    total: number,
    queryParams: CrudQueryParams,
    operation: string = 'index'
  ) {
    return this.createPaginationMeta(
      items,
      total,
      queryParams.page,
      operation,
      queryParams.include,
      queryParams
    );
  }

  /**
   * CrudQueryParams를 사용한 완전한 응답 포맷 (편의 메서드)
   */
  static formatResponseFromQuery(
    data: any,
    queryParams: CrudQueryParams,
    total?: number,
    operation: string = 'index'
  ) {
    // operation에 따라 적절한 카운트 필드 결정
    const isModifyOperation = ['create', 'update', 'delete', 'upsert'].includes(operation);
    
    const metadata = Array.isArray(data) 
      ? this.createMetaFromQuery(data, total || data.length, queryParams, operation)
      : {
          operation,
          timestamp: new Date().toISOString(),
          ...(isModifyOperation 
            ? { affectedCount: 1 }  // 생성/수정/삭제 작업
            : { count: 1 }          // 조회 작업
          ),
          ...(queryParams.include && queryParams.include.length > 0 && {
            includedRelations: queryParams.include
          })
        };

    return {
      data,
      metadata,
      success: true
    };
  }
}

/**
 * JSON:API 변환 및 포맷팅을 위한 유틸리티 클래스
 */
export class JsonApiTransformer {
  
  /**
   * 원시 데이터를 JSON:API 리소스 객체로 변환
   */
  static transformToResource(
    item: any, 
    resourceType: string, 
    primaryKey: string = 'id',
    fields?: string[],
    baseUrl?: string,
    id?: string,
    includeMerge: boolean = false
  ): JsonApiResource {
    const resourceId = id || item[primaryKey] || item.id || item.uuid || item._id;
    
    if (!resourceId) {
      throw new Error(`Cannot transform to JSON:API resource: missing ${primaryKey} field`);
    }

    // 기본 리소스 객체 생성
    const resource: JsonApiResource = {
      type: resourceType.toLowerCase(),
      id: String(resourceId)
    };

    // attributes와 relationships 분리
    const { attributes, relationships } = this.separateAttributesAndRelationships(
      item, 
      primaryKey, 
      fields,
      includeMerge
    );

    // attributes가 있는 경우에만 추가
    if (Object.keys(attributes).length > 0) {
      resource.attributes = attributes;
    }

    // includeMerge가 false인 경우에만 relationships 추가
    if (!includeMerge && Object.keys(relationships).length > 0) {
      resource.relationships = relationships;
    }

    // 링크 추가
    if (baseUrl) {
      resource.links = {
        self: `${baseUrl}/${resourceId}`
      };
    }

    return resource;
  }

  /**
   * 여러 리소스를 JSON:API 컬렉션으로 변환
   */
  static transformToCollection(
    items: any[], 
    resourceType: string, 
    primaryKey: string = 'id',
    fields?: string[],
    baseUrl?: string,
    includeMerge: boolean = false
  ): JsonApiResource[] {
    return items.map(item => 
      this.transformToResource(item, resourceType, primaryKey, fields, baseUrl, undefined, includeMerge)
    );
  }

  /**
   * JSON:API 에러 응답 생성 (통합 ErrorHandler 사용)
   */
  static createJsonApiErrorResponse(
    error: any,
    options: {
      code?: string;
      status?: number;
      title?: string;
      source?: {
        pointer?: string;
        parameter?: string;
        header?: string;
      };
      securityOptions?: ErrorSecurityOptions;
    } = {}
  ): JsonApiErrorResponse {
    return ErrorHandler.handleError(error, {
      format: ErrorResponseFormat.JSON_API,
      context: {
        code: options.code || 'INTERNAL_ERROR',
        status: options.status || 500,
        title: options.title,
        source: options.source
      },
      security: options.securityOptions
    });
  }


  /**
   * attributes와 relationships 분리
   */
  private static separateAttributesAndRelationships(
    item: any, 
    primaryKey: string, 
    fields?: string[],
    includeMerge: boolean = false
  ): { attributes: Record<string, any>, relationships: Record<string, JsonApiRelationship> } {
    const attributes: Record<string, any> = {};
    const relationships: Record<string, JsonApiRelationship> = {};
    
    // 모든 필드를 복사 (primary key 제외)
    const allFields = { ...item };
    delete allFields[primaryKey];
    
    // primary key가 'id'가 아닌 경우 다른 기본 ID 필드들 제거
    if (primaryKey !== 'id') delete allFields.id;
    if (primaryKey !== 'uuid') delete allFields.uuid;
    if (primaryKey !== '_id') delete allFields._id;

    Object.keys(allFields).forEach(key => {
      const value = allFields[key];
      
      // Sparse Fieldsets 적용 (fields가 지정된 경우)
      if (fields && !fields.includes(key)) {
        return; // 지정된 필드가 아니면 스킵
      }
      
      // 관계 데이터인지 확인
      if (this.isRelationshipData(value)) {
        if (includeMerge) {
          // includeMerge가 true면 관계 데이터를 attributes에 병합
          attributes[key] = value;
        } else {
          // includeMerge가 false면 relationships에 추가 (표준 JSON:API 방식)
          relationships[key] = this.transformToRelationship(value, key);
        }
      } else {
        // 관계 데이터가 아니면 attributes에 추가
        // 빈 배열이면 JSON:API 일관성을 위해 attributes에 추가하지 않음
        if (Array.isArray(value) && value.length === 0) {
          // 빈 배열은 제외하여 일관성 유지
          return;
        }
        attributes[key] = value;
      }
    });

    return { attributes, relationships };
  }

  /**
   * 값이 관계 데이터인지 확인
   */
  private static isRelationshipData(value: any): boolean {
    // null이나 undefined는 관계 데이터가 아님
    if (value === null || value === undefined) {
      return false;
    }
    
    // 배열인 경우: 빈 배열이면 관계 데이터가 아님 (일관성을 위해)
    // 요소가 있고, 첫 번째 요소가 객체이며 id를 가지고 있으면 관계
    if (Array.isArray(value)) {
      return value.length > 0 && 
             typeof value[0] === 'object' && 
             value[0] !== null &&
             (value[0].id || value[0].uuid || value[0]._id);
    }
    
    // 객체인 경우: id를 가지고 있고 Date가 아니면 관계
    if (typeof value === 'object' && !(value instanceof Date)) {
      return !!(value.id || value.uuid || value._id);
    }
    
    return false;
  }

  /**
   * 관계 데이터를 JSON:API 관계 객체로 변환
   */
  private static transformToRelationship(value: any, relationshipName: string): JsonApiRelationship {
    const relationship: JsonApiRelationship = {};

    if (Array.isArray(value)) {
      // 일대다 관계
      relationship.data = value.map(item => ({
        type: this.inferResourceTypeFromRelationship(relationshipName, true),
        id: String(item.id || item.uuid || item._id)
      }));
    } else {
      // 일대일 관계
      relationship.data = {
        type: this.inferResourceTypeFromRelationship(relationshipName, false),
        id: String(value.id || value.uuid || value._id)
      };
    }

    return relationship;
  }

  /**
   * 관계 이름에서 리소스 타입 추론 (public 메서드로 변경)
   */
  static inferResourceTypeFromRelationship(relationshipName: string, isArray: boolean): string {
    let resourceType = relationshipName;
    
    if (isArray) {
      // 복수형에서 단수형으로 변환 (간단한 규칙)
      if (relationshipName.endsWith('ies')) {
        resourceType = relationshipName.slice(0, -3) + 'y'; // categories -> category
      } else if (relationshipName.endsWith('s')) {
        resourceType = relationshipName.slice(0, -1); // orderItems -> orderItem
      }
    }
    
    // JSON:API 스펙에 따라 소문자로 변환
    return resourceType.toLowerCase();
  }

  /**
   * 공통 JSON:API 기본 구조 생성 헬퍼
   */
  private static createBaseJsonApiStructure(): any {
    return {
      jsonapi: {
        version: "1.1",
        // ext: ["https://jsonapi.org/ext/atomic"],
        // profile: ["https://jsonapi.org/profiles/ethanresnick/cursor-pagination/"],
        meta: {
          implementation: "express.js-kusto v2.0",
          // implementedFeatures: [
          //   "sparse-fieldsets",
          //   "compound-documents", 
          //   "resource-relationships",
          //   "pagination",
          //   "sorting",
          //   "filtering",
          //   "atomic-operations",
          //   "content-negotiation",
          //   "resource-identification"
          // ],
          // supportedExtensions: [
          //   "https://jsonapi.org/ext/atomic"
          // ],
          // supportedProfiles: [
          //   "https://jsonapi.org/profiles/ethanresnick/cursor-pagination/"
          // ]
        }
      }
    };
  }

  /**
   * 완전한 JSON:API 응답 객체 생성 - Meta 정보 개선
   */
  static createJsonApiResponse(
    data: any | any[], 
    resourceType: string,
    options: {
      primaryKey?: string;
      fields?: Record<string, string[]>;
      include?: string[];
      baseUrl?: string;
      links?: JsonApiLinks;
      meta?: Record<string, any>;
      included?: JsonApiResource[];
      query?: any; // 요청 쿼리 정보 추가
      includeMerge?: boolean; // includeMerge 옵션 추가
    } = {}
  ): JsonApiResponse {
    const {
      primaryKey = 'id',
      fields,
      baseUrl,
      links,
      meta,
      included,
      query,
      includeMerge = false // 기본값: false (표준 JSON:API 방식)
    } = options;

    // 현재 리소스 타입의 필드 제한
    const resourceFields = fields?.[resourceType.toLowerCase()];

    let jsonApiData: JsonApiResource | JsonApiResource[] | null = null;

    if (data === null || data === undefined) {
      jsonApiData = null;
    } else if (Array.isArray(data)) {
      jsonApiData = this.transformToCollection(
        data, 
        resourceType, 
        primaryKey, 
        resourceFields, 
        baseUrl,
        includeMerge
      );
    } else {
      jsonApiData = this.transformToResource(
        data, 
        resourceType, 
        primaryKey, 
        resourceFields, 
        baseUrl,
        undefined, // id 파라미터
        includeMerge
      );
    }

    const baseStructure = this.createBaseJsonApiStructure();
    const response: JsonApiResponse = {
      ...baseStructure,
      data: jsonApiData
    };

    // includeMerge가 false인 경우에만 included 필드 추가
    if (!includeMerge && included && included.length > 0) {
      response.included = included;
    }

    if (links) {
      response.links = links;
    }

    if (meta) {
      // 기본 메타 정보와 사용자 정의 메타 정보 병합
      response.meta = {
        timestamp: new Date().toISOString(),
        ...(query && {
          requestInfo: {
            fields: query.fields,
            include: query.include,
            sort: query.sort,
            filter: query.filter,
            page: query.page
          }
        }),
        ...meta
      };
    }

    return response;
  }

  /**
   * 포함된 리소스(included) 생성
   */
  static createIncludedResources(
    data: any | any[],
    includeParams: string[],
    fieldsParams?: Record<string, string[]>,
    baseUrl?: string
  ): JsonApiResource[] {
    const included: JsonApiResource[] = [];
    const processedResources = new Set<string>(); // 중복 방지

    const dataArray = Array.isArray(data) ? data : [data];

    dataArray.forEach(item => {
      includeParams.forEach(includePath => {
        this.extractIncludedResources(
          item, 
          includePath, 
          included, 
          processedResources, 
          fieldsParams, 
          baseUrl
        );
      });
    });

    return included;
  }

  /**
   * 중첩된 포함 리소스 추출
   */
  private static extractIncludedResources(
    item: any,
    includePath: string,
    included: JsonApiResource[],
    processedResources: Set<string>,
    fieldsParams?: Record<string, string[]>,
    baseUrl?: string
  ): void {
    const pathParts = includePath.split('.');
    
    // 재귀적으로 중첩된 관계 처리
    this.processNestedIncludes(item, pathParts, 0, included, processedResources, fieldsParams, baseUrl);
  }

  /**
   * 중첩된 include 경로를 재귀적으로 처리
   */
  private static processNestedIncludes(
    currentData: any,
    pathParts: string[],
    currentIndex: number,
    included: JsonApiResource[],
    processedResources: Set<string>,
    fieldsParams?: Record<string, string[]>,
    baseUrl?: string
  ): void {
    if (currentIndex >= pathParts.length || !currentData) {
      return;
    }

    const relationName = pathParts[currentIndex];
    const relationData = currentData[relationName];

    if (!relationData) {
      return;
    }

    const resourceType = this.inferResourceTypeFromRelationship(relationName, Array.isArray(relationData));
    const resourceFields = fieldsParams?.[resourceType];
    const isLastPart = currentIndex === pathParts.length - 1;

    if (Array.isArray(relationData)) {
      relationData.forEach(relItem => {
        if (!relItem) return;

        const resourceKey = `${resourceType}:${relItem.id || relItem.uuid || relItem._id}`;
        
        // 현재 레벨의 리소스를 included에 추가
        if (!processedResources.has(resourceKey)) {
          processedResources.add(resourceKey);
          included.push(this.transformToResource(
            relItem, 
            resourceType, 
            'id', 
            resourceFields, 
            baseUrl
          ));
        }

        // 마지막 부분이 아니면 재귀적으로 다음 레벨 처리
        if (!isLastPart) {
          this.processNestedIncludes(
            relItem, 
            pathParts, 
            currentIndex + 1, 
            included, 
            processedResources, 
            fieldsParams, 
            baseUrl
          );
        }
      });
    } else {
      const resourceKey = `${resourceType}:${relationData.id || relationData.uuid || relationData._id}`;
      
      // 현재 레벨의 리소스를 included에 추가
      if (!processedResources.has(resourceKey)) {
        processedResources.add(resourceKey);
        included.push(this.transformToResource(
          relationData, 
          resourceType, 
          'id', 
          resourceFields, 
          baseUrl
        ));
      }

      // 마지막 부분이 아니면 재귀적으로 다음 레벨 처리
      if (!isLastPart) {
        this.processNestedIncludes(
          relationData, 
          pathParts, 
          currentIndex + 1, 
          included, 
          processedResources, 
          fieldsParams, 
          baseUrl
        );
      }
    }
  }
}
