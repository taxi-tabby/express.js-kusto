# external/ - 외부 라이브러리 래퍼 / 범용 헬퍼

서드파티 라이브러리(winston)를 프레임워크 컨벤션에 맞게 래핑한 로깅 서브시스템과, 어떤 tier 에도 종속되지 않는 범용 유틸 함수를 제공하는 leaf tier. 코어 내부 어디로도 import 하지 않으며(intra-core 의존성 0), 다른 모든 tier 가 이쪽을 향해 import 한다(순수 바닥층).

## Structure

```
external/
├── winston.ts   # 로깅 서브시스템: 커스텀 레벨/색상/이모지, env-aware 콘솔 레벨, 안전 직렬화+민감정보 마스킹, log 싱글톤
└── util.ts      # 범용 헬퍼: 슬래시 정규화, 경과시간 포맷, 복수/단수화, 페이지네이션 커서
```

## winston.ts — 로깅 서브시스템 (leaf, intra-core 의존성 0)

winston + winston-daily-rotate-file 위에 프로젝트 전용 로그 레벨/포맷/직렬화 정책을 입힌 싱글 모듈. 외부 의존성은 `winston`, `winston-daily-rotate-file`, `logform`, Node 내장 `path`/`fs` 뿐이며 코어 내부 모듈은 전혀 import 하지 않는다.

주요 export:
- `log` (default + named) — 커스텀 레벨 메서드를 갖춘 winston `Logger` 싱글톤. 레벨 메서드(PascalCase): `Error`, `Warn`, `Info`, `Debug`, `Silly`, `SQL`, `Route`, `SessionDeclaration`, `Footwalk`, `Email`, `Auth` (+ winston 예외처리용 소문자 `error` 별칭). 코어/앱 런타임 전역이 `import { log } from '@ext/winston'` 로 사용.
- `logger` — 보조 유틸 객체: `startTimer(label)`(hrtime 기반 성능 타이머), `httpRequest(method,url,statusCode,duration)`, `dbQuery(query,duration?,params?)`.
- `LogLevelName` — `LOG_SETTINGS` 키에서 파생된 레벨명 유니온 타입.
- `normalizeLevel(raw)` — 임의 문자열/별칭/`silent`·`off`·`none` 을 정규 레벨명 또는 `'silent'`/`null` 로 해석(`LOG_LEVEL` 정규화용).
- `resolveConsoleLevel(env?)` — 콘솔 transport 레벨 결정. 우선순위 `LOG_LEVEL` > 환경별 기본값(production=`Info`, test=`Error`, 그 외=`Debug`). dev 기본이 `Debug` 이므로 `Silly` 는 기본 숨김.
- `isColorEnabled(env?, isTTY?)` — ANSI 색상 사용 여부. `NO_COLOR` 표준 존중, `FORCE_COLOR` 강제, 비-TTY 에서는 비활성.
- `toSafeJson(value, opts?)` — `JSON.stringify` 가 throw 할 수 있는 모든 케이스(순환 참조, `BigInt`, 함수, 심볼, `Error`, `Buffer`, `Date`, `Map`/`Set`, throw 하는 getter, 깊이 초과)를 방어해 JSON 안전 구조로 변환.
- `safeStringify(value, opts?)` — `toSafeJson` 으로 정리 후 직렬화. 어떤 입력에도 절대 throw 하지 않으며 민감키를 `[REDACTED]` 로 마스킹.

내부 동작 요점: `LOG_SETTINGS` 가 레벨/색상/이모지의 단일 진실원천(`customLevels`/`customColors`/`customEmojis` 파생). dev 는 사람이 읽기 좋은 컬러 라인(TTY 한정), prod 는 한 줄 JSON. 민감키 매칭은 `SUBSTRING_TOKENS`(부분일치) + `WORD_TOKENS`(전체-단어, 예: `pwd`/`ssn`/`jwt`)로 구성되며 `LOG_REDACT=false` 로 비활성, `LOG_REDACT_KEYS=a,b` 로 추가 키 지정. 일자 회전 파일 로그는 `LOG_DIR`/`LOG_MAX_SIZE`/`LOG_MAX_FILES`/`LOG_FILE_LEVEL` 로 튜닝되며, 로그 디렉토리 생성 실패(`ensureLogDirectory`) 또는 transport 초기화 실패 시 throw 대신 콘솔 전용으로 graceful 강등. transport 쓰기 실패(`log.on('error')`)는 stderr 로 흘려 프로세스를 죽이지 않는다.

## util.ts — 범용 헬퍼 (leaf, 의존성 0)

외부/내부 import 이 전혀 없는 순수 함수 모음. 문자열 경로/페이지네이션/단어 변형에서 코어 전반이 공유한다.

주요 export:
- `normalizeSlash(input)` — 연속 슬래시(`//+`)를 단일 `/` 로 축약(URL/경로 정규화).
- `getElapsedTimeInString(endTime)` — `process.hrtime` 의 `[초, 나노초]` 튜플을 `"1.2s (1234ms)"` 형식 문자열로 포맷.
- `pluralize(word)` — 간단한 영어 규칙 복수화(`s`/`x`/`ch`/`sh`→`+es`, `y`→`ies`, 그 외 `+s`).
- `singularize(word)` — `pluralize` 의 역규칙 단수화(`ies`→`y`, `ses`/`xes`/`ches`/`shes`→`-es`, `ss` 제외 말미 `s` 제거).
- `createPaginationCursor(total)` — TypeORM 호환 형식의 base64 페이지네이션 커서 생성.

## Import 규칙 / 레이어링

- 정규 import 경로는 단일 `@lib` 루트가 아니라 별칭 `@ext` 를 통한다: `@ext/winston`, `@ext/util` (= `src/core/external/*`). `@ext` 는 `src/core/external` 를 가리키는 전용 별칭(`@lib` = `src/core/lib` 와 구분).
- **레이어링 방향**: external 은 코어 최하층(leaf). 두 파일 모두 코어 내부를 import 하지 않으며(outbound 의존성 = winston 계열/Node 내장뿐), 상위 tier(lib·core 전반, app)가 단방향으로 이쪽을 import 한다. 순환 위험이 없는 안전한 바닥층이므로 어디서든 자유롭게 끌어다 쓸 수 있다.
