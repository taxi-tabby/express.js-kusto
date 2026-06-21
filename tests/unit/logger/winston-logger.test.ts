import {
    toSafeJson,
    safeStringify,
    resolveConsoleLevel,
    isColorEnabled,
    normalizeLevel,
    log,
} from '@ext/winston';

describe('toSafeJson — 안전 직렬화', () => {
    it('순환 참조를 [Circular] 로 처리', () => {
        const a: any = { name: 'a' };
        a.self = a;
        const out = toSafeJson(a) as any;
        expect(out.name).toBe('a');
        expect(out.self).toBe('[Circular]');
    });

    it('형제 공유 참조는 순환으로 오탐하지 않음', () => {
        const shared = { v: 1 };
        const out = toSafeJson({ x: shared, y: shared }) as any;
        expect(out.x).toEqual({ v: 1 });
        expect(out.y).toEqual({ v: 1 });
    });

    it('BigInt 를 문자열로 직렬화', () => {
        const out = toSafeJson({ big: BigInt(10) }) as any;
        expect(out.big).toBe('10n');
    });

    it('Error 를 name/message/stack 으로 변환', () => {
        const out = toSafeJson({ err: new Error('boom') }) as any;
        expect(out.err.name).toBe('Error');
        expect(out.err.message).toBe('boom');
        expect(typeof out.err.stack).toBe('string');
    });

    it('Error 의 추가 enumerable prop(code 등) 보존', () => {
        const e: any = new Error('boom');
        e.code = 'P2002';
        const out = toSafeJson(e) as any;
        expect(out.code).toBe('P2002');
    });

    it('Buffer 를 요약 문자열로', () => {
        const out = toSafeJson({ buf: Buffer.from('hello') }) as any;
        expect(out.buf).toBe('[Buffer 5 bytes]');
    });

    it('Date 를 ISO 문자열로', () => {
        const d = new Date('2026-06-20T00:00:00.000Z');
        expect(toSafeJson({ d })).toEqual({ d: '2026-06-20T00:00:00.000Z' });
    });

    it('throw 하는 getter 를 안전 처리', () => {
        const obj = {
            get boom(): string {
                throw new Error('nope');
            },
        };
        const out = toSafeJson(obj) as any;
        expect(String(out.boom)).toContain('Getter threw');
    });

    it('깊이 초과 시 절단', () => {
        const deep: any = {};
        let cur = deep;
        for (let i = 0; i < 20; i++) {
            cur.next = {};
            cur = cur.next;
        }
        const out = JSON.stringify(toSafeJson(deep, { maxDepth: 3 }));
        expect(out).toContain('[Object]');
    });
});

describe('safeStringify + 민감정보 마스킹', () => {
    it('민감 키 값을 [REDACTED] 로(중첩 포함)', () => {
        const s = safeStringify({ user: 'u', password: 'p', nested: { token: 't' } }, { env: {} });
        expect(s).toContain('[REDACTED]');
        expect(s).not.toContain('"p"');
        expect(s).not.toContain('"t"');
        expect(s).toContain('"user":"u"');
    });

    it('키 매칭은 대소문자 무시', () => {
        const s = safeStringify({ Authorization: 'Bearer x' }, { env: {} });
        expect(s).toContain('[REDACTED]');
        expect(s).not.toContain('Bearer x');
    });

    it('LOG_REDACT=false 면 마스킹 안 함', () => {
        const s = safeStringify({ password: 'p' }, { env: { LOG_REDACT: 'false' } });
        expect(s).toContain('"p"');
    });

    it('LOG_REDACT_KEYS 로 키 추가', () => {
        const s = safeStringify(
            { customSecret: 'x' },
            { env: { LOG_REDACT_KEYS: 'customsecret' } },
        );
        expect(s).toContain('[REDACTED]');
    });

    it('순환 참조여도 throw 하지 않음', () => {
        const a: any = {};
        a.self = a;
        expect(() => safeStringify(a, { env: {} })).not.toThrow();
    });
});

describe('normalizeLevel', () => {
    it('정규 레벨명 그대로', () => {
        expect(normalizeLevel('Info')).toBe('Info');
    });
    it('소문자 별칭 매핑', () => {
        expect(normalizeLevel('info')).toBe('Info');
        expect(normalizeLevel('debug')).toBe('Debug');
        expect(normalizeLevel('warn')).toBe('Warn');
    });
    it('silent/off/none → silent', () => {
        expect(normalizeLevel('silent')).toBe('silent');
        expect(normalizeLevel('OFF')).toBe('silent');
    });
    it('빈 값/미지정 → null', () => {
        expect(normalizeLevel(undefined)).toBeNull();
        expect(normalizeLevel('')).toBeNull();
    });
    it('알 수 없는 값 → null', () => {
        expect(normalizeLevel('bogus')).toBeNull();
    });
});

