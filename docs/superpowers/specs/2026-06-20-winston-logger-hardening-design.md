# Winston 로거 고도화·안정화 설계

> 2026-06-20 · 대상: `src/core/external/winston.ts` · 범위 승인: 안정화 전부 + 고도화 추천세트(리댁션·env설정·타입강화), child 로거 제외.

## 목표

로거의 견고성(크래시 방지)·운영 적합성·보안을 끌어올리되, **공개 계약은 100% 호환 유지**:
- 12개 커스텀 레벨 메서드(`Error/Warn/Info/Debug/Silly/SQL/Route/Footwalk/Auth/Email/SessionDeclaration/error`)
- `export const log`, `export default log`, `export const logger`(헬퍼)
- dev: 사람이 읽는 컬러 라인 / prod: JSON 한 줄 (키: `timestamp, level, message, stack?, ...meta`)

## 안정화 (버그·견고성)

1. **안전 직렬화 `toSafeJson` / `safeStringify`** — 메타 직렬화 시 순환참조→`[Circular]`(조상 경로 추적, 형제 공유참조 오탐 없음), `BigInt`→`"…n"`, `Error`→`{name,message,stack,+열거 prop}`, `Buffer`→`[Buffer N bytes]`, `Date`→ISO, 함수/심볼→문자열, getter throw→`[Getter threw: …]`, 깊이 초과(기본 8)→`[Object]/[Array]`. 실패 시 최후 `[Unserializable: …]`. dev·prod 양 분기 모두 적용.
2. **TTY 인지 색상 `isColorEnabled`** — `process.stdout.isTTY`일 때만 ANSI. `NO_COLOR` 표준 존중, `FORCE_COLOR` 강제. 비-TTY(파이프/Docker)에선 평문.
3. **환경별 콘솔 레벨 `resolveConsoleLevel`** — 우선순위 `LOG_LEVEL` > 기본값(prod=Info, test=Error, dev=Debug). `LOG_LEVEL`은 대소문자/별칭 정규화(`normalizeLevel`), `silent/off/none`→콘솔 silent, 알 수 없는 값→환경 기본값 폴백.
4. **테스트 조용화** — test 환경 기본 Error만(위 3에 포함).
5. **로그 디렉토리 fs 가드** — 생성 실패 시 throw 대신 `console.warn` 1회 + 파일 transport 비활성(콘솔 로깅은 유지). 부트스트랩이라 winston 자신 미사용.
6. **죽은 코드 제거** — 미사용 `levelInfo` 변수 등.

## 고도화 (신규)

7. **민감정보 마스킹** — 메타 키가 `password/passwd/pwd/secret/token/accesstoken/refreshtoken/authorization/auth/apikey/api_key/cookie/set-cookie/sessionid/…`(대소문자 무시)면 값→`[REDACTED]`. 중첩/배열 재귀 적용. `LOG_REDACT=false`로 끔, `LOG_REDACT_KEYS=a,b`로 추가.
8. **env 설정화** — `LOG_DIR`(기본 `./logs`), `LOG_MAX_SIZE`(20m), `LOG_MAX_FILES`(30d), `LOG_FILE_LEVEL`(Info). 미설정 시 현재 동작 동일.
9. **타입 강화 / 헬퍼 정리** — `export type LogLevelName`, 순수 헬퍼(`toSafeJson/safeStringify/resolveConsoleLevel/isColorEnabled/normalizeLevel`) 내보내 단위 테스트 가능화. `logger` 헬퍼는 유지하되 타입 정리.

## 비범위

- 요청 상관관계 child 로거(requestId) — 미들웨어까지 연동 필요, 별도 과제.
- 레벨 체계/이모지/색상 팔레트 변경 없음.

## 테스트 (tests/unit/logger/)

`toSafeJson`(순환/BigInt/Error/Buffer/Date/getter-throw/깊이), 리댁션(중첩·off·추가키), `resolveConsoleLevel`(env별·override·별칭·invalid·silent), `isColorEnabled`(TTY/NO_COLOR/FORCE_COLOR), `normalizeLevel`, 그리고 `log.*` 스모크(순환 메타로 호출해도 throw 안 함). 검증: `npm run typecheck`(기존 `@app/db/default/client` 에러만) + `npm test`.
