# core/ - 프레임워크 내부 (Framework Internals)

express.js-kusto 프레임워크의 모든 내부 구현. 부트스트랩(생명주기), HTTP 요청 처리/검증/직렬화/에러, 멀티 DB·DI, CRUD 엔진, dev 도구, CLI/스크립트/업데이터를 포함한다.

## ⛔ 수정 금지 원칙 (가장 중요)

**`src/core/` 는 기본적으로 LLM·개발자가 직접 수정하는 공간이 아니다 — 절대·엄격하게 금지.**

- 이 프레임워크를 **소비(설치)하는 프로젝트**에서 `src/core/` 는 프레임워크 내부물이다. 직접 수정하지 말 것. 변경은 오직 `kusto update`(프레임워크 self-update)로만 받는다. 직접 고치면 다음 업데이트에서 덮어써지거나 충돌한다.
- **예외 — 바로 이 repo**: 이 저장소는 프레임워크 *자체를 구현*하는 원본 repo 이므로 `src/core/` 를 직접 편집한다. 단, 아래 규율을 반드시 지킨다.
  1. 편집 전 해당 폴더(및 상위 티어)의 `AGENTS.md` 를 먼저 읽는다.
  2. 티어 의존 방향(아래)을 위반하지 않는다(역참조 금지).
  3. 코드를 바꾸면 같은 변경에서 해당 폴더의 `AGENTS.md` 를 동기화한다.

> 사용자(개발자) 작업 공간은 `src/app/` 이다. 애플리케이션 코드는 전부 거기에 둔다.

## Structure (각 폴더의 AGENTS.md 참조)

```
core/
├── index.ts        # 공개 API 배럴 (curated re-exports)
├── AGENTS.md       # (이 파일) core 루트 인덱스 + 수정 금지 원칙
├── bootstrap/      # 생명주기: Application, Core, expressAppSingleton(@deprecated) — AGENTS.md
├── external/       # 3rd-party 래퍼 (leaf, intra-core import 0): winston, util — AGENTS.md
├── cli/            # 통합 `kusto` CLI (commander) over db/update/generate
├── scripts/        # 독립 빌드/코드젠 CLI 도구 (operator 대면)
├── updater/        # 프레임워크 self-update (자기 배포맵에서 제외) — AGENTS.md
└── lib/
    ├── http/       # 요청 처리 티어 (routing/validation/serialization/errors) — AGENTS.md
    ├── data/       # 영속 티어 (database/di) — AGENTS.md
    ├── crud/       # JSON:API CRUD 엔진 — AGENTS.md
    ├── devtools/   # DEV 전용 (documentation/schema-api/monitor) — AGENTS.md
    ├── config/     # environmentLoader — AGENTS.md
    └── types/      # express-extensions + generated-*.ts (codegen 산출물, 수정 금지) — AGENTS.md
```

## 티어 의존 방향 (단방향)

`bootstrap` → 티어들. `lib` 안에서는 상위 티어가 하위 티어를 안쪽으로 의존한다. `external`·`config` 는 잎(leaf). 역방향 엣지(예: `data` 가 `http` 를 import)는 금지. `devtools` 는 dev 전용이며 런타임 티어에 의존할 수 있으나 그 반대는 안 된다.

## AGENTS.md 규약 (필수: 참조 + 동기화)

- **작업 전 무조건 참조**: `src/core/` 내 어떤 파일이든 읽기/편집하기 전에 그 폴더의 `AGENTS.md`(및 상위 티어 `AGENTS.md`)를 먼저 읽는다. 각 파일의 역할·export·의존 방향에 대한 단일 진실 공급원이다 — 코드만 보고 시작하지 않는다.
- **변경 시 무조건 동기화**: 신규 기능·파일·export 추가나 동작/의존 방향 변경 시, 같은 변경에서 해당 폴더의 `AGENTS.md` 를 갱신한다. 코드와 `AGENTS.md` 가 어긋난 상태는 결함으로 본다.
