import { PrismaQueryBuilder } from '@lib/crud/crudHelpers';

// buildFieldConditions 는 private static 이므로 (PrismaQueryBuilder as any) 로 호출한다.
// 이 파일은 연산자 -> Prisma where 조각 변환을 단위로 고정(pin)한다.

describe('PrismaQueryBuilder.buildFieldConditions — present/blank/exists (NULL 전용 의미)', () => {
    // present/blank/exists 는 빈 문자열을 체크하지 않는다 — 오직 NULL 여부만 본다.
    // present:true == NOT NULL, present:false == IS NULL.
    // blank 는 present 의 역(inverse): blank:true == IS NULL, blank:false == NOT NULL.
    // exists 는 present 의 별칭(alias)이다.

    it('present:true 는 { not: null } (NOT NULL) 을 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildFieldConditions({ present: true });
        expect(result).toEqual({ not: null });
    });

    it('present:false 는 null (IS NULL) 을 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildFieldConditions({ present: false });
        expect(result).toBeNull();
    });

    it('blank:true 는 null (IS NULL) 을 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildFieldConditions({ blank: true });
        expect(result).toBeNull();
    });

    it('blank:false 는 { not: null } (NOT NULL) 을 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildFieldConditions({ blank: false });
        expect(result).toEqual({ not: null });
    });

    it('exists:true 는 present:true 와 동일하게 { not: null } 을 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildFieldConditions({ exists: true });
        expect(result).toEqual({ not: null });
    });

    it('exists:false 는 present:false 와 동일하게 null 을 반환한다', () => {
        const result = (PrismaQueryBuilder as any).buildFieldConditions({ exists: false });
        expect(result).toBeNull();
    });

    it('exists 는 present 의 별칭이다 (동일 입력에 동일 출력)', () => {
        const presentTrue = (PrismaQueryBuilder as any).buildFieldConditions({ present: true });
        const existsTrue = (PrismaQueryBuilder as any).buildFieldConditions({ exists: true });
        expect(existsTrue).toEqual(presentTrue);

        const presentFalse = (PrismaQueryBuilder as any).buildFieldConditions({ present: false });
        const existsFalse = (PrismaQueryBuilder as any).buildFieldConditions({ exists: false });
        expect(existsFalse).toEqual(presentFalse);
    });
});

describe('PrismaQueryBuilder.buildFieldConditions — like/ilike (리터럴 contains, % 미제거)', () => {
    // 빌드 레이어는 더 이상 % 를 제거하지 않는다 (% 처리는 parse 레이어로 이동).
    // like 는 항상 리터럴 substring 매칭(Prisma contains)이며 SQL LIKE 가 아니다.

    it('like 평문은 { contains } 로 변환된다', () => {
        const result = (PrismaQueryBuilder as any).buildFieldConditions({ like: 'foo' });
        expect(result).toEqual({ contains: 'foo' });
    });

    it('like 는 값에 포함된 % 를 제거하지 않는다 (리터럴 보존)', () => {
        const result = (PrismaQueryBuilder as any).buildFieldConditions({ like: 'a%b' });
        expect(result).toEqual({ contains: 'a%b' });
    });

    it('ilike 는 { contains, mode: insensitive } 로 변환하고 % 를 제거하지 않는다', () => {
        const result = (PrismaQueryBuilder as any).buildFieldConditions({ ilike: 'a%b' });
        expect(result).toEqual({ contains: 'a%b', mode: 'insensitive' });
    });

    it('ilike 평문은 mode insensitive 를 유지한다', () => {
        const result = (PrismaQueryBuilder as any).buildFieldConditions({ ilike: 'foo' });
        expect(result).toEqual({ contains: 'foo', mode: 'insensitive' });
    });
});

describe('PrismaQueryBuilder.buildFieldConditions — 배열 연산자 (all/elemMatch/size, 타입 인지)', () => {
    // 필드 타입 맵: Prisma 런타임 데이터모델에서 가져온 { isList, kind, type } 의 축약.
    const listField = new Map<string, any>([
        ['tags', { isList: true, kind: 'scalar', type: 'String' }],
    ]);
    const jsonField = new Map<string, any>([
        ['meta', { isList: false, kind: 'scalar', type: 'Json' }],
    ]);
    const scalarField = new Map<string, any>([
        ['name', { isList: false, kind: 'scalar', type: 'String' }],
    ]);

    function callBuild(conditions: any, fieldName?: string, map?: any) {
        return (PrismaQueryBuilder as any).buildFieldConditions(conditions, fieldName, map);
    }

    function expectThrow400(fn: () => void) {
        let thrown: any;
        try {
            fn();
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeDefined();
        expect(thrown.statusCode).toBe(400);
        return thrown;
    }

    it('all 은 scalar list 필드에서 { hasEvery } 로 변환된다', () => {
        expect(callBuild({ all: ['a', 'b'] }, 'tags', listField)).toEqual({ hasEvery: ['a', 'b'] });
    });

    it('all 은 Json 필드에서 { array_contains } 로 변환된다', () => {
        expect(callBuild({ all: ['a'] }, 'meta', jsonField)).toEqual({ array_contains: ['a'] });
    });

    it('elemMatch 단일 값은 scalar list 에서 { has } 로 변환된다', () => {
        expect(callBuild({ elemMatch: 'a' }, 'tags', listField)).toEqual({ has: 'a' });
    });

    it('elemMatch 배열 값은 scalar list 에서 { hasSome } 로 변환된다', () => {
        expect(callBuild({ elemMatch: ['a', 'b'] }, 'tags', listField)).toEqual({
            hasSome: ['a', 'b'],
        });
    });

    it('size 0 은 scalar list 에서 { isEmpty: true } 로 변환된다', () => {
        expect(callBuild({ size: 0 }, 'tags', listField)).toEqual({ isEmpty: true });
    });

    it('all 을 일반 scalar 필드에 쓰면 400 으로 throw (bogus 키 금지)', () => {
        expectThrow400(() => callBuild({ all: ['a'] }, 'name', scalarField));
    });

    it('elemMatch 를 일반 scalar 필드에 쓰면 400 으로 throw', () => {
        expectThrow400(() => callBuild({ elemMatch: 'a' }, 'name', scalarField));
    });

    it('size 0 을 일반 scalar 필드에 쓰면 400 으로 throw', () => {
        expectThrow400(() => callBuild({ size: 0 }, 'name', scalarField));
    });

    it('필드 타입 맵이 없으면(null) 배열 연산자는 400 으로 throw (bogus 키 금지)', () => {
        expectThrow400(() => callBuild({ all: ['a'] }, 'tags', null));
    });
});
