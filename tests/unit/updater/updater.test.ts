import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
    hashBuffer,
    entryAlgo,
    checksumFile,
    matchesEntry,
    DEFAULT_ALGO,
} from '@core/updater/checksum';
import { isEntryInsideRoot } from '@core/updater/archive';

describe('updater/checksum — 해시 SSOT + 하위호환', () => {
    it('DEFAULT_ALGO 는 sha256 이다', () => {
        expect(DEFAULT_ALGO).toBe('sha256');
    });

    it('hashBuffer 는 알고리즘별로 올바른 길이의 hex 를 낸다', () => {
        const buf = Buffer.from('kusto');
        expect(hashBuffer(buf, 'md5')).toHaveLength(32);
        expect(hashBuffer(buf, 'sha256')).toHaveLength(64);
        // 동일 입력 → 결정적
        expect(hashBuffer(buf, 'sha256')).toBe(hashBuffer(Buffer.from('kusto'), 'sha256'));
    });

    it('entryAlgo: algo 없으면 과거 포맷(md5), 있으면 명시값', () => {
        expect(entryAlgo({ checksum: 'x' })).toBe('md5');
        expect(entryAlgo({ checksum: 'x', algo: 'sha256' })).toBe('sha256');
        expect(entryAlgo(undefined)).toBe('md5');
    });

    it('matchesEntry: 엔트리 algo 기준으로 로컬 파일과 비교(구/신 맵 혼용 안전)', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kusto-cs-'));
        const file = path.join(dir, 'a.txt');
        fs.writeFileSync(file, 'hello');
        try {
            const sha = checksumFile(file, 'sha256')!;
            const md5 = checksumFile(file, 'md5')!;
            // 신규 맵(sha256) 엔트리와 일치
            expect(matchesEntry(file, { checksum: sha, algo: 'sha256' })).toBe(true);
            // 과거 맵(algo 생략 → md5) 엔트리와 일치
            expect(matchesEntry(file, { checksum: md5 })).toBe(true);
            // 불일치
            expect(matchesEntry(file, { checksum: 'deadbeef', algo: 'sha256' })).toBe(false);
            // 미존재
            expect(
                matchesEntry(path.join(dir, 'nope.txt'), { checksum: sha, algo: 'sha256' }),
            ).toBeNull();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('updater/archive — zip-slip 경로탈출 방어', () => {
    const root = path.resolve('/tmp/extract-root');

    it('루트 내부 경로는 허용', () => {
        expect(isEntryInsideRoot(root, 'files/src/core/lib/x.ts')).toBe(true);
        expect(isEntryInsideRoot(root, 'a.txt')).toBe(true);
        expect(isEntryInsideRoot(root, 'a/b/c.ts')).toBe(true);
    });

    it('상위(..) 탈출 시도는 거부', () => {
        expect(isEntryInsideRoot(root, '../escaped.txt')).toBe(false);
        expect(isEntryInsideRoot(root, '../../etc/passwd')).toBe(false);
        expect(isEntryInsideRoot(root, 'a/../../escaped.txt')).toBe(false);
    });

    it('절대경로 엔트리는 거부', () => {
        expect(isEntryInsideRoot(root, '/etc/passwd')).toBe(false);
    });

    it('루트 자신을 가리키는 엔트리는 거부', () => {
        expect(isEntryInsideRoot(root, '.')).toBe(false);
        expect(isEntryInsideRoot(root, '')).toBe(false);
    });

    it('파일맵 키(쓰기/삭제 대상)도 동일 가드로 봉쇄 가능 — 적용 단계 경로탈출 방어', () => {
        // applyPlan 은 맵 키로 path.join(PROJECT_ROOT, rel) 대상을 만들므로 키 자체도 봉쇄해야 한다.
        const projectRoot = path.resolve('/tmp/proj');
        const safeKeys = ['src/core/lib/x.ts', 'CLAUDE.md', 'a/b/c.ts'];
        const escapingKeys = ['../../../tmp/evil', '/etc/passwd', 'a/../../escape'];
        expect(safeKeys.every((k) => isEntryInsideRoot(projectRoot, k))).toBe(true);
        expect(escapingKeys.some((k) => isEntryInsideRoot(projectRoot, k))).toBe(false);
    });
});
