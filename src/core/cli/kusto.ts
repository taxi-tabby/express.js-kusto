import 'module-alias/register';
import { Command } from 'commander';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { program as dbProgram } from '@core/scripts/kusto-db-cli';
import { runUpdateCheck } from '@core/updater/compare';
import { runUpdate } from '@core/updater/update';
import { generateAndCompress } from '@core/updater/generate';
import { PACKAGE_JSON_PATH } from '@core/updater/paths';
import { runMonitor } from '@core/cli/monitor/monitorTui';

/**
 * 통합 프로젝트 CLI — `kusto`.
 *
 * 흩어져 있던 진입점(db CLI, updater 스크립트, 타입 generate)을 하나의 commander 트리로
 * 묶는다. 기존 npm 스크립트(db / updater:* / generate)도 그대로 동작한다.
 *
 *   kusto db <...>                 데이터베이스/Prisma 관리 (기존 kusto-db CLI)
 *   kusto update check             업데이트 확인
 *   kusto update apply [opts]      최신 업데이트 다운로드·적용
 *   kusto update build             릴리스 업데이트 패키지 생성(메인테이너)
 *   kusto generate [--build]       프레임워크 타입 생성(db/injectable/repository)
 */

const pkgVersion: string = require(PACKAGE_JSON_PATH).version ?? '0.0.0';

const kusto = new Command('kusto')
    .description('Express.js-Kusto framework CLI')
    .version(pkgVersion);

// ── db: 기존 db CLI program 을 'db' 서브커맨드로 마운트 ──────────────────────
dbProgram.name('db').description('Database / Prisma management');
kusto.addCommand(dbProgram);

// ── update: 프레임워크 자체 업데이트 ─────────────────────────────────────────
const update = new Command('update').description('Framework self-update');

update
    .command('check')
    .description('Check whether a newer framework release is available')
    .action(async () => {
        await runUpdateCheck();
    });

update
    .command('apply')
    .description('Download and apply the latest framework update')
    .option('--dry-run', 'Preview the changes without writing any files')
    .option('-y, --yes', 'Skip confirmation prompts (non-interactive)')
    .option('--package <zip>', 'Apply a local update package instead of downloading (offline)')
    .option('--keep-backup', 'Keep the backup directory after a successful update')
    .action(async (opts) => {
        await runUpdate({
            dryRun: opts.dryRun,
            yes: opts.yes,
            packagePath: opts.package,
            keepBackup: opts.keepBackup,
        });
    });

update
    .command('build')
    .description('Build a release update package + file map (maintainers)')
    .action(async () => {
        await generateAndCompress();
    });

kusto.addCommand(update);

// ── monitor: 실행 중인 dev 서버의 실시간 상태(htop 형) ───────────────────────
kusto
    .command('monitor')
    .alias('top')
    .description(
        'Live server dashboard (process / requests / DB / routes). Dev server must be running.',
    )
    .option('--url <url>', 'Full metrics URL (overrides host/port)')
    .option('--host <host>', 'Server host (default localhost)')
    .option('--port <port>', 'Server port (default $PORT or 3000)', (v) => parseInt(v, 10))
    .option('--interval <ms>', 'Refresh interval in ms (default 1000)', (v) => parseInt(v, 10))
    .action((opts) => {
        runMonitor({ url: opts.url, host: opts.host, port: opts.port, interval: opts.interval });
    });

// ── generate: 프레임워크 타입 생성 (db/injectable/repository) ─────────────────
kusto
    .command('generate')
    .description('Generate framework types (db / injectable / repository)')
    .option('--build', 'Include build-time generators (routes map, etc.)')
    .action((opts) => {
        const scriptPath = path.resolve(__dirname, '..', 'scripts', 'generate.js');
        const args = opts.build ? ['--build'] : [];
        const res = spawnSync(process.execPath, [scriptPath, ...args], { stdio: 'inherit' });
        if (res.error) {
            console.error(`Failed to run generate: ${res.error.message}`);
            process.exit(1);
        }
        process.exit(res.status ?? 1);
    });

// ── extensions: 설치된 확장의 빌드 훅 실행 ───────────────────────────────────
const extensions = new Command('extensions').description('Kusto extension tooling');
extensions
    .command('build')
    .description("Run installed extensions' onBuild hooks (e.g. bundle client assets)")
    .option('--production', 'Build in production mode')
    .action(async (opts) => {
        // 무거운 라우팅 그래프를 모든 CLI 호출에서 끌어오지 않도록 지연 로드.

        const { loadExtensions } = require('@lib/extensions/loadExtensions');

        const { extensionRegistry } = require('@lib/extensions/extensionRegistry');

        const { log } = require('@ext/winston');
        const loaded = loadExtensions();
        await extensionRegistry.runBuild({
            rootDir: process.cwd(),
            appDir: path.resolve(process.cwd(), 'src', 'app'),
            isProduction: !!opts.production || process.env.NODE_ENV === 'production',
            log,
        });
        console.log(`Extension build complete (${loaded.length} extension(s)).`);
    });
kusto.addCommand(extensions);

kusto.parseAsync(process.argv).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
