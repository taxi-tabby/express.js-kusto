import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';
import * as fs from 'fs';
import * as path from 'path';

// 단일 소스: tsconfig.json 의 compilerOptions.paths 에서 jest 모듈 별칭을 파생한다.
// 별칭을 한 곳(tsconfig)에서만 관리하므로 jest 가 tsconfig 와 drift 할 수 없다.
const tsconfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'tsconfig.json'), 'utf-8')
) as { compilerOptions: { paths: Record<string, string[]> } };

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  moduleNameMapper: pathsToModuleNameMapper(tsconfig.compilerOptions.paths, { prefix: '<rootDir>/' }),
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/src/core/lib/types/',
    '/src/core/scripts/generate.*\\.js$',
    '/src/core/scripts/clean-tmp\\.js$',
    '/src/app/',
    '/src/core/updater/',
    '/tests/_setup/',
    '/tests/_fixtures/',
    '/node_modules/.prisma/'
  ],
  // Tier 1+2 baseline thresholds.
  // Spec A 의 Documentation 강화 후 Tier 3 가 추가되면 상향 가능.
  // 현재 임계치는 Phase 2 완료 시점 (137 TC) 의 실제 측정값을 기반으로
  // 회귀 보호용 하한선으로 설정함. coverage 자체를 추격하지 않는다.
  coverageThreshold: {
    global: { statements: 15, branches: 15, functions: 15, lines: 15 },
    './src/core/lib/crud/crudHelpers.ts': { statements: 35, branches: 25, functions: 45, lines: 35 },
    './src/core/lib/http/errors/errorHandler.ts': { statements: 50, branches: 40, functions: 65, lines: 50 },
    './src/core/lib/http/errors/errorCodes.ts': { statements: 90, branches: 50, functions: 50, lines: 90 },
    './src/core/lib/http/serialization/serializer.ts': { statements: 70, branches: 65, functions: 95, lines: 70 }
  },
  testTimeout: 30000
};

export default config;
