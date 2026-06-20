import 'module-alias/register';
import * as fs from 'fs';
import * as https from 'https';
import { PACKAGE_JSON_PATH } from './paths';

interface ReleaseInfo {
    tag_name: string;
    name: string;
    published_at: string;
    html_url: string;
    assets: Array<{
        name: string;
        download_url: string;  // 실제 GitHub API에서 사용하는 필드명
        size: number;
    }>;
}

export interface ComparisonResult {
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    releaseInfo?: ReleaseInfo;
    downloadUrls?: {
        package: string;
        fileMap: string;
    };
}

interface PackageJson {
    version: string;
    name: string;
}

/**
 * package.json에서 현재 버전을 읽어옵니다.
 */
function getCurrentVersion(): string {
    try {
        const packageContent = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
        const packageJson: PackageJson = JSON.parse(packageContent);
        return packageJson.version;
    } catch (error) {
        console.error('Error reading package.json:', error);
        throw new Error('Failed to read current version');
    }
}

/**
 * GitHub API를 호출하여 최신 릴리즈 정보를 가져옵니다.
 */
function fetchLatestRelease(): Promise<ReleaseInfo> {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/taxi-tabby/express.js-kusto/releases/latest',
            method: 'GET',
            headers: {
                'User-Agent': 'Express-Kusto-Framework-Updater',
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const release = JSON.parse(data);

                        // assets 정보 매핑
                        const assets = release.assets?.map((asset: any) => ({
                            name: asset.name,
                            download_url: asset.browser_download_url,
                            size: asset.size
                        })) || [];

                        const releaseInfo: ReleaseInfo = {
                            tag_name: release.tag_name,
                            name: release.name,
                            published_at: release.published_at,
                            html_url: release.html_url,
                            assets
                        };

                        resolve(releaseInfo);
                    } else {
                        reject(new Error(`GitHub API returned status ${res.statusCode}: ${data}`));
                    }
                } catch (error) {
                    reject(new Error(`Failed to parse GitHub API response: ${error}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`GitHub API request failed: ${error.message}`));
        });

        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('GitHub API request timeout'));
        });

        req.end();
    });
}

/**
 * 버전 문자열을 비교 가능한 형태로 파싱합니다.
 * framework-v0.0.13-2025.07.15-0930 형태의 태그에서 버전을 추출
 */
function parseVersionFromTag(tagName: string): string | null {
    // framework-v{version}-{timestamp} 형태에서 version 부분 추출
    const match = tagName.match(/framework-v(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
}

/**
 * 두 버전을 비교합니다. (semantic versioning)
 * @param version1 첫 번째 버전
 * @param version2 두 번째 버전
 * @returns -1: version1 < version2, 0: equal, 1: version1 > version2
 */
function compareVersions(version1: string, version2: string): number {
    const v1parts = version1.split('.').map(Number);
    const v2parts = version2.split('.').map(Number);

    for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
        const v1part = v1parts[i] || 0;
        const v2part = v2parts[i] || 0;

        if (v1part < v2part) return -1;
        if (v1part > v2part) return 1;
    }

    return 0;
}

/**
 * 릴리즈 에셋에서 다운로드 URL을 찾습니다.
 */
function extractDownloadUrls(assets: ReleaseInfo['assets']): { package: string; fileMap: string } | null {
    console.log('🔍 Searching for download assets...');
    console.log(`📋 Found ${assets.length} assets in release:`);
    console.log('📋 Full asset details:', JSON.stringify(assets, null, 2));
    
    let packageUrl: string | undefined;
    let fileMapUrl: string | undefined;

    for (const asset of assets) {
        console.log(`   📄 Asset: ${asset.name}`);
        
        // 업데이트 패키지 파일 찾기 (update-package-*.zip 패턴)
        if (asset.name.startsWith('update-package-') && asset.name.endsWith('.zip')) {
            packageUrl = asset.download_url;
            console.log(`   ✅ Found package: ${asset.name} -> ${packageUrl}`);
        } 
        // 파일 맵 찾기 (v*.json 패턴)
        else if (asset.name.startsWith('v') && asset.name.endsWith('.json')) {
            fileMapUrl = asset.download_url;
            console.log(`   ✅ Found file map: ${asset.name} -> ${fileMapUrl}`);
        }
    }

    console.log(`🔍 Final URLs: package=${packageUrl}, fileMap=${fileMapUrl}`);

    if (!packageUrl) {
        console.log('❌ Package file not found in assets');
    }
    if (!fileMapUrl) {
        console.log('❌ File map not found in assets');
    }

    const result = packageUrl && fileMapUrl ? { package: packageUrl, fileMap: fileMapUrl } : null;
    console.log(`🎯 Returning result:`, result);
    
    return result;
}

/**
 * 현재 버전과 최신 릴리즈를 비교하여 업데이트 가능 여부를 확인합니다.
 */
export async function checkForUpdates(): Promise<ComparisonResult> {
    try {
        console.log('🔍 Checking for framework updates...');

        // 현재 버전 가져오기
        const currentVersion = getCurrentVersion();
        console.log(`📦 Current version: v${currentVersion}`);

        // 최신 릴리즈 정보 가져오기
        console.log('🌐 Fetching latest release from GitHub...');
        const releaseInfo = await fetchLatestRelease();

        // 태그에서 버전 추출
        const latestVersion = parseVersionFromTag(releaseInfo.tag_name);

        if (!latestVersion) {
            throw new Error(`Invalid tag format: ${releaseInfo.tag_name}`);
        }

        console.log(`🏷️  Latest release: ${releaseInfo.tag_name} (v${latestVersion})`);

        // 버전 비교
        const comparison = compareVersions(currentVersion, latestVersion);
        const updateAvailable = comparison < 0; // 현재 버전이 더 낮으면 업데이트 가능

        // 다운로드 URL 추출
        const downloadUrls = extractDownloadUrls(releaseInfo.assets);

        const result: ComparisonResult = {
            currentVersion,
            latestVersion,
            updateAvailable,
            releaseInfo,
            downloadUrls: downloadUrls || undefined
        };

        return result;

    } catch (error) {
        console.error('❌ Error checking for updates:', error);
        throw error;
    }
}

/**
 * 업데이트 확인 결과를 사용자 친화적으로 출력합니다.
 */
export function displayUpdateStatus(result: ComparisonResult): void {
    console.log('\n=== 📋 Update Status ===');
    console.log(`Current Version: v${result.currentVersion}`);
    console.log(`Latest Version:  v${result.latestVersion}`);

    if (result.updateAvailable) {
        console.log('✅ Update Available!');
        console.log(`🔗 Release URL: ${result.releaseInfo?.html_url}`);
        console.log(`📅 Published: ${result.releaseInfo?.published_at}`);

        if (result.downloadUrls) {
            console.log('\n📥 Download Links:');
            console.log(`   Package: ${result.downloadUrls.package}`);
            console.log(`   File Map: ${result.downloadUrls.fileMap}`);
        }

        if (result.releaseInfo?.assets) {
            console.log(`\n📦 Assets (${result.releaseInfo.assets.length}):`);
            result.releaseInfo.assets.forEach(asset => {
                const sizeMB = (asset.size / 1024 / 1024).toFixed(2);
                console.log(`   • ${asset.name} (${sizeMB} MB)`);
            });
        }
    } else if (result.currentVersion === result.latestVersion) {
        console.log('✅ You are on the latest version!');
    } else {
        console.log('ℹ️  You are ahead of the latest release');
    }

    console.log('========================\n');
}

/**
 * 업데이트 확인 및 결과 출력을 수행합니다.
 */
export async function runUpdateCheck(): Promise<void> {
    try {
        const result = await checkForUpdates();
        displayUpdateStatus(result);

        if (result.updateAvailable) {
            console.log('💡 To update, download the package and extract it to your framework directory.');
            console.log('   Or run: npm run updater:download (if implemented)');
        }

    } catch (error) {
        console.error('Failed to check for updates:', error);
        process.exit(1);
    }
}

// 직접 실행 시 업데이트 확인 수행
if (require.main === module) {
    runUpdateCheck();
}