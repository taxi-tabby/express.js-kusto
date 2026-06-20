# 🔄 업데이트 시스템

프레임워크 코어(`src/core`) 파일을 GitHub 릴리스에서 받아 안전하게 갱신하는 자체 업데이터.
구현은 **`src/core/updater/`** 에 있으며, 통합 `kusto` CLI 의 `update` 서브커맨드로 노출된다.

> 업데이터는 코어 파일만 다룬다. **`src/app/`(사용자 코드)와 `src/core/updater/`(업데이터 자신)는 절대 건드리지 않는다.**

## 📦 구성 (`src/core/updater/`)

| 파일 | 역할 |
|------|------|
| `paths.ts` | 경로 단일 출처(SSOT): `PROJECT_ROOT` 등. updater 가 core 안에 있어 `__dirname` 깊이가 바뀌므로 모든 경로를 여기서 파생 |
| `checksum.ts` | 해시 SSOT — SHA-256 기본 + 파일맵 `algo` 필드 하위호환(없으면 md5) |
| `archive.ts` | zip-slip(경로 탈출) 방어 추출 |
| `analy.ts` | 코어 파일 스캔 → 파일맵(`경로 → {checksum, algo}`) 생성. `src/app`·`src/core/updater` 제외 |
| `generate.ts` | 파일맵 + 소스를 zip 으로 패키징(릴리스 자산) |
| `compare.ts` | 현재 버전 vs 최신 릴리스 비교, 다운로드 URL 추출 |
| `update.ts` | 다운로드 → 검증 → 계획 → 백업 → 적용/롤백 |

## 📋 명령어

통합 CLI(권장):

```bash
kusto update check            # 최신 릴리스가 있는지 확인
kusto update apply            # 최신 업데이트 다운로드·적용(대화형 확인)
kusto update apply --dry-run  # 변경 미리보기만(파일 미수정)
kusto update apply --yes      # 비대화형(확인 생략)
kusto update apply --package ./update.zip   # 로컬 패키지로 오프라인 적용
kusto update build            # 릴리스 패키지 생성(메인테이너)
```

기존 npm 스크립트도 그대로 동작한다:

```bash
npm run updater:check      # = kusto update check
npm run updater:update     # = kusto update apply (인자: -- --dry-run 등)
npm run updater:generate   # = kusto update build
```

### `apply` 옵션

| 옵션 | 동작 |
|------|------|
| `--dry-run` | 생성/갱신/삭제 **계획만 출력하고 대상(프레임워크) 파일을 수정하지 않음**. (패키지는 임시 디렉터리에 받아 검증만 하고 정리하므로 네트워크/임시쓰기는 발생) |
| `-y, --yes` | 확인 프롬프트 생략(CI/자동화) |
| `--package <zip>` | GitHub 대신 로컬 zip 적용(오프라인/검증). 사용자 신뢰 기반 |
| `--keep-backup` | 성공 후에도 백업 디렉토리 보존 |

## 🔒 안전장치

- **자동 백업 + 롤백**: **파일 적용 단계**에서 변경/삭제 대상 파일을 백업하고, 그 단계 중 오류가 나면 자동 원복한다. 원복이 불완전하면 백업을 보존하고 경로를 안내한다. (적용 성공 이후의 설치맵/버전 기록 실패는 이미 올바르게 적용된 파일에는 영향이 없으며, 다음 실행에서 자동 수렴한다.) 과거의 "자동 백업/롤백 없음" 경고는 더 이상 유효하지 않다.
- **zip-slip 방어**: 아카이브 엔트리가 추출 루트를 벗어나면(`../`/절대경로) 거부한다.
- **무결성 검증**: 추출된 소스 파일의 체크섬이 릴리스에 게시된 파일맵과 일치하는지 확인한다(손상/부분전송 탐지).
- **삭제 안전**: 직전 설치 맵 대비 사라진 프레임워크 파일만 삭제하되, 로컬에서 수정된 파일은 지우지 않고 경고 후 건너뛴다.
- **해시**: 신규 맵은 SHA-256(`algo: "sha256"`). 과거 맵(`algo` 없음)은 md5 로 해석해 하위호환.

## 🧠 변경 감지 / 삭제 감지

- 적용 성공 시 적용된 파일맵을 `src/core/updater/.installed-map.json` 에 보관한다.
- 다음 업데이트에서 **이전 설치 맵 ∖ 새 맵** 을 계산해 삭제 대상을 찾는다(첫 업데이트는 삭제 없음).

## ⚠️ 신뢰 모델

업데이터는 **github.com 으로의 HTTPS 연결 + 릴리스 소유권**을 신뢰 기반으로 한다. 무결성 검증은
손상·부분전송과 "릴리스가 게시한 맵과 패키지의 일치"까지 보장하지만, **코드 서명이 없으므로
릴리스 자체를 위조할 수 있는 공격자에 대한 암호학적 진위(authenticity)는 보장하지 않는다.**
`--package` 로컬 적용은 사용자가 패키지 출처를 신뢰하는 경우에만 사용한다.

업데이트 전 git 커밋(또는 브랜치/태그 생성)을 권장한다 — 자동 백업이 있더라도 가장 확실한 복구 수단이다.

---

## 📖 문서 네비게이션

**◀️ 이전**: [🔄 CRUD 라우터](./06-crud-router.md)
**▶️ 다음**: [📋 CRUD 스키마 API](./08-crud-schema-api.md)
