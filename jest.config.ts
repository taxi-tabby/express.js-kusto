import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/app/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@lib/(.*)$': '<rootDir>/src/core/lib/$1',
    '^@ext/(.*)$': '<rootDir>/src/core/external/$1',
    '^@db/(.*)$': '<rootDir>/src/app/db/$1',
    '^@/(.*)$': '<rootDir>/$1'
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json'
    }
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/src/core/lib/types/',
    '/src/core/scripts/generate.*\\.js$',
    '/src/core/scripts/clean-tmp\\.js$',
    '/src/app/',
    '/updater/',
    '/tests/_setup/',
    '/tests/_fixtures/',
    '/node_modules/.prisma/'
  ],
  coverageThreshold: {
    global: { statements: 50, branches: 40, functions: 50, lines: 50 },
    './src/core/lib/crudHelpers.ts': { statements: 80, branches: 70, functions: 80, lines: 80 },
    './src/core/lib/errorHandler.ts': { statements: 80, branches: 70, functions: 80, lines: 80 },
    './src/core/lib/errorCodes.ts': { statements: 95, branches: 90, functions: 95, lines: 95 },
    './src/core/lib/serializer.ts': { statements: 80, branches: 70, functions: 80, lines: 80 }
  },
  testTimeout: 30000
};

export default config;
