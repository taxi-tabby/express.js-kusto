/**
 * 직렬화 유틸리티
 * BigInt와 기타 직렬화 불가능한 타입들을 처리합니다.
 */

/**
 * BigInt를 문자열로 변환하는 직렬화 함수
 * 중첩된 객체와 배열도 재귀적으로 처리합니다.
 */
export function serializeBigInt(obj: any): any {
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    if (typeof obj === 'bigint') {
        return obj.toString();
    }
    
    if (Array.isArray(obj)) {
        return obj.map(serializeBigInt);
    }
    
    if (typeof obj === 'object') {
        const serialized: any = {};
        for (const [key, value] of Object.entries(obj)) {
            serialized[key] = serializeBigInt(value);
        }
        return serialized;
    }
    
    return obj;
}

/**
 * Date 객체를 ISO 문자열로 변환하는 직렬화 함수
 */
export function serializeDate(obj: any): any {
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    if (obj instanceof Date) {
        return obj.toISOString();
    }
    
    if (Array.isArray(obj)) {
        return obj.map(serializeDate);
    }
    
    if (typeof obj === 'object') {
        const serialized: any = {};
        for (const [key, value] of Object.entries(obj)) {
            serialized[key] = serializeDate(value);
        }
        return serialized;
    }
    
    return obj;
}

/**
 * 모든 직렬화를 한번에 처리하는 통합 함수
 * BigInt -> string, Date -> ISO string
 */
export function serialize(obj: any): any {
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    if (typeof obj === 'bigint') {
        return obj.toString();
    }
    
    if (obj instanceof Date) {
        return obj.toISOString();
    }
    
    if (Array.isArray(obj)) {
        return obj.map(serialize);
    }
    
    if (typeof obj === 'object') {
        const serialized: any = {};
        for (const [key, value] of Object.entries(obj)) {
            serialized[key] = serialize(value);
        }
        return serialized;
    }
    
    return obj;
}

/**
 * Express 미들웨어용 JSON replacer 함수
 * JSON.stringify의 두 번째 인자로 사용
 */
export function jsonReplacer(key: string, value: any): any {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    return value;
}

/**
 * Express 응답 데이터를 안전하게 직렬화하는 헬퍼
 */
export function safeJsonResponse(data: any): string {
    return JSON.stringify(data, jsonReplacer);
}
