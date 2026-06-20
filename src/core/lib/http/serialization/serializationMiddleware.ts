import { Request, Response, NextFunction } from 'express';
import { log } from '@ext/winston';
import { serialize } from '@lib/http/serialization/serializer';

/**
 * BigInt 및 기타 직렬화 불가능한 타입을 자동으로 처리하는 미들웨어
 * 모든 응답 데이터를 자동으로 직렬화합니다.
 */
export function serializationMiddleware(req: Request, res: Response, next: NextFunction) {
    // 원본 json 메서드 백업
    const originalJson = res.json;
    
    // json 메서드 오버라이드
    res.json = function(body: any) {
        try {
            // 데이터 직렬화
            const serializedBody = serialize(body);
            return originalJson.call(this, serializedBody);
        } catch (error) {
            log.Error('Serialization error:', error);
            // 직렬화 실패 시 원본 데이터로 시도
            return originalJson.call(this, body);
        }
    };
    
    next();
}

// BigInt 타입 확장을 위한 전역 선언
declare global {
    interface BigInt {
        toJSON(): string;
    }
}

/**
 * JSON.stringify 전역 설정을 통한 BigInt 직렬화
 * 애플리케이션 시작 시 한 번만 호출하면 됩니다.
 */
export function setupGlobalBigIntSerialization() {
    // BigInt.prototype.toJSON 메서드 추가
    if (!(BigInt.prototype as any).toJSON) {
        (BigInt.prototype as any).toJSON = function() {
            return this.toString();
        };
    }
}
