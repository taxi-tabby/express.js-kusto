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
 * BigInt -> string, Date -> ISO string, Prisma Date objects -> date string
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
    
    // Prisma의 @db.Date 타입 처리 - 빈 객체이지만 내부적으로 날짜 데이터를 가지고 있음
    if (typeof obj === 'object' && obj.constructor === Object) {
        // 빈 객체이지만 Date 프로토타입 메서드가 있는 경우 (Prisma Date)
        if (Object.keys(obj).length === 0 && typeof obj.valueOf === 'function') {
            try {
                const dateValue = obj.valueOf();
                if (typeof dateValue === 'number' || dateValue instanceof Date) {
                    const date = new Date(dateValue);
                    if (!isNaN(date.getTime())) {
                        // DATE 타입은 시간 정보 없이 날짜만 반환 (YYYY-MM-DD 형식)
                        return date.toISOString().split('T')[0];
                    }
                }
            } catch (e) {
                // valueOf() 실패 시 원본 반환
            }
        }
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
 * Prisma Date 객체를 감지하고 처리하는 전용 함수
 */
export function serializePrismaDate(obj: any): any {
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    // Prisma Date 객체 감지 및 처리
    if (typeof obj === 'object' && obj.constructor === Object && Object.keys(obj).length === 0) {
        try {
            // 객체의 프로토타입에서 날짜 정보 추출 시도
            const objStr = obj.toString();
            if (objStr && objStr !== '[object Object]') {
                const date = new Date(objStr);
                if (!isNaN(date.getTime())) {
                    return date.toISOString().split('T')[0]; // YYYY-MM-DD 형식
                }
            }
            
            // valueOf 메서드 시도
            if (typeof obj.valueOf === 'function') {
                const dateValue = obj.valueOf();
                if (typeof dateValue === 'number' || dateValue instanceof Date) {
                    const date = new Date(dateValue);
                    if (!isNaN(date.getTime())) {
                        return date.toISOString().split('T')[0];
                    }
                }
            }
        } catch (e) {
            // 변환 실패 시 원본 반환
        }
    }
    
    if (obj instanceof Date) {
        return obj.toISOString().split('T')[0]; // DATE 타입은 날짜만
    }
    
    if (Array.isArray(obj)) {
        return obj.map(serializePrismaDate);
    }
    
    if (typeof obj === 'object') {
        const serialized: any = {};
        for (const [key, value] of Object.entries(obj)) {
            serialized[key] = serializePrismaDate(value);
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
