import * as fs from 'fs';
import * as path from 'path';

/**
 * ZIP 추출 — zip-slip(경로 탈출) 방어 포함.
 *
 * 과거 구현은 `path.join(extractPath, entry.fileName)` 를 그대로 사용해, 악의적/손상된
 * 아카이브가 `../../..` 를 담으면 추출 루트 밖으로 파일을 쓸 수 있었다(zip-slip).
 * 여기서는 각 엔트리의 정규화된 목적 경로가 추출 루트 내부인지 검증하고, 벗어나면 거부한다.
 */

/**
 * 아카이브 엔트리의 목적 경로가 추출 루트 내부에 머무는지(zip-slip 안전) 판별하는 순수 함수.
 * 루트를 벗어나거나(상위 `..`/절대경로) 루트 자신을 가리키면 false.
 */
export function isEntryInsideRoot(extractRoot: string, entryName: string): boolean {
    const root = path.resolve(extractRoot);
    const target = path.resolve(root, entryName);
    const rel = path.relative(root, target);
    if (rel === '') return false; // 루트 자신을 파일 대상으로 쓰는 것은 거부
    return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 목적 경로가 추출 루트 내부인지 검증(zip-slip 방어). 벗어나면 Error. */
function resolveSafe(extractRoot: string, entryName: string): string {
    if (!isEntryInsideRoot(extractRoot, entryName)) {
        throw new Error(`Blocked path traversal in archive entry: "${entryName}"`);
    }
    return path.resolve(path.resolve(extractRoot), entryName);
}

/**
 * ZIP 파일을 안전하게 추출한다.
 * @returns 추출된 파일 수
 */
export async function extractZipSafe(zipPath: string, extractPath: string): Promise<number> {
    // yauzl 은 선택적 의존성이므로 지연 require.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const yauzl = require('yauzl');
    const root = path.resolve(extractPath);
    fs.mkdirSync(root, { recursive: true });

    return new Promise<number>((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err: any, zipfile: any) => {
            if (err) return reject(err);
            let count = 0;

            zipfile.readEntry();

            zipfile.on('entry', (entry: any) => {
                let target: string;
                try {
                    target = resolveSafe(root, entry.fileName);
                } catch (e) {
                    // 경로 탈출 시도 — 아카이브를 신뢰할 수 없으므로 추출 중단.
                    zipfile.close();
                    return reject(e);
                }

                if (/\/$/.test(entry.fileName)) {
                    // 디렉토리 엔트리
                    fs.mkdirSync(target, { recursive: true });
                    zipfile.readEntry();
                    return;
                }

                fs.mkdirSync(path.dirname(target), { recursive: true });
                zipfile.openReadStream(entry, (streamErr: any, readStream: any) => {
                    if (streamErr) return reject(streamErr);
                    const writeStream = fs.createWriteStream(target);
                    readStream.pipe(writeStream);
                    writeStream.on('close', () => {
                        count++;
                        zipfile.readEntry();
                    });
                    writeStream.on('error', reject);
                });
            });

            zipfile.on('end', () => resolve(count));
            zipfile.on('error', reject);
        });
    });
}
