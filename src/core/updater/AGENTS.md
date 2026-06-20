# updater/ - Framework Self-Update Tooling

프레임워크 코어(`src/core`) 파일을 GitHub 릴리스에서 받아 안전하게 갱신하는 자체 업데이터.
운영 도구(operator-facing CLI)이므로 런타임 로그 규칙(영어·이모지 금지)에서 **면제**된다.

> 중요: 업데이터는 코어 파일만 다룬다. `src/app/`(사용자 코드)와 `src/core/updater/`(자기 자신)는
> 배포 파일맵에서 제외되어 **절대 덮어쓰지 않는다**. 통합 `kusto` CLI 의 `kusto update <...>` 로 노출.

## Structure

```
updater/
├── paths.ts       # 경로 SSOT: PROJECT_ROOT/UPDATER_DIR/MAP_DIR/PACKAGES_DIR/PACKAGE_JSON_PATH
├── checksum.ts    # 해시 SSOT: SHA-256 기본 + 파일맵 algo 필드 하위호환(없으면 md5)
├── archive.ts     # zip-slip(경로 탈출) 방어 추출
├── analy.ts       # 코어 파일 스캔 → 파일맵 생성(파일맵 = {경로: {checksum, algo}})
├── generate.ts    # 파일맵 + 소스를 zip 패키지로 (릴리스 자산)
├── compare.ts     # 현재 버전 vs 최신 릴리스 비교 + 다운로드 URL 추출
└── update.ts      # 다운로드 → 무결성 검증 → 계획 → 백업 → 적용/롤백
```

생성 산출물(`map/`, `packages/`, `temp-update/`, `.installed-map.json`)은 gitignore 대상.

## Files

### `paths.ts`
- **책임**: updater 가 `src/core/updater/` 에 있어 `__dirname` 깊이가 바뀌므로(`path.resolve(__dirname,'..')` 가 더 이상 repo 루트가 아님), 모든 경로를 한 곳에서 파생한다.
- **주요 export**: `PROJECT_ROOT`(= 3단계 상위, 업데이트 적용 기준), `UPDATER_DIR`, `MAP_DIR`, `PACKAGES_DIR`, `PACKAGE_JSON_PATH`.

### `checksum.ts`
- **책임**: 생성기와 적용기가 공유하는 해시 SSOT. 엔트리 `algo` 가 없으면 과거 포맷(md5)으로 해석해 하위호환.
- **주요 export**: `ChecksumAlgo`, `DEFAULT_ALGO`('sha256'), `FileMap`/`FileMapEntry`, `hashBuffer`, `checksumFile`, `entryAlgo`, `matchesEntry`.

### `archive.ts`
- **책임**: ZIP 추출 시 각 엔트리가 추출 루트 밖(`../`/절대경로)을 가리키면 거부(zip-slip 방어).
- **주요 export**: `isEntryInsideRoot`(순수 가드, 단위테스트 대상), `extractZipSafe`.

### `analy.ts`
- **책임**: PROJECT_ROOT 를 스캔해 코어 파일맵 생성. `.gitignore`·배포 제외 파일·`src/app`·`src/core/updater` 제외. `algo: sha256` 명시.
- **주요 export**: `generateFileMap(outputDir?)`, `runAnalysis()`.

### `generate.ts`
- **책임**: 파일맵을 기준으로 소스 파일을 zip 패키징(`file-map/` + `files/`). 릴리스 자산 생성.
- **주요 export**: `generateAndCompress(outputDir?)`, `compressFilesFromMap(...)`, `compressFromExistingMap(...)`.

### `compare.ts`
- **책임**: `package.json` 현재 버전과 GitHub 최신 릴리스 비교, 자산(zip/파일맵) 다운로드 URL 추출.
- **주요 export**: `checkForUpdates()`, `runUpdateCheck()`, `ComparisonResult`.

### `update.ts`
- **책임**: 다운로드 → zip-slip 안전 추출 → 무결성 검증(권위 파일맵 기준) → 계획(생성/갱신/삭제) → 백업 → 적용, 실패 시 롤백. `.installed-map.json` 으로 삭제 감지.
- **주요 export**: `performUpdate(options)`, `runUpdate(options?)`, `UpdateOptions`(dryRun/yes/packagePath/keepBackup).

## 의존 / 신뢰 모델

- 표준 import 경로는 `@core/updater/<file>`. `@core`(src/core) 단일 루트.
- 런타임 코어(`src/index.ts`/`src/app`/`src/core/lib`)는 updater 를 import 하지 **않는다**(서버 번들 비포함). 반대로 updater 는 `compare`/`update` 에서 `module-alias/register` 로 별칭을 활성화한다.
- 신뢰 기반은 **HTTPS(github.com) + 릴리스 소유권**. 무결성 검증은 손상/부분전송 탐지까지이며, 코드 서명이 없으므로 릴리스 위조에 대한 암호학적 진위는 보장하지 않는다. 자세한 내용은 `docs/07-update-system.md`.
