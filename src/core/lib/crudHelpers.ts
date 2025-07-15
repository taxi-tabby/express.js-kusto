import { Request } from 'express';

/**
 * CRUD 쿼리 파싱 및 필터링을 위한 헬퍼 유틸리티
 */

export interface CrudQueryParams {
  include?: string[];
  select?: string[];  // 필드 선택 파라미터 추가
  sort?: SortParam[];
  page?: PageParam;
  filter?: Record<string, any>;
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
  | 'null' | 'not_null' | 'present' | 'blank';

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
      'not_null', 'not_in', 'between', 'present', 'blank',
      'ilike', 'like', 'start', 'end', 'contains',
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
        // Try to parse as number if possible
        if (typeof value === 'string' && !isNaN(Number(value))) {
          return Number(value);
        }
        return value;
    }
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
