import { shouldExcludeFromDeployment, shouldSkipDirectory } from '@core/updater/analy';

/**
 * 회귀 (배포 맵 누설):
 * 자체 업데이터(`kusto update`)는 "프레임워크 소유 파일만" 배포해야 하는데(updater/AGENTS.md),
 * 스캔이 inclusive-by-default 라 소비자 소유 파일이 맵에 새어 들어가 업데이트 때 소비자 파일을
 * 덮어썼다. 엄격 재분석으로 확정한 제외/배포 경계를 두 SSOT 술어로 고정한다:
 *   - shouldSkipDirectory      : 소비자 소유 트리(src/app, tests, public) + updater 자기 자신 스킵
 *   - shouldExcludeFromDeployment : 소비자 소유 프로젝트 설정/메타 파일명 제외
 */
describe('updater 배포 맵 — 소비자 소유 파일 제외', () => {
    describe('shouldSkipDirectory — 소비자 소유 트리 스킵', () => {
        it.each([
            ['node_modules', 'node_modules'],
            ['app', 'src/app'],
            ['routes', 'src/app/routes'],
            ['updater', 'src/core/updater'],
            ['tests', 'tests'],
            ['unit', 'tests/unit'],
            ['public', 'public'],
        ])('스킵한다: %s (%s)', (dirName, relativePath) => {
            expect(shouldSkipDirectory(dirName, relativePath)).toBe(true);
        });

        it.each([
            ['core', 'src/core'],
            ['lib', 'src/core/lib'],
            ['docs', 'docs'],
            ['bin', 'bin'],
        ])('스킵하지 않는다(배포 대상): %s (%s)', (dirName, relativePath) => {
            expect(shouldSkipDirectory(dirName, relativePath)).toBe(false);
        });
    });

    describe('shouldExcludeFromDeployment — 소비자 소유 파일 제외', () => {
        it.each([
            ['jest.config.ts', 'jest.config.ts'],
            ['jest.config.js', 'jest.config.js'],
            ['jest.config.cjs', 'jest.config.cjs'],
            ['prisma.config.ts', 'prisma.config.ts'],
            ['CLAUDE.md', 'CLAUDE.md'],
            ['artillery-test.yml', 'artillery-test.yml'],
            ['README.md', 'README.md'],
            ['package.json', 'package.json'],
            ['tsconfig.json', 'tsconfig.json'],
        ])('제외한다: %s', (fileName, relativePath) => {
            expect(shouldExcludeFromDeployment(fileName, relativePath)).toBe(true);
        });

        it.each([
            ['index.ts', 'src/index.ts'],
            ['kusto.js', 'bin/kusto.js'],
            ['00-documentation-index.md', 'docs/00-documentation-index.md'],
            ['10-extension-system.md', 'docs/10-extension-system.md'],
            ['prismaManager.ts', 'src/core/lib/data/database/prismaManager.ts'],
        ])('제외하지 않는다(배포 대상): %s', (fileName, relativePath) => {
            expect(shouldExcludeFromDeployment(fileName, relativePath)).toBe(false);
        });
    });
});
