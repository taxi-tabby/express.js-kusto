const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier');
const globals = require('globals');

module.exports = tseslint.config(
    {
        ignores: [
            'dist/**',
            'coverage/**',
            'node_modules/**',
            'src/core/tmp/**',
            'src/core/lib/types/generated-*.ts',
            'src/app/db/*/client/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    prettier,
    {
        // 경량 룰: 미사용 변수 + console 컨벤션. type-aware/explicit-any 는 끔.
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-explicit-any': 'off',
            'no-console': 'error',
        },
    },
    {
        // CommonJS .js (빌드 스크립트/설정) — require/module/process 전역 인식, require() 허용
        files: ['**/*.js'],
        languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
        rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
    {
        // 운영자 도구/빌드 스크립트/설정 + 로거 구현은 console 허용 (CLAUDE.md)
        files: [
            'src/core/scripts/**',
            'src/core/cli/**',
            'src/core/updater/**',
            'src/core/external/winston.ts',
            'tests/**',
            '**/*.js',
            '**/*.config.*',
        ],
        rules: { 'no-console': 'off' },
    },
    {
        // 테스트는 jest 전역
        files: ['tests/**'],
        languageOptions: { globals: { ...globals.jest, ...globals.node } },
    },
    {
        // 동적 require() 가 필요한 런타임 TS 파일 — module loader / extension / cli
        files: [
            'src/core/lib/http/routing/loadRoutes_V6_Clean.ts',
            'src/core/lib/extensions/loadExtensions.ts',
            'src/core/lib/data/database/prismaManager.ts',
            'src/core/lib/config/packageInfo.ts',
            'src/core/cli/**',
            'src/core/updater/**',
            'tests/**',
        ],
        rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
);
