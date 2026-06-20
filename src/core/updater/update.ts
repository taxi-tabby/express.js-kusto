import 'module-alias/register';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as readline from 'readline';
import { checkForUpdates } from './compare';
import { PROJECT_ROOT, PACKAGE_JSON_PATH, UPDATER_DIR } from './paths';
import { FileMap, FileMapEntry, matchesEntry, checksumFile, entryAlgo } from './checksum';
import { extractZipSafe } from './archive';

/**
 * 프레임워크 자체 업데이트 적용기.
 *
 * 안전장치:
 *  - zip-slip 방어 추출(@see ./archive)
 *  - 패키지 무결성 검증: 추출된 소스 파일이 패키지 자신의 파일맵과 일치하는지 확인(변조/손상 탐지)
 *  - 자동 백업 + 실패 시 롤백: 적용 중 오류가 나면 변경/삭제된 파일을 원복
 *  - 삭제 파일 처리: 직전 설치 맵 대비 사라진 파일을 백업 후 제거
 *  - --dry-run: 변경 미리보기만, --yes: 비대화형, --package <zip>: 로컬/오프라인 적용
 */

export interface UpdateOptions {
    /** 변경 사항을 출력만 하고 실제로 쓰지 않음 */
    dryRun?: boolean;
    /** 확인 프롬프트를 생략(자동 승인) */
    yes?: boolean;
    /** GitHub 대신 로컬 업데이트 zip 을 적용(오프라인/테스트) */
    packagePath?: string;
    /** 성공 후 백업 디렉토리를 보존(기본은 정리) */
    keepBackup?: boolean;
}

interface UpdatePlan {
    create: string[];
    update: string[];
    unchanged: string[];
    /** 직전 설치 맵 대비 사라진(삭제 대상) 파일 */
    remove: string[];
}

/** 적용된 맵을 로컬에 보관 → 다음 업데이트에서 삭제 감지에 사용 */
const INSTALLED_MAP_PATH = path.join(UPDATER_DIR, '.installed-map.json');

// ──────────────────────────────────────────────────────────────────────────
// 사용자 입력
// ──────────────────────────────────────────────────────────────────────────

function askUserConfirmation(question: string): Promise<boolean> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`${question} (y/N): `, (answer) => {
            rl.close();
            const a = answer.toLowerCase().trim();
            resolve(a === 'y' || a === 'yes');
        });
    });
}

// ──────────────────────────────────────────────────────────────────────────
// 다운로드
// ──────────────────────────────────────────────────────────────────────────

function downloadFile(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log(`Downloading: ${path.basename(outputPath)}`);
        const file = fs.createWriteStream(outputPath);

        const request = https.get(url, (response) => {
            if ((response.statusCode === 301 || response.statusCode === 302) && response.headers.location) {
                file.close();
                fs.rmSync(outputPath, { force: true });
                downloadFile(response.headers.location, outputPath).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                file.close();
                fs.rmSync(outputPath, { force: true });
                reject(new Error(`Download failed with status: ${response.statusCode}`));
                return;
            }
            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloaded = 0;
            response.on('data', (chunk) => {
                downloaded += chunk.length;
                if (totalSize > 0) {
                    const pct = Math.round((downloaded / totalSize) * 100);
                    process.stdout.write(`\r   Progress: ${pct}% (${(downloaded / 1024 / 1024).toFixed(2)} MB)`);
                }
            });
            response.pipe(file);
            file.on('finish', () => { file.close(); console.log('\n   Download completed'); resolve(); });
            file.on('error', (err) => { file.close(); fs.rmSync(outputPath, { force: true }); reject(err); });
        });

        request.on('error', (err) => { file.close(); fs.rmSync(outputPath, { force: true }); reject(err); });
        request.setTimeout(30000, () => {
            request.destroy();
            file.close();
            fs.rmSync(outputPath, { force: true });
            reject(new Error('Download timeout'));
        });
    });
}

// ──────────────────────────────────────────────────────────────────────────
// 패키지 읽기 / 무결성 검증
// ──────────────────────────────────────────────────────────────────────────

