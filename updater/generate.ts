import * as fs from 'fs';
import * as path from 'path';
import archiver = require('archiver');
import { generateFileMap } from './analy';

interface FileMapEntry {
    checksum: string;
}

interface FileMap {
    [filePath: string]: FileMapEntry;
}

/**
 * JSON 파일을 읽어서 파일 맵을 반환합니다.
 * @param jsonPath JSON 파일 경로
 * @returns 파일 맵 객체
 */
function loadFileMap(jsonPath: string): FileMap {
    try {
        const content = fs.readFileSync(jsonPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`Error loading file map from ${jsonPath}:`, error);
        throw error;
    }
}

/**
 * 파일 맵을 기준으로 파일들을 압축합니다.
 * @param fileMapPath 파일 맵 JSON 경로
 * @param outputPath 압축 파일 출력 경로
 * @param includeMapFile JSON 파일도 압축에 포함할지 여부
 * @returns Promise<string> 생성된 압축 파일 경로
 */
export function compressFilesFromMap(fileMapPath: string, outputPath?: string, includeMapFile: boolean = true): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Loading file map from: ${fileMapPath}`);
            const fileMap = loadFileMap(fileMapPath);
            const fileList = Object.keys(fileMap);

            console.log(`Found ${fileList.length} files to compress`);

            // 출력 경로 설정
            const baseDir = path.resolve(__dirname, '..');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const defaultOutputPath = path.join(__dirname, 'packages', `update-package-${timestamp}.zip`);
            const finalOutputPath = outputPath || defaultOutputPath;

            // 출력 디렉토리 생성
            const outputDir = path.dirname(finalOutputPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
                console.log(`Created output directory: ${outputDir}`);
            }

            // 압축 스트림 생성
            const output = fs.createWriteStream(finalOutputPath);
            const archive = archiver('zip', {
                zlib: { level: 9 } // 최고 압축률
            });

            // 이벤트 핸들러
            output.on('close', () => {
                const sizeInMB = (archive.pointer() / 1024 / 1024).toFixed(2);
                console.log(`\n=== Compression Complete ===`);
                console.log(`Archive size: ${sizeInMB} MB`);
                console.log(`Output file: ${finalOutputPath}`);
                console.log(`Files compressed: ${fileList.length}`);
                resolve(finalOutputPath);
            });

            archive.on('error', (err: Error) => {
                console.error('Archive error:', err);
                reject(err);
            });

            archive.on('warning', (err: Error) => {
                if ((err as any).code === 'ENOENT') {
                    console.warn('Warning:', err);
                } else {
                    reject(err);
                }
            });

            // 압축 스트림 연결
            archive.pipe(output);

            // 파일들을 압축에 추가
            let addedCount = 0;
            let skippedCount = 0;

            // JSON 파일 맵을 먼저 추가 (포함할 경우)
            if (includeMapFile) {
                const mapFileName = path.basename(fileMapPath);
                archive.file(fileMapPath, { name: `file-map/${mapFileName}` });
                addedCount++;
                console.log(`Added file map: ${mapFileName}`);
            }

            for (const relativePath of fileList) {
                const fullPath = path.join(baseDir, relativePath);

                try {
                    if (fs.existsSync(fullPath)) {
                        const stat = fs.statSync(fullPath);
                        if (stat.isFile()) {
                            archive.file(fullPath, { name: `files/${relativePath}` });
                            addedCount++;

                            if (addedCount % 10 === 0) {
                                console.log(`Progress: ${addedCount}/${fileList.length + (includeMapFile ? 1 : 0)} files added...`);
                            }
                        } else {
                            console.warn(`Skipping non-file: ${relativePath}`);
                            skippedCount++;
                        }
                    } else {
                        console.warn(`File not found: ${relativePath}`);
                        skippedCount++;
                    }
                } catch (error) {
                    console.error(`Error adding file ${relativePath}:`, error);
                    skippedCount++;
                }
            }

            console.log(`\nFiles added: ${addedCount}`);
            console.log(`Files skipped: ${skippedCount}`);

            // 압축 완료
            archive.finalize();

        } catch (error) {
            console.error('Error in compressFilesFromMap:', error);
            reject(error);
        }
    });
}

/**
 * 최신 파일 맵을 생성하고 해당 파일들을 압축합니다.
 * @param outputDir 압축 파일 출력 디렉토리
 */
export async function generateAndCompress(outputDir?: string): Promise<string> {
    try {
        console.log('=== Generating File Map ===');
        const mapPath = generateFileMap();

        console.log('\n=== Starting Compression ===');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputPath = outputDir
            ? path.join(outputDir, `update-package-${timestamp}.zip`)
            : undefined;

        // JSON 파일과 함께 압축
        const compressedPath = await compressFilesFromMap(mapPath, outputPath, true);

        console.log('\n=== Process Complete ===');
        console.log(`File map: ${mapPath}`);
        console.log(`Compressed package: ${compressedPath}`);
        console.log(`Package contains:`);
        console.log(`  - file-map/ : JSON file map`);
        console.log(`  - files/    : Source files`);

        return compressedPath;
    } catch (error) {
        console.error('Error in generateAndCompress:', error);
        throw error;
    }
}

/**
 * 기존 파일 맵을 사용하여 압축합니다.
 * @param mapFileName 맵 파일명 (예: 'v2025-07-15T08-26-28-826Z.json')
 * @param outputDir 압축 파일 출력 디렉토리
 */
export async function compressFromExistingMap(mapFileName: string, outputDir?: string): Promise<string> {
    try {
        const mapPath = path.join(__dirname, 'map', mapFileName);

        if (!fs.existsSync(mapPath)) {
            throw new Error(`Map file not found: ${mapPath}`);
        }

        console.log(`=== Using Existing Map: ${mapFileName} ===`);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputPath = outputDir
            ? path.join(outputDir, `update-package-${timestamp}.zip`)
            : undefined;

        const compressedPath = await compressFilesFromMap(mapPath, outputPath);

        console.log('\n=== Process Complete ===');
        console.log(`Used map: ${mapPath}`);
        console.log(`Compressed package: ${compressedPath}`);

        return compressedPath;
    } catch (error) {
        console.error('Error in compressFromExistingMap:', error);
        throw error;
    }
}

// 직접 실행 시 최신 맵 생성 후 압축
if (require.main === module) {
    generateAndCompress()
        .then((path) => {
            console.log(`\nSuccess! Package created at: ${path}`);
        })
        .catch((error) => {
            console.error('Failed to generate package:', error);
            process.exit(1);
        });
}