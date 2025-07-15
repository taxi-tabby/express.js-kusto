import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as readline from 'readline';
import * as crypto from 'crypto';
import { checkForUpdates, ComparisonResult } from './compare';

interface DownloadProgress {
    downloaded: number;
    total: number;
    percentage: number;
}

interface FileMapEntry {
    checksum: string;
}

interface FileMap {
    [filePath: string]: FileMapEntry;
}

interface UpdateStats {
    total: number;
    updated: number;
    created: number;
    skipped: number;
}

/**
 * 파일의 체크섬을 계산합니다.
 */
function calculateFileChecksum(filePath: string): string | null {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const fileBuffer = fs.readFileSync(filePath);
        const hashSum = crypto.createHash('md5');
        hashSum.update(fileBuffer);
        return hashSum.digest('hex');
    } catch (error) {
        console.error(`Error calculating checksum for ${filePath}:`, error);
        return null;
    }
}

/**
 * 사용자 입력을 받기 위한 readline 인터페이스 생성
 */
function createReadlineInterface(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * 사용자에게 확인을 요청합니다.
 */
function askUserConfirmation(question: string): Promise<boolean> {
    return new Promise((resolve) => {
        const rl = createReadlineInterface();

        rl.question(`${question} (y/N): `, (answer) => {
            rl.close();
            const confirmed = answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes';
            resolve(confirmed);
        });
    });
}

/**
 * 파일을 다운로드합니다.
 */
function downloadFile(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log(`📥 Downloading: ${path.basename(outputPath)}`);

        const file = fs.createWriteStream(outputPath);

        const request = https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // 리다이렉트 처리
                if (response.headers.location) {
                    file.close();
                    fs.unlinkSync(outputPath);
                    downloadFile(response.headers.location, outputPath)
                        .then(resolve)
                        .catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 200) {
                file.close();
                fs.unlinkSync(outputPath);
                reject(new Error(`Download failed with status: ${response.statusCode}`));
                return;
            }

            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedSize = 0;

            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (totalSize > 0) {
                    const percentage = Math.round((downloadedSize / totalSize) * 100);
                    process.stdout.write(`\r   Progress: ${percentage}% (${(downloadedSize / 1024 / 1024).toFixed(2)} MB / ${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log('\n   ✅ Download completed');
                resolve();
            });

            file.on('error', (err) => {
                file.close();
                fs.unlinkSync(outputPath);
                reject(err);
            });
        });

        request.on('error', (err) => {
            file.close();
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
            reject(err);
        });

        request.setTimeout(30000, () => {
            request.destroy();
            file.close();
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
            reject(new Error('Download timeout'));
        });
    });
}

/**
 * ZIP 파일을 추출합니다.
 */
async function extractZipFile(zipPath: string, extractPath: string): Promise<void> {
    const yauzl = require('yauzl');

    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err: any, zipfile: any) => {
            if (err) {
                reject(err);
                return;
            }

            zipfile.readEntry();

            zipfile.on('entry', (entry: any) => {
                if (/\/$/.test(entry.fileName)) {
                    // 디렉토리
                    const dirPath = path.join(extractPath, entry.fileName);
                    fs.mkdirSync(dirPath, { recursive: true });
                    zipfile.readEntry();
                } else {
                    // 파일
                    const filePath = path.join(extractPath, entry.fileName);
                    const fileDir = path.dirname(filePath);

                    fs.mkdirSync(fileDir, { recursive: true });

                    zipfile.openReadStream(entry, (err: any, readStream: any) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        const writeStream = fs.createWriteStream(filePath);
                        readStream.pipe(writeStream);

                        writeStream.on('close', () => {
                            zipfile.readEntry();
                        });

                        writeStream.on('error', reject);
                    });
                }
            });

            zipfile.on('end', () => {
                resolve();
            });

            zipfile.on('error', reject);
        });
    });
}

/**
 * 업데이트 파일들을 체크섬 비교하여 적용합니다.
 */
async function applyUpdate(extractedPath: string): Promise<UpdateStats> {
    const filesDir = path.join(extractedPath, 'files');
    const fileMapDir = path.join(extractedPath, 'file-map');
    const projectRoot = path.resolve(__dirname, '..');

    if (!fs.existsSync(filesDir)) {
        throw new Error('Invalid update package: files directory not found');
    }

    if (!fs.existsSync(fileMapDir)) {
        throw new Error('Invalid update package: file-map directory not found');
    }

    console.log('📝 Applying updates with checksum verification...');

    // 파일 맵 로드
    const mapFiles = fs.readdirSync(fileMapDir).filter(f => f.endsWith('.json'));
    if (mapFiles.length === 0) {
        throw new Error('No file map found in update package');
    }

    const mapFilePath = path.join(fileMapDir, mapFiles[0]);
    const fileMapContent = fs.readFileSync(mapFilePath, 'utf8');
    const fileMap: FileMap = JSON.parse(fileMapContent);

    const stats: UpdateStats = {
        total: Object.keys(fileMap).length,
        updated: 0,
        created: 0,
        skipped: 0
    };

    console.log(`📊 Checking ${stats.total} files for updates...`);

    // 각 파일을 체크섬으로 비교하여 업데이트
    for (const [relativePath, mapEntry] of Object.entries(fileMap)) {
        const sourcePath = path.join(filesDir, relativePath);
        const targetPath = path.join(projectRoot, relativePath);

        if (!fs.existsSync(sourcePath)) {
            console.warn(`⚠️  Source file missing: ${relativePath}`);
            stats.skipped++;
            continue;
        }

        // 현재 파일의 체크섬 계산
        const currentChecksum = calculateFileChecksum(targetPath);

        if (currentChecksum === null) {
            // 파일이 존재하지 않음 - 새로 생성
            const targetDir = path.dirname(targetPath);
            fs.mkdirSync(targetDir, { recursive: true });
            fs.copyFileSync(sourcePath, targetPath);
            console.log(`   ✨ Created: ${relativePath}`);
            stats.created++;
        } else if (currentChecksum !== mapEntry.checksum) {
            // 체크섬이 다름 - 업데이트 필요
            const targetDir = path.dirname(targetPath);
            fs.mkdirSync(targetDir, { recursive: true });
            fs.copyFileSync(sourcePath, targetPath);
            console.log(`   🔄 Updated: ${relativePath}`);
            stats.updated++;
        } else {
            // 체크섬이 같음 - 건너뛰기
            console.log(`   ✅ Skipped: ${relativePath} (unchanged)`);
            stats.skipped++;
        }
    }

    console.log('\n📊 Update Summary:');
    console.log(`   📁 Total files: ${stats.total}`);
    console.log(`   ✨ Created: ${stats.created}`);
    console.log(`   🔄 Updated: ${stats.updated}`);
    console.log(`   ✅ Skipped: ${stats.skipped} (unchanged)`);
    console.log('✅ Update applied successfully');

    return stats;
}

/**
 * package.json 버전을 업데이트합니다.
 */
function updatePackageVersion(newVersion: string): void {
    const packagePath = path.resolve(__dirname, '..', 'package.json');
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    const packageJson = JSON.parse(packageContent);

    const oldVersion = packageJson.version;
    packageJson.version = newVersion;

    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
    console.log(`📦 Version updated: v${oldVersion} → v${newVersion}`);
}

/**
 * 백업 생성을 권장하는 경고를 표시합니다.
 */
async function showBackupWarning(): Promise<boolean> {
    console.log('\n⚠️  IMPORTANT WARNING ⚠️');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔥 This update process will OVERWRITE existing files!');
    console.log('🔄 There is NO automatic rollback mechanism!');
    console.log('📁 Please BACKUP your project before proceeding!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nRecommended backup steps:');
    console.log('1. Copy your entire project directory to a safe location');
    console.log('2. Commit any uncommitted changes to git');
    console.log('3. Create a git branch/tag before updating');
    console.log('');

    return await askUserConfirmation('Have you created a backup and want to continue?');
}

/**
 * 업데이트 확인 및 적용을 수행합니다.
 */
export async function performUpdate(): Promise<void> {
    try {
        console.log('🔍 Checking for framework updates...\n');

        // 업데이트 확인
        const result = await checkForUpdates();

        if (!result.updateAvailable) {
            console.log('✅ You are already on the latest version!');
            return;
        }

        if (!result.downloadUrls) {
            console.log('❌ Download URLs not available in the release');
            return;
        }

        // 업데이트 정보 표시
        console.log('📋 Update Information:');
        console.log(`   Current Version: v${result.currentVersion}`);
        console.log(`   Latest Version:  v${result.latestVersion}`);
        console.log(`   Release URL: ${result.releaseInfo?.html_url}`);
        console.log('');

        // 백업 경고 및 확인
        const backupConfirmed = await showBackupWarning();
        if (!backupConfirmed) {
            console.log('❌ Update cancelled by user. Please create a backup first.');
            return;
        }

        // 최종 확인
        const finalConfirm = await askUserConfirmation(`Are you sure you want to update from v${result.currentVersion} to v${result.latestVersion}?`);
        if (!finalConfirm) {
            console.log('❌ Update cancelled by user.');
            return;
        }

        console.log('\n🚀 Starting update process...\n');

        // 임시 디렉토리 생성
        const tempDir = path.join(__dirname, 'temp-update');
        const extractDir = path.join(tempDir, 'extracted');

        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        fs.mkdirSync(tempDir, { recursive: true });
        fs.mkdirSync(extractDir, { recursive: true });

        try {
            // 업데이트 패키지 다운로드
            const packagePath = path.join(tempDir, 'update-package.zip');
            await downloadFile(result.downloadUrls.package, packagePath);

            // ZIP 파일 추출
            console.log('📦 Extracting update package...');
            await extractZipFile(packagePath, extractDir);
            console.log('✅ Extraction completed');

            // 업데이트 적용
            const updateStats = await applyUpdate(extractDir);

            // 버전 업데이트
            updatePackageVersion(result.latestVersion);

            console.log('\n🎉 Framework update completed successfully!');
            console.log(`📈 Updated from v${result.currentVersion} to v${result.latestVersion}`);
            console.log(`📊 Changes: ${updateStats.created} created, ${updateStats.updated} updated, ${updateStats.skipped} unchanged`);
            console.log('🔄 Please restart your application to use the new version.');

        } finally {
            // 임시 파일 정리
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        }

    } catch (error) {
        console.error('❌ Update failed:', error);
        throw error;
    }
}

/**
 * 업데이트 실행 및 오류 처리
 */
export async function runUpdate(): Promise<void> {
    try {
        await performUpdate();
    } catch (error) {
        console.error('\n💥 Update process failed!');
        console.error('Please check the error above and try again.');
        console.error('If you have a backup, you may need to restore it.');
        process.exit(1);
    }
}

// yauzl 패키지 설치 확인
try {
    require('yauzl');
} catch (error) {
    console.error('❌ Missing dependency: yauzl');
    console.error('Please install it with: npm install yauzl @types/yauzl');
    process.exit(1);
}

// 직접 실행 시 업데이트 수행
if (require.main === module) {
    runUpdate();
}