/** 추출 디렉토리에서 파일맵(file-map/*.json)을 로드한다. */
function loadPackageFileMap(extractedPath: string): FileMap {
    const fileMapDir = path.join(extractedPath, 'file-map');
    if (!fs.existsSync(fileMapDir)) {
        throw new Error('Invalid update package: file-map directory not found');
    }
    const mapFiles = fs.readdirSync(fileMapDir).filter((f) => f.endsWith('.json'));
    if (mapFiles.length === 0) {
        throw new Error('No file map found in update package');
    }
    return JSON.parse(fs.readFileSync(path.join(fileMapDir, mapFiles[0]), 'utf8')) as FileMap;
}

/**
 * 패키지 무결성 검증 — 추출된 각 소스 파일(files/<path>)의 체크섬이 패키지 자신의
 * 파일맵과 일치하는지 확인한다(엔트리 algo 기준). 불일치/누락 시 변조·손상으로 간주.
 */
function verifyPackageIntegrity(filesDir: string, fileMap: FileMap): void {
    let checked = 0;
    for (const [rel, entry] of Object.entries(fileMap)) {
        const src = path.join(filesDir, rel);
        const actual = checksumFile(src, entryAlgo(entry));
        if (actual === null) {
            throw new Error(`Package integrity check failed: missing file "${rel}"`);
        }
        if (actual !== entry.checksum) {
            throw new Error(`Package integrity check failed: checksum mismatch for "${rel}"`);
        }
        checked++;
    }
    console.log(`Integrity verified: ${checked} files match the package map`);
}

// ──────────────────────────────────────────────────────────────────────────
// 계획 수립 (생성/갱신/불변/삭제)
// ──────────────────────────────────────────────────────────────────────────

function loadInstalledMap(): FileMap | null {
    try {
        if (!fs.existsSync(INSTALLED_MAP_PATH)) return null;
        return JSON.parse(fs.readFileSync(INSTALLED_MAP_PATH, 'utf8')) as FileMap;
    } catch {
        return null;
    }
}

function computePlan(fileMap: FileMap, installedMap: FileMap | null): UpdatePlan {
    const plan: UpdatePlan = { create: [], update: [], unchanged: [], remove: [] };

    for (const [rel, entry] of Object.entries(fileMap)) {
        const target = path.join(PROJECT_ROOT, rel);
        const m = matchesEntry(target, entry); // null=미존재, true=동일, false=상이
        if (m === null) plan.create.push(rel);
        else if (m === false) plan.update.push(rel);
        else plan.unchanged.push(rel);
    }

    // 삭제: 직전 설치 맵에는 있었으나 새 맵에 없는 파일(현재 존재하는 것만)
    if (installedMap) {
        for (const rel of Object.keys(installedMap)) {
            if (!(rel in fileMap) && fs.existsSync(path.join(PROJECT_ROOT, rel))) {
                plan.remove.push(rel);
            }
        }
    }
    return plan;
}

function printPlan(plan: UpdatePlan): void {
    console.log('\nUpdate plan:');
    console.log(`   Create:    ${plan.create.length}`);
    console.log(`   Update:    ${plan.update.length}`);
    console.log(`   Remove:    ${plan.remove.length}`);
    console.log(`   Unchanged: ${plan.unchanged.length}`);
    const preview = (label: string, list: string[]) => {
        if (!list.length) return;
        console.log(`\n   ${label}:`);
        list.slice(0, 20).forEach((p) => console.log(`     - ${p}`));
        if (list.length > 20) console.log(`     ... and ${list.length - 20} more`);
    };
    preview('To create', plan.create);
    preview('To update', plan.update);
    preview('To remove', plan.remove);
}

// ──────────────────────────────────────────────────────────────────────────
// 적용 + 백업 + 롤백
// ──────────────────────────────────────────────────────────────────────────

