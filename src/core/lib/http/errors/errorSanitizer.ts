/**
 * 민감정보 마스킹 단일 출처 (SSOT).
 *
 * 과거 errorHandler.removeSensitiveInformation 와 crudHelpers.removeSensitiveInformation 에
 * 동일한 정규식 테이블 + 제거 루프가 (주석만 다른 채) 중복되어 있었다. 보안 redaction 이
 * 두 경로로 갈라져 한쪽만 패턴이 추가되면 다른 경로로 비밀정보가 새어나갈 위험이 있어
 * 한 곳으로 통합한다. 두 호출처는 이 함수를 호출하도록 위임한다.
 *
 * 주의: stackTrace 패턴은 호출 시점의 NODE_ENV 로 평가해야 하므로(테스트가 env 를 바꿔가며
 * 검증) 테이블을 모듈 로드 시점 상수가 아니라 함수 내부에서 구성한다.
 */
/**
 * Prisma 에러 메시지를 사용자 친화적 문구로 치환한다(메시지에 'Prisma'/'prisma' 포함 시에만).
 * errorHandler.sanitizePrismaErrors 와 crudHelpers.sanitizePrismaSpecificErrors 에 바이트 단위로
 * 중복돼 있던 매핑 테이블+치환 루프를 단일 출처로 통합한 것.
 */
export function sanitizePrismaMessage(message: string): string {
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

export function removeSensitiveInformation(message: string): string {
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
