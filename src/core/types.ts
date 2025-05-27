// 타입 정의 파일
export * from './lib/validator';
export * from './lib/requestHandler';

// 편의 타입들
import { Schema, FieldSchema } from './lib/validator';
import { RequestConfig, ResponseConfig } from './lib/requestHandler';

// 자주 사용되는 스키마 패턴들
export const CommonSchemas = {
    // ID 파라미터
    id: { type: 'number' as const, required: true, min: 1 },
    
    // 페이지네이션
    pagination: {
        page: { type: 'number' as const, required: false, min: 1 },
        limit: { type: 'number' as const, required: false, min: 1, max: 100 },
        offset: { type: 'number' as const, required: false, min: 0 }
    },
    
    // 사용자 관련
    user: {
        name: { type: 'string' as const, required: true, min: 2, max: 50 },
        email: { type: 'email' as const, required: true },
        age: { type: 'number' as const, required: false, min: 0, max: 120 },
        active: { type: 'boolean' as const, required: false }
    },
    
    // 날짜 관련
    dateRange: {
        startDate: { type: 'string' as const, required: false, pattern: /^\d{4}-\d{2}-\d{2}$/ },
        endDate: { type: 'string' as const, required: false, pattern: /^\d{4}-\d{2}-\d{2}$/ }
    },
    
    // 검색 관련
    search: {
        q: { type: 'string' as const, required: false, min: 1, max: 100 },
        sort: { type: 'string' as const, required: false, enum: ['asc', 'desc'] },
        sortBy: { type: 'string' as const, required: false }
    }
};

// 헬퍼 함수들
export const SchemaHelpers = {
    /**
     * 여러 스키마를 합치는 함수
     */
    merge: (...schemas: Schema[]): Schema => {
        return Object.assign({}, ...schemas);
    },
    
    /**
     * 스키마의 필드를 옵셔널로 만드는 함수
     */
    makeOptional: (schema: Schema): Schema => {
        const result: Schema = {};
        for (const [key, field] of Object.entries(schema)) {
            result[key] = { ...field, required: false };
        }
        return result;
    },
    
    /**
     * 스키마의 필드를 필수로 만드는 함수
     */
    makeRequired: (schema: Schema, fields: string[]): Schema => {
        const result: Schema = { ...schema };
        for (const field of fields) {
            if (result[field]) {
                result[field] = { ...result[field], required: true };
            }
        }
        return result;
    },
    
    /**
     * 스키마에서 특정 필드만 선택하는 함수
     */
    pick: (schema: Schema, fields: string[]): Schema => {
        const result: Schema = {};
        for (const field of fields) {
            if (schema[field]) {
                result[field] = schema[field];
            }
        }
        return result;
    },
    
    /**
     * 스키마에서 특정 필드를 제외하는 함수
     */
    omit: (schema: Schema, fields: string[]): Schema => {
        const result: Schema = { ...schema };
        for (const field of fields) {
            delete result[field];
        }
        return result;
    }
};

// 일반적인 응답 스키마들
export const ResponseSchemas = {
    // 기본 성공 응답
    success: {
        message: { type: 'string' as const, required: true }
    },
    
    // 생성 응답
    created: {
        id: { type: 'number' as const, required: true },
        createdAt: { type: 'string' as const, required: true }
    },
    
    // 업데이트 응답
    updated: {
        id: { type: 'number' as const, required: true },
        updatedAt: { type: 'string' as const, required: true }
    },
    
    // 삭제 응답
    deleted: {
        id: { type: 'number' as const, required: true },
        deletedAt: { type: 'string' as const, required: true }
    },
    
    // 페이지네이션 메타
    paginationMeta: {
        page: { type: 'number' as const, required: true },
        limit: { type: 'number' as const, required: true },
        total: { type: 'number' as const, required: true },
        totalPages: { type: 'number' as const, required: true }
    }
};
