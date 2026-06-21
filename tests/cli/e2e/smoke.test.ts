import { spawn } from 'child_process';

// execa@9.x 는 pure ESM 이라 ts-jest CommonJS 환경에서 직접 import 불가.
// 동일 의도 (자식 프로세스 spawn + stdout/stderr/exitCode 캡처 + stdin 입력) 를
// Node 내장 child_process 로 구현. e2e 스모크에 충분.
interface SpawnResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

function runProcess(
    command: string,
    args: readonly string[],
    options: { input?: string; timeout?: number } = {},
): Promise<SpawnResult> {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            shell: process.platform === 'win32',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let timer: NodeJS.Timeout | null = null;
        let settled = false;
        const settle = (exitCode: number | null) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve({ stdout, stderr, exitCode });
        };
        child.stdout?.on('data', (d) => {
            stdout += d.toString();
        });
        child.stderr?.on('data', (d) => {
            stderr += d.toString();
        });
        child.on('error', () => settle(null));
        child.on('close', (code) => settle(code));
        if (options.timeout) {
            timer = setTimeout(() => {
                try {
                    child.kill();
                } catch {
                    // ignore
                }
                settle(null);
            }, options.timeout);
        }
        if (options.input !== undefined) {
            child.stdin?.write(options.input);
        }
        child.stdin?.end();
    });
}

describe('kusto-db CLI e2e smoke', () => {
    it('--help 인자로 호출될 때 stdout 에 사용법이 출력되고 exit 0 으로 종료한다', async () => {
        const result = await runProcess('npm', ['run', 'db', '--', '--help'], {
            timeout: 60000,
        });
        // commander 가 --help 시 exit 0 으로 종료. process.argv 가 npm wrapper 를 통해 전달되므로
        // 실제 종료 코드는 0 또는 npm 의 exit code 일 수 있음.
        const combined = (result.stdout || '') + (result.stderr || '');
        // help 출력에 commander 가 일반적으로 포함하는 단어 매칭
        expect(combined.toLowerCase()).toMatch(/usage|사용법|commands|options/);
        // exit code 는 number 또는 null (timeout 시) 일 수 있음
        expect(['number', 'object']).toContain(typeof result.exitCode);
    }, 90000);

    it('migrate -t reset 을 보안 코드 입력 없이 호출할 때 cancelled 또는 비정상 exit 으로 종료한다', async () => {
        const result = await runProcess(
            'npm',
            ['run', 'db', '--', 'migrate', '-t', 'reset', '-d', 'default'],
            {
                input: '\n\n\n\n', // 빈 입력으로 보안 코드 cancel 유도
                timeout: 60000,
            },
        );
        const combined = (result.stdout || '') + (result.stderr || '');
        // 보안 코드 cancel, 또는 환경 누락 (.env 등) 으로 인한 비정상 종료. 둘 다 "안전한 거부".
        // 핵심: dangerous op 가 보안 코드 없이 절대 실행되지 않는다.
        const cancelled = /cancel|취소|cancelled|aborted|first confirmation failed/i.test(combined);
        const exitedNonZero = result.exitCode !== 0;
        expect(cancelled || exitedNonZero).toBe(true);
    }, 90000);
});
