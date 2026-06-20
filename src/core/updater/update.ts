import 'module-alias/register';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as readline from 'readline';
import { checkForUpdates } from './compare';
import { PROJECT_ROOT, PACKAGE_JSON_PATH, UPDATER_DIR } from './paths';
import { FileMap, matchesEntry, checksumFile, entryAlgo } from './checksum';
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
    // 결정적 선택: 정렬 후 첫 항목(현재 패키지는 항상 1개만 담지만 미래 방어).
    const mapFiles = fs.readdirSync(fileMapDir).filter((f) => f.endsWith('.json')).sort();
    if (mapFiles.length === 0) {
        throw new Error('No file map found in update package');
    }
    return JSON.parse(fs.readFileSync(path.join(fileMapDir, mapFiles[0]), 'utf8')) as FileMap;
}

/**
 * 패키지 무결성 검증 — 추출된 각 소스 파일(files/<path>)의 체크섬이 *권위 있는* 파일맵과
 * 일치하는지 확인한다(엔트리 algo 기준). 불일치/누락 시 변조·손상으로 간주.
 *
 * 신뢰 모델(중요): GitHub 경로에서는 zip 내부 맵이 아니라 릴리스에 별도 게시된 파일맵
 * 에셋(downloadUrls.fileMap)을 권위 맵으로 받아 검증한다. 다만 이는 손상/부분전송 탐지와
 * "릴리스가 게시한 맵과 패키지 파일의 일치"까지만 보장한다. 코드 서명이 없으므로 GitHub
 * 릴리스 자체를 위조할 수 있는 공격자에 대한 암호학적 진위(authenticity)는 보장하지 않는다.
 * 신뢰 기반은 'github.com 으로의 HTTPS + 릴리스 소유권'이다. (로컬 --package 는 사용자 신뢰.)
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

    // 삭제: 직전 설치 맵에는 있었으나 새 맵에 없는 파일.
    // 단, 로컬에서 사용자가 수정한 파일은 지우지 않는다 — 설치 당시 체크섬과 여전히 일치하는
    // (= 손대지 않은 프레임워크 파일)만 삭제 대상으로 삼고, 변경됐으면 경고 후 건너뛴다.
    if (installedMap) {
        for (const [rel, installedEntry] of Object.entries(installedMap)) {
            if (rel in fileMap) continue;
            const target = path.join(PROJECT_ROOT, rel);
            const m = matchesEntry(target, installedEntry); // null=미존재, true=불변, false=수정됨
            if (m === null) continue; // 이미 없음
            if (m === false) {
                console.warn(`   Keeping locally-modified file (not removed): ${rel}`);
                continue;
            }
            plan.remove.push(rel);
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

/**
 * 적용 중 오류 시 원복 — 생성 삭제 / 백업 복원.
 * @returns 모든 원복이 성공하면 true. 하나라도 실패하면 false(호출자는 백업을 보존해야 함).
 */
