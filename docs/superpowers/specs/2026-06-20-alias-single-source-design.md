# 경로 별칭(alias) 단일 소스화 설계

> 2026-06-20 · 범위 승인: "별칭 현대화" (파일 이동 없음 → self-updater 영향 최소). lib/ 폴더 그룹화·구조 리팩터는 제외.

## 배경 / 진단

별칭 6개(`@ @app @core @lib @ext @db`)는 4곳(tsconfig·package.json·webpack·jest)에서 **값은 일치**하나 **수기 4중 관리**라 drift 위험이 있고, 다음 실문제가 있다:
- **런타임 resolver 갭**: `npm run db`(kusto-db-cli)·`updater:*`(ts-node)는 module-alias/tsconfig-paths 미등록 → 별칭 사용 시 `MODULE_NOT_FOUND`(현재는 잠재적).
- **이중 표기**: `Core.ts`만 `@core/lib/...`, 나머지 전부 `@lib/...`.
- **`@tests/*` 부재**: 테스트 12건이 `../../_setup/...` 깨지기 쉬운 상대경로.

self-updater(`updater/analy.ts`)가 src/core 파일을 상대경로 키로 추적·무마이그레이션 → **파일 이동 금지**(별칭 config 변경만). `types/`·`tmp/`는 생성 스크립트·빌드가 고정.

## 설계 — tsconfig 를 단일 소스로

1. **tsconfig.json `compilerOptions.paths` = 정식 별칭 레지스트리.** `@tests/* → tests/*` 추가.
2. **jest**: `moduleNameMapper` 를 `pathsToModuleNameMapper(tsconfig.paths, { prefix: '<rootDir>/' })`(ts-jest)로 **파생**. jest 가 tsconfig 와 drift 불가. 더불어 deprecated `globals.ts-jest` → `transform` 으로 현대화.
3. **webpack**: `resolve.alias` 를 tsconfig.paths 에서 인라인 파생(신규 의존성 없음).
4. **런타임(module-alias)**: 메커니즘은 유지(앱 진입점 src/index.ts 의 `module-alias/register` 불변). `_moduleAliases` 는 남는 유일한 수기 사본이므로 **drift 가드 테스트**로 tsconfig 와 동치 강제. `@tests` 도 추가해 완전 동치.
5. **갭 차단**: `kusto-db-cli.ts`·`updater/{generate,compare,update}.ts` 최상단에 `import 'module-alias/register'` 추가(공용 부트스트랩 = module-alias 모듈).
6. **표기 통일**: `Core.ts` 및 AGENTS.md 예시의 `@core/lib/...` → `@lib/...`.
7. **`@tests/*` 적용**: 테스트 11파일 12건 `../../_setup/{env,db}-fixture` → `@tests/_setup/...`.
8. **문서화**: CLAUDE.md Path Aliases 섹션 갱신(단일 소스·파생·신규 별칭 추가법).

## 비범위
- lib/ 도메인 폴더 이동, crudHelpers↔errorHandler 순환 해소, loadRoutes 리네임(모두 self-updater 영향 큼 → 별도 과제).
- 런타임 resolver 를 tsconfig-paths 로 교체(앱 진입점 리스크 → 보류).

## 검증
- `npm run typecheck`(기존 `@app/db/default/client` 에러만), `npm test` 전체 PASS, 신규 가드 테스트 PASS.
- webpack config 파생 별칭을 `node -e` 로 검사(빌드는 Prisma client 부재로 불가).
- 적대적 코드리뷰(별칭 해석/ordering/런타임/회귀) 후 커밋.
