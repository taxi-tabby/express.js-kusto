import { Request } from 'express';

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
  static parseQuery(req: Request): CrudQueryParams {
    const query = req.query;
    
    return {
      include: this.parseInclude(query.include as string),
      select: this.parseSelect(query.select as string),
      fields: this.parseFields(query),
      sort: this.parseSort(query.sort as string),
      page: this.parsePage(query),
      filter: this.parseFilter(query)
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
   */
  private static parseFilter(query: any): Record<string, any> | undefined {
    const filters: Record<string, any> = {};
    
    // 1. 중첩 객체 형태 처리 (Express에서 filter[key]=value를 { filter: { key: value } }로 파싱하는 경우)
    if (query.filter && typeof query.filter === 'object') {
      Object.entries(query.filter).forEach(([filterExpression, value]) => {
        const parsed = this.parseFilterExpression(filterExpression, value);
        
        if (parsed) {
          filters[parsed.field] = {
            ...filters[parsed.field],
            [parsed.operator]: parsed.value
          };
        }
      });
    }
    
    // 2. 평면 키 형태 처리 (filter[key]=value)
    Object.keys(query).forEach(key => {
      const match = key.match(/^filter\[(.+)\]$/);
      if (match) {
        const filterExpression = match[1];
        const value = query[key];
        
        // Parse field and operator
        const parsed = this.parseFilterExpression(filterExpression, value);
        if (parsed) {
          filters[parsed.field] = {
            ...filters[parsed.field],
            [parsed.operator]: parsed.value
          };
        }
      }
    });

    return Object.keys(filters).length > 0 ? filters : undefined;
  }

  /**
   * 필터 표현식 파싱 (field_operator 형태)
   * 관계 필터링도 지원: author.name_like, tags.name_in 등
   */
  private static parseFilterExpression(expression: string, value: any) {
    const operators = [
      'not_null', 'not_in', 'between', 'present', 'blank', 'elemMatch',
      'ilike', 'like', 'start', 'end', 'contains', 'regex', 'exists', 'size', 'all',
      'gte', 'lte', 'gt', 'lt', 'ne', 'eq', 'in', 'null'
    ];

    for (const op of operators) {
      if (expression.endsWith('_' + op)) {
        const field = expression.slice(0, -(op.length + 1));
        const parsedValue = this.parseFilterValue(op as FilterOperator, value);
        
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
      value: this.parseFilterValue(autoDetectedOperator, value)
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
  private static parseFilterValue(operator: FilterOperator, value: any): any {
    if (value === null || value === undefined) return value;

    switch (operator) {
      case 'in':
      case 'not_in':
        if (typeof value === 'string') {
          return value.split(',')
            .map(v => v.trim())
            .filter(v => v.length > 0); // 빈 문자열 제거
        }
        return Array.isArray(value) ? value.filter(v => v !== '' && v != null) : value;
      
      case 'between':
        if (typeof value === 'string') {
          const parts = value.split(',')
            .map(v => v.trim())
            .filter(v => v.length > 0); // 빈 문자열 제거
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
        return this.smartTypeConversion(value);
    }
  }

  /**
   * 스마트 타입 변환: 값의 패턴을 분석하여 적절한 타입으로 변환
   */
  private static smartTypeConversion(value: any): any {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'string') return value;

    // 날짜 패턴 감지 및 변환
    if (this.isDatePattern(value)) {
      return this.convertToDate(value);
    }

    // 숫자 패턴 감지 (순수 숫자만)
    if (this.isPureNumber(value)) {
      return Number(value);
    }

    // boolean 패턴
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

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
      // 관계 필드 정렬 처리 (author.name, category.title 등)
      if (sort.field.includes('.')) {
        return this.buildNestedOrderBy(sort.field, sort.direction);
      } else {
        // 일반 필드 정렬
        return { [sort.field]: sort.direction };
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
   * Where 옵션 빌드 (관계 필터링 지원)
   */
  private static buildWhereOptions(filters: Record<string, any>) {
    const where: any = {};

    Object.entries(filters).forEach(([field, conditions]) => {
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
    });

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
   * 에러 응답 포맷
   */
  static formatError(
    message: string, 
    code?: string, 
    details?: any,
    operation: string = 'unknown'
  ) {
    return {
      error: {
        message,
        code: code || 'UNKNOWN_ERROR',
        details: details || null
      },
      metadata: {
        operation,
        timestamp: new Date().toISOString(),
        affectedCount: 0
      },
      success: false
    };
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