function rollback(ops: AppliedOps, backupDir: string): boolean {
    console.warn('\nRolling back changes...');
    let ok = true;
    for (const rel of ops.created) {
        try { fs.rmSync(path.join(PROJECT_ROOT, rel), { force: true }); }
        catch (e) { ok = false; console.error(`   Failed to remove created ${rel}:`, e); }
    }
    for (const rel of [...ops.backedUp, ...ops.removed]) {
        try {
            fs.mkdirSync(path.dirname(path.join(PROJECT_ROOT, rel)), { recursive: true });
            fs.copyFileSync(path.join(backupDir, rel), path.join(PROJECT_ROOT, rel));
        } catch (e) {
            ok = false;
            console.error(`   Failed to restore ${rel}:`, e);
        }
    }
    console.warn(ok ? 'Rollback complete (restored from backup).' : 'Rollback INCOMPLETE — see errors above.');
    return ok;
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

/** URL 에서 JSON 을 받아 파싱한다(권위 파일맵 등). */
async function downloadJson(url: string, tempPath: string): Promise<any> {
    await downloadFile(url, tempPath);
    return JSON.parse(fs.readFileSync(tempPath, 'utf8'));
}

export async function performUpdate(options: UpdateOptions = {}): Promise<void> {
    const tempDir = path.join(UPDATER_DIR, 'temp-update');
    const extractDir = path.join(tempDir, 'extracted');
    const backupDir = path.join(tempDir, 'backup');
    let targetVersion: string | null = null;
    let packageZip: string;
    let authoritativeMap: FileMap | null = null;
    // 롤백이 불완전하면 백업을 보존해야 하므로 finally 의 정리를 막는다.
    let preserveBackup = !!options.keepBackup;

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });

    try {
        // 1) 패키지 확보: 로컬(--package) 또는 GitHub 최신 릴리스
        if (options.packagePath) {
            if (!fs.existsSync(options.packagePath)) {
                throw new Error(`Local package not found: ${options.packagePath}`);
            }
            packageZip = options.packagePath;
            console.log(`Using local package: ${packageZip}`);
            // 로컬 모드: 별도 권위 맵이 없으므로 추출 후 패키지 내부 맵을 사용(사용자 신뢰).
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
            // 권위 맵: zip 내부가 아니라 릴리스에 별도 게시된 파일맵 에셋을 받아 검증 기준으로 삼는다.
            authoritativeMap = await downloadJson(
                result.downloadUrls.fileMap, path.join(tempDir, 'authoritative-map.json')
            ) as FileMap;
        }

        // 2) 추출(zip-slip 방어)
        console.log('Extracting update package...');
        await extractZipSafe(packageZip, extractDir);
        const filesDir = path.join(extractDir, 'files');
        if (!fs.existsSync(filesDir)) {
            throw new Error('Invalid update package: files directory not found');
        }
        // 권위 맵이 없으면(로컬 모드) 패키지 내부 맵 사용.
        const fileMap: FileMap = authoritativeMap ?? loadPackageFileMap(extractDir);

        // 3) 무결성 검증(권위 맵 기준)
        verifyPackageIntegrity(filesDir, fileMap);

        // 4) 계획 수립 + 출력
        const plan = computePlan(fileMap, loadInstalledMap());
        printPlan(plan);
        const empty = plan.create.length === 0 && plan.update.length === 0 && plan.remove.length === 0;

        // 5) dry-run: 어떤 쓰기도 하지 않고 종료(설치 맵 동기화조차 하지 않음)
        if (options.dryRun) {
            console.log(empty ? '\n[dry-run] Nothing to apply.' : '\n[dry-run] No files were written.');
            return;
        }

        // 6) 적용할 것이 없으면 설치 맵만 동기화(삭제 감지 기준 최신화)하고 종료
        if (empty) {
            console.log('\nNothing to apply — already up to date.');
            writeInstalledMap(fileMap);
            return;
        }

        // 7) 최종 확인(비대화형 --yes 가 아니면 로컬/원격 모두 확인)
        if (!options.yes) {
            const ok = await askUserConfirmation('Apply the plan above?');
            if (!ok) { console.log('Update cancelled.'); return; }
        }

        // 8) 적용(백업) + 실패 시 정확한 롤백
        const ops: AppliedOps = { created: [], backedUp: [], removed: [] };
        try {
            applyPlan(plan, filesDir, backupDir, ops);
        } catch (err) {
            const restored = rollback(ops, backupDir);
            if (!restored) {
                // 원복이 불완전 — 백업을 지우면 안 됨. 사용자에게 경로 안내.
                preserveBackup = true;
                console.error(`Backup preserved for manual recovery at: ${backupDir}`);
            }
            throw err;
        }

        // 9) 성공: 설치 맵 기록 + 버전 갱신
        writeInstalledMap(fileMap);
        if (targetVersion) updatePackageVersion(targetVersion);

        console.log('\nUpdate applied successfully.');
        console.log(`   Created: ${ops.created.length}, Updated: ${ops.backedUp.length}, Removed: ${ops.removed.length}`);
        console.log('Restart your application to use the new version.');
        if (preserveBackup) console.log(`Backup kept at: ${backupDir}`);
    } finally {
        if (!preserveBackup) {
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
