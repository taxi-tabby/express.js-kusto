import * as fs from 'fs';
import * as crypto from 'crypto';

/**
 * 파일 무결성 해시 단일 출처(SSOT).
 *
 * 생성기(analy)와 적용기(update)가 동일한 알고리즘 의미를 공유하도록 한 곳에 모은다.
 *
 * 하위호환: 파일 맵 엔트리는 `algo` 를 가질 수 있고, 없으면 과거 포맷으로 간주해 `md5` 로
 * 해석한다. 신규 맵은 `sha256` 을 명시한다. 적용기는 엔트리의 algo 로 로컬 파일을 다시
 * 해시해 비교하므로, 구/신 맵이 섞여도 항상 같은 기준으로 비교한다.
 */

export type ChecksumAlgo = 'md5' | 'sha256';

/** 신규 파일 맵이 사용하는 기본 알고리즘 */
export const DEFAULT_ALGO: ChecksumAlgo = 'sha256';

export interface FileMapEntry {
    checksum: string;
    /** 해시 알고리즘. 생략 시 'md5'(과거 포맷)으로 간주한다. */
    algo?: ChecksumAlgo;
}

export interface FileMap {
    [filePath: string]: FileMapEntry;
}

/** 맵 엔트리의 실효 알고리즘 — 명시값 우선, 없으면 과거 포맷(md5). */
export function entryAlgo(entry: FileMapEntry | undefined): ChecksumAlgo {
    return entry?.algo ?? 'md5';
}

/** 버퍼를 지정 알고리즘으로 해시한다. */
export function hashBuffer(buffer: Buffer, algo: ChecksumAlgo = DEFAULT_ALGO): string {
    return crypto.createHash(algo).update(buffer).digest('hex');
}

/**
 * 파일의 체크섬을 계산한다. 파일이 없으면 null.
 * @param algo 해시 알고리즘(기본 DEFAULT_ALGO)
 */
export function checksumFile(filePath: string, algo: ChecksumAlgo = DEFAULT_ALGO): string | null {
    try {
        if (!fs.existsSync(filePath)) return null;
        return hashBuffer(fs.readFileSync(filePath), algo);
    } catch (error) {
        console.error(`Error calculating checksum for ${filePath}:`, error);
        return null;
    }
}

/**
 * 로컬 파일이 맵 엔트리와 일치하는지 — 엔트리의 algo 로 다시 해시해 비교한다.
 * 파일이 없으면 null(미존재), 일치 true, 불일치 false.
 */
export function matchesEntry(filePath: string, entry: FileMapEntry): boolean | null {
    const local = checksumFile(filePath, entryAlgo(entry));
    if (local === null) return null;
    return local === entry.checksum;
}
