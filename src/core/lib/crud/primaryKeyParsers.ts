/**
 * Primary key / ID 파서 헬퍼 모음
 *
 * ExpressRouter 의 CRUD 라우터에서 사용하는 순수(pure) ID 파싱 함수들을 모아둔 모듈.
 * 인스턴스 상태에 의존하지 않으며, 동작은 기존 ExpressRouter 정적/인스턴스 헬퍼와 byte-for-byte 동일하다.
 */

/**
 * UUID 검증 정규식 (단일 출처 / SSOT).
 * lenient 규칙: 8-4-4-4-12 hex (RFC 버전/variant 비강제). crudHelpers.isValidUUID 와
 * crudRouteBuilder.parseRelationshipId 의 관계 ID 검증이 이 동일 규칙을 공유한다.
 */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 주어진 문자열이 UUID(lenient) 형식인지 검사 */
export const isUuid = (value: string): boolean => UUID_REGEX.test(value);

/**
 * UUID 전용 파서 (검증 포함)
 */
export const parseUuid = (uuid: string): string => {
    if (!UUID_REGEX.test(uuid)) {
        throw new Error(`Invalid UUID format: ${uuid}`);
    }
    return uuid;
};

/**
 * 문자열 그대로 반환하는 파서
 */
export const parseString = (value: string): string => {
    return value;
};

/**
 * 정수 전용 파서 (검증 포함)
 */
export const parseInt_ = (value: string): number => {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        throw new Error(`Invalid integer format: ${value}`);
    }
    return parsed;
};

/**
 * 스마트 ID 파서 - 입력값을 보고 적절한 타입으로 변환
 * UUID 형식이 아닌 경우 숫자를 문자열로 안전하게 처리
 */
export const parseIdSmart = (id: string): any => {
    // 먼저 입력값 검증
    if (!id || typeof id !== 'string') {
        throw new Error('Invalid ID format: ID must be a non-empty string');
    }

    // UUID 패턴 체크 (lenient, UUID_REGEX 단일 출처)
    if (UUID_REGEX.test(id)) {
        return id; // 유효한 UUID 그대로 반환
    }

    // 순수 숫자인 경우 숫자로 변환
    if (/^\d+$/.test(id)) {
        const numValue = parseInt(id, 10);
        if (!isNaN(numValue) && numValue > 0) {
            return numValue;
        }
    }

    // 유효한 문자열 ID인 경우 (알파넷, 숫자, 하이픈, 언더스코어 허용)
    if (/^[a-zA-Z0-9_-]+$/.test(id)) {
        return id;
    }

    // 나머지 경우 에러 발생
    throw new Error(`Invalid ID format: '${id}' is not a valid UUID, number, or string identifier`);
};

/**
 * Primary key 타입을 자동으로 감지하고 적절한 파서를 반환하는 헬퍼
 */
export const getSmartPrimaryKeyParser = (databaseName: string, modelName: string, primaryKey: string): (value: string) => any => {
    // 간단한 타입 추론 로직
    // 실제로는 Prisma 스키마나 메타데이터를 통해 판단할 수 있음
    // 여기서는 일반적인 패턴을 기반으로 추론

    // primaryKey 이름 기반 추론
    if (primaryKey === 'uuid' || primaryKey.includes('uuid') || primaryKey.endsWith('_uuid')) {
        return parseUuid;
    }

    // 기본적으로 스마트 파서 사용 (숫자인지 UUID인지 자동 판단)
    return parseIdSmart;
};
