#!/usr/bin/env node
/**
 * `kusto` CLI 실행 셸 (bin).
 *
 * 프레임워크는 소스(TS) 기반으로 ts-node 로 구동되므로, 컴파일 산출물 대신
 * ts-node 를 등록하고 통합 CLI 진입점(src/core/cli/kusto.ts)을 로드한다.
 * (package.json "bin": { "kusto": "bin/kusto.js" } 로 등록되어 `npx kusto ...` 사용 가능)
 */
require('ts-node/register');
require('../src/core/cli/kusto.ts');