describe('resolveConsoleLevel', () => {
    it('LOG_LEVEL 이 최우선', () => {
        expect(resolveConsoleLevel({ LOG_LEVEL: 'Warn', NODE_ENV: 'production' })).toBe('Warn');
    });
    it('LOG_LEVEL 별칭/대소문자 정규화', () => {
        expect(resolveConsoleLevel({ LOG_LEVEL: 'info' })).toBe('Info');
    });
    it('LOG_LEVEL=silent → silent', () => {
        expect(resolveConsoleLevel({ LOG_LEVEL: 'silent' })).toBe('silent');
    });
    it('production → Info', () => {
        expect(resolveConsoleLevel({ NODE_ENV: 'production' })).toBe('Info');
    });
    it('test → Error', () => {
        expect(resolveConsoleLevel({ NODE_ENV: 'test' })).toBe('Error');
    });
    it('development(기본) → Debug', () => {
        expect(resolveConsoleLevel({ NODE_ENV: 'development' })).toBe('Debug');
        expect(resolveConsoleLevel({})).toBe('Debug');
    });
    it('잘못된 LOG_LEVEL 은 무시하고 환경 기본값', () => {
        expect(resolveConsoleLevel({ LOG_LEVEL: 'bogus', NODE_ENV: 'production' })).toBe('Info');
    });
});

describe('isColorEnabled', () => {
    it('TTY 면 true', () => {
        expect(isColorEnabled({}, true)).toBe(true);
    });
    it('비-TTY 면 false', () => {
        expect(isColorEnabled({}, false)).toBe(false);
    });
    it('NO_COLOR 설정 시 false(우선)', () => {
        expect(isColorEnabled({ NO_COLOR: '1' }, true)).toBe(false);
    });
    it('FORCE_COLOR 면 비-TTY 여도 true', () => {
        expect(isColorEnabled({ FORCE_COLOR: '1' }, false)).toBe(true);
    });
    it('FORCE_COLOR=0 은 강제 아님', () => {
        expect(isColorEnabled({ FORCE_COLOR: '0' }, false)).toBe(false);
    });
});

describe('log 인스턴스 스모크', () => {
    const LEVELS = [
        'Error',
        'Warn',
        'Info',
        'Debug',
        'Silly',
        'SQL',
        'Route',
        'Footwalk',
        'Auth',
        'Email',
        'SessionDeclaration',
        'error',
    ] as const;

    it('12개 레벨 메서드가 모두 함수', () => {
        for (const lvl of LEVELS) {
            expect(typeof (log as any)[lvl]).toBe('function');
        }
    });

    it('순환 참조 메타로 호출해도 throw 하지 않음', () => {
        const a: any = {};
        a.self = a;
        expect(() => log.Info('circular meta test', a)).not.toThrow();
    });

    it('BigInt 메타로 호출해도 throw 하지 않음', () => {
        expect(() => log.Info('bigint meta', { n: BigInt(5) })).not.toThrow();
    });
});

describe('적대적 리뷰 회귀 — 배열/Error/Map/Set/Date', () => {
    it('객체 배열을 [Circular] 로 오탐하지 않고 보존', () => {
        const out = toSafeJson({ list: [{ a: 1 }, { b: 2 }] }) as any;
        expect(out.list).toEqual([{ a: 1 }, { b: 2 }]);
        expect(JSON.stringify(out)).not.toContain('[Circular]');
    });

    it('객체 배열 안의 민감 키도 마스킹', () => {
        const s = safeStringify(
            { users: [{ name: 'a', password: 'p' }, { token: 't' }] },
            { env: {} },
        );
        expect(s).toContain('"name":"a"');
        expect(s).toContain('[REDACTED]');
        expect(s).not.toContain('[Circular]');
        expect(s).not.toContain('"p"');
        expect(s).not.toContain('"t"');
    });

    it('자기참조 Error 도 throw 없이 [Circular] 처리', () => {
        const e: any = new Error('boom');
        e.me = e;
        expect(() => toSafeJson(e)).not.toThrow();
        const out = toSafeJson(e) as any;
        expect(out.message).toBe('boom');
        expect(out.me).toBe('[Circular]');
    });

    it('Map 내용을 보존(+ 민감 키 마스킹)', () => {
        const out = toSafeJson({
            m: new Map([
                ['a', 1],
                ['b', 2],
            ]),
        }) as any;
        expect(out.m).toEqual({ a: 1, b: 2 });
        const s = safeStringify(
            new Map([
                ['password', 'p'],
                ['user', 'u'],
            ]),
            { env: {} },
        );
        expect(s).toContain('[REDACTED]');
        expect(s).toContain('"user":"u"');
    });

    it('Set 을 배열로 보존', () => {
        const out = toSafeJson({ s: new Set([1, 2, 3]) }) as any;
        expect(out.s).toEqual([1, 2, 3]);
    });

    it('잘못된 Date 는 [Invalid Date]', () => {
        const out = toSafeJson({ d: new Date('not-a-date') }) as any;
        expect(out.d).toBe('[Invalid Date]');
    });
});

describe('적대적 리뷰 회귀 — 리댁션 키 형태', () => {
    const redact = (obj: Record<string, unknown>) => safeStringify(obj, { env: {} });

    it.each([
        ['x-api-key', 'k'],
        ['access_token', 'a'],
        ['refresh_token', 'r'],
        ['user_password', 'p'],
        ['csrfToken', 'c'],
        ['Authorization', 'bearer z'],
    ])('민감 키 형태 "%s" 를 마스킹', (key, val) => {
        const s = redact({ [key]: val });
        expect(s).toContain('[REDACTED]');
        expect(s).not.toContain(`"${val}"`);
    });

    it.each([
        ['className', 'Button'],
        ['authorName', 'Kim'],
        ['username', 'neo'],
    ])('비민감 키 "%s" 는 보존(오탐 방지)', (key, val) => {
        const s = redact({ [key]: val });
        expect(s).toContain(`"${val}"`);
        expect(s).not.toContain('[REDACTED]');
    });
});