interface AppliedOps {
    /** 새로 생성한 파일(롤백 시 삭제) */
    created: string[];
    /** 덮어쓰기 전에 백업한 파일(롤백 시 백업에서 복원) */
    backedUp: string[];
    /** 삭제한 파일(롤백 시 백업에서 복원) */
    removed: string[];
}

function backupTarget(rel: string, backupDir: string): void {
    const target = path.join(PROJECT_ROOT, rel);
    const backup = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(target, backup);
}

/**
 * 계획을 적용한다. 진행 상황을 `ops`(호출자 소유)에 누적하므로, 도중에 throw 되어도
 * 호출자가 정확한 ops 로 롤백할 수 있다(생성 파일 삭제 + 백업 복원).
 */
function applyPlan(plan: UpdatePlan, filesDir: string, backupDir: string, ops: AppliedOps): void {
    // 1) 생성 (백업 불필요 — 롤백 시 그냥 삭제). 기록을 먼저 해 부분 생성도 롤백 대상에 포함.
    for (const rel of plan.create) {
        const target = path.join(PROJECT_ROOT, rel);
        ops.created.push(rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(filesDir, rel), target);
    }
    // 2) 갱신 (덮어쓰기 전 백업)
    for (const rel of plan.update) {
        backupTarget(rel, backupDir);
        ops.backedUp.push(rel);
        fs.copyFileSync(path.join(filesDir, rel), path.join(PROJECT_ROOT, rel));
    }
    // 3) 삭제 (삭제 전 백업)
    for (const rel of plan.remove) {
        backupTarget(rel, backupDir);
        ops.removed.push(rel);
        fs.rmSync(path.join(PROJECT_ROOT, rel), { force: true });
    }
}

/** 적용 중 오류 시 원복 — 생성 삭제 / 백업 복원. */
function rollback(ops: AppliedOps, backupDir: string): void {
    console.warn('\nRolling back changes...');
    for (const rel of ops.created) {
        try { fs.rmSync(path.join(PROJECT_ROOT, rel), { force: true }); } catch { /* ignore */ }
    }
    for (const rel of [...ops.backedUp, ...ops.removed]) {
        try {
            fs.mkdirSync(path.dirname(path.join(PROJECT_ROOT, rel)), { recursive: true });
            fs.copyFileSync(path.join(backupDir, rel), path.join(PROJECT_ROOT, rel));
        } catch (e) {
            console.error(`   Failed to restore ${rel}:`, e);
        }
    }
    console.warn('Rollback complete (restored from backup).');
}

// ──────────────────────────────────────────────────────────────────────────
// 버전 / 설치 맵 기록
// ──────────────────────────────────────────────────────────────────────────

function updatePackageVersion(newVersion: string): void {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    const old = pkg.version;
    pkg.version = newVersion;
    fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`Version updated: v${old} -> v${newVersion}`);
}

function writeInstalledMap(fileMap: FileMap): void {
    fs.writeFileSync(INSTALLED_MAP_PATH, JSON.stringify(fileMap, null, 2), 'utf8');
}

// ──────────────────────────────────────────────────────────────────────────
// 오케스트레이션
// ──────────────────────────────────────────────────────────────────────────

function showBackupWarning(): void {
    console.log('\nThis update will overwrite framework files in place.');
    console.log('A backup is taken automatically and restored if anything fails,');
    console.log('but committing your work to git beforehand is still recommended.\n');
}

