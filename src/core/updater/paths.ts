import * as path from 'path';

/**
 * updater 경로 단일 출처(SSOT).
 *
 * updater 는 `src/core/updater/` 에 있으므로 `__dirname` 은 (ts-node/webpack 모두)
 * 해당 폴더를 가리킨다. 프로젝트 루트는 세 단계 상위다:
 *   src/core/updater  →  ..(=src/core)  →  ..(=src)  →  ..(=repo root)
 *
 * 과거 updater 가 repo-root `updater/` 에 있을 때는 `path.resolve(__dirname, '..')` 가
 * 곧 루트였다. core 로 이동하면서 이 깊이가 바뀌므로, 모든 모듈이 여기서 파생한
 * 경로 상수만 쓰도록 해 깊이 magic 을 한 곳에 가둔다.
 */

/** 프로젝트(소비자 프로젝트) 루트 — 업데이트 파일이 적용되는 기준 디렉토리 */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

/** updater 모듈 디렉토리 (src/core/updater) */
export const UPDATER_DIR = __dirname;

/** 생성된 파일 맵 출력 디렉토리 (gitignore 대상) */
export const MAP_DIR = path.join(UPDATER_DIR, 'map');

/** 생성된 업데이트 패키지(zip) 출력 디렉토리 (gitignore 대상) */
export const PACKAGES_DIR = path.join(UPDATER_DIR, 'packages');

/** 루트 package.json 경로 */
export const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');
