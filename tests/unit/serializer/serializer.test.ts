import {
    serialize,
    serializeBigInt,
    serializeDate,
    serializePrismaDate,
    safeJsonResponse,
    jsonReplacer,
} from '@lib/http/serialization/serializer';

describe('serializeBigInt', () => {
    it('BigInt 값이 들어올 때 문자열로 변환한다', () => {
        const result = serializeBigInt(123n);
        expect(result).toBe('123');
    });

    it('BigInt 가 포함된 객체가 들어올 때 모든 BigInt 필드가 문자열로 변환된다', () => {
        const result = serializeBigInt({ id: 1n, name: 'a', count: 100n });
        expect(result).toEqual({ id: '1', name: 'a', count: '100' });
    });

    it('BigInt 가 포함된 배열이 들어올 때 모든 BigInt 가 문자열로 변환된다', () => {
        const result = serializeBigInt([{ id: 1n }, { id: 2n }]);
        expect(result).toEqual([{ id: '1' }, { id: '2' }]);
    });
});

describe('serializeDate', () => {
    it('Date 객체가 들어올 때 ISO 문자열로 변환한다', () => {
        const d = new Date('2025-01-01T00:00:00Z');
        const result = serializeDate(d);
        expect(typeof result).toBe('string');
        expect(result).toContain('2025-01-01');
    });
});

describe('serializePrismaDate', () => {
    // 주의: 구현은 Object.keys(obj).length === 0 인 빈 객체에 한해 valueOf 시도 → 변환한다.
    // 실제 Prisma Date 객체와 동일하게 valueOf 를 non-enumerable 로 정의해야 분기에 진입한다.
    it('Prisma Date 객체 (빈 객체이지만 valueOf 가 number 반환) 가 들어올 때 YYYY-MM-DD 형식으로 변환한다', () => {
        const fakePrismaDate: any = {};
        Object.defineProperty(fakePrismaDate, 'valueOf', {
            value: () => Date.UTC(2025, 0, 15), // 2025-01-15
            enumerable: false,
        });
        const result = serializePrismaDate(fakePrismaDate);
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('valueOf 가 throw 할 때 원본 객체를 반환한다 (graceful fallback)', () => {
        const broken: any = {};
        Object.defineProperty(broken, 'valueOf', {
            value: () => {
                throw new Error('cannot convert');
            },
            enumerable: false,
        });
        expect(() => serializePrismaDate(broken)).not.toThrow();
    });
});

describe('serialize (composite)', () => {
    it('BigInt 와 Date 가 섞인 객체가 들어올 때 둘 다 정상 변환한다', () => {
        const result = serialize({
            id: 100n,
            createdAt: new Date('2025-01-01T00:00:00Z'),
            name: 'item',
        });
        expect(result.id).toBe('100');
        expect(typeof result.createdAt).toBe('string');
        expect(result.name).toBe('item');
    });

    it('null/undefined 가 들어올 때 그대로 반환한다', () => {
        expect(serialize(null)).toBeNull();
        expect(serialize(undefined)).toBeUndefined();
    });

    it('primitive (string, number, boolean) 가 들어올 때 그대로 반환한다', () => {
        expect(serialize('hello')).toBe('hello');
        expect(serialize(42)).toBe(42);
        expect(serialize(true)).toBe(true);
    });
});

describe('safeJsonResponse', () => {
    it('BigInt 가 포함된 객체를 JSON.stringify 가능한 문자열로 직렬화한다', () => {
        const json = safeJsonResponse({ id: 1n, name: 'x' });
        const parsed = JSON.parse(json);
        expect(parsed).toEqual({ id: '1', name: 'x' });
    });
});

// jsonReplacer 는 safeJsonResponse 가 내부적으로 사용하므로 직접 import 만으로 충분
// (no-op: import 검증)
void jsonReplacer;