export async function performUpdate(options: UpdateOptions = {}): Promise<void> {
    const tempDir = path.join(UPDATER_DIR, 'temp-update');
    const extractDir = path.join(tempDir, 'extracted');
    const backupDir = path.join(tempDir, 'backup');
    let targetVersion: string | null = null;
    let packageZip: string;

    // 1) 패키지 확보: 로컬(--package) 또는 GitHub 최신 릴리스
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });

    try {
        if (options.packagePath) {
            if (!fs.existsSync(options.packagePath)) {
                throw new Error(`Local package not found: ${options.packagePath}`);
            }
            packageZip = options.packagePath;
            console.log(`Using local package: ${packageZip}`);
        } else {
            const result = await checkForUpdates();
            if (!result.updateAvailable) {
                console.log('You are already on the latest version.');
                return;
            }
            if (!result.downloadUrls) {
                console.log('Download URLs not available in the release.');
                return;
            }
            targetVersion = result.latestVersion;
            console.log('Update available:');
            console.log(`   Current: v${result.currentVersion}`);
            console.log(`   Latest:  v${result.latestVersion}`);
            console.log(`   Release: ${result.releaseInfo?.html_url}`);
            showBackupWarning();

            if (!options.dryRun && !options.yes) {
                const ok = await askUserConfirmation(`Update from v${result.currentVersion} to v${result.latestVersion}?`);
                if (!ok) { console.log('Update cancelled.'); return; }
            }
            packageZip = path.join(tempDir, 'update-package.zip');
            await downloadFile(result.downloadUrls.package, packageZip);
        }

        // 2) 추출(zip-slip 방어) + 무결성 검증
        console.log('Extracting update package...');
        await extractZipSafe(packageZip, extractDir);
        const filesDir = path.join(extractDir, 'files');
        if (!fs.existsSync(filesDir)) {
            throw new Error('Invalid update package: files directory not found');
        }
        const fileMap = loadPackageFileMap(extractDir);
        verifyPackageIntegrity(filesDir, fileMap);

        // 3) 계획 수립 + 출력
        const plan = computePlan(fileMap, loadInstalledMap());
        printPlan(plan);

        if (plan.create.length === 0 && plan.update.length === 0 && plan.remove.length === 0) {
            console.log('\nNothing to apply — already up to date.');
            writeInstalledMap(fileMap); // 설치 맵 동기화(삭제 감지 기준 최신화)
            return;
        }

        // 4) dry-run 이면 여기서 종료
        if (options.dryRun) {
            console.log('\n[dry-run] No files were written.');
            return;
        }

        // 5) 비대화형 최종 확인
        if (!options.yes && !options.packagePath) {
            const ok = await askUserConfirmation('Apply the plan above?');
            if (!ok) { console.log('Update cancelled.'); return; }
        }

        // 6) 적용(백업) + 실패 시 정확한 롤백
        const ops: AppliedOps = { created: [], backedUp: [], removed: [] };
        try {
            applyPlan(plan, filesDir, backupDir, ops);
        } catch (err) {
            rollback(ops, backupDir);
            throw err;
        }

        // 7) 성공: 설치 맵 기록 + 버전 갱신
        writeInstalledMap(fileMap);
        if (targetVersion) updatePackageVersion(targetVersion);

        console.log('\nUpdate applied successfully.');
        console.log(`   Created: ${ops.created.length}, Updated: ${ops.backedUp.length}, Removed: ${ops.removed.length}`);
        console.log('Restart your application to use the new version.');

        if (options.keepBackup) {
            console.log(`Backup kept at: ${backupDir}`);
        }
    } finally {
        if (!options.keepBackup) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }
}

function parseArgs(argv: string[]): UpdateOptions {
    const opts: UpdateOptions = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') opts.dryRun = true;
        else if (a === '--yes' || a === '-y') opts.yes = true;
        else if (a === '--keep-backup') opts.keepBackup = true;
        else if (a === '--package') opts.packagePath = argv[++i];
        else if (a.startsWith('--package=')) opts.packagePath = a.slice('--package='.length);
    }
    return opts;
}

export async function runUpdate(options?: UpdateOptions): Promise<void> {
    try {
        await performUpdate(options ?? parseArgs(process.argv.slice(2)));
    } catch (error) {
        console.error('\nUpdate process failed:', error instanceof Error ? error.message : error);
        console.error('Any partial changes were rolled back from backup.');
        process.exit(1);
    }
}

// yauzl 의존성 확인 (archive 가 지연 require)
try {
    require('yauzl');
} catch {
    console.error('Missing dependency: yauzl. Install with: npm install yauzl');
    process.exit(1);
}

if (require.main === module) {
    runUpdate();
}
