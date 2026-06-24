import { Validator } from '@lib/http/validation/validator';

describe('Validator.validate — string 타입', () => {
    it('필수 필드가 누락됐을 때 isValid 가 false 이고 errors 에 해당 필드가 포함된다', () => {
        const result = Validator.validate(
            {},
            {
                name: { type: 'string', required: true },
            },
        );
        expect(result.isValid).toBe(false);
        expect(result.errors.some((e: any) => e.field === 'name')).toBe(true);
    });

    it('string 타입에 숫자가 들어올 때 type 검증이 실패한다', () => {
        const result = Validator.validate(
            { name: 123 },
            {
                name: { type: 'string', required: true },
            },
        );
        expect(result.isValid).toBe(false);
    });

    it('string 의 min 보다 짧은 값일 때 검증이 실패한다', () => {
        const result = Validator.validate(
            { name: 'ab' },
            {
                name: { type: 'string', min: 3 },
            },
        );
        expect(result.isValid).toBe(false);
    });

    it('string 의 max 보다 긴 값일 때 검증이 실패한다', () => {
        const result = Validator.validate(
            { name: 'abcdef' },
            {
                name: { type: 'string', max: 3 },
            },
        );
        expect(result.isValid).toBe(false);
    });

    it('string 의 enum 에 없는 값일 때 검증이 실패한다', () => {
        const result = Validator.validate(
            { status: 'maybe' },
            {
                status: { type: 'string', enum: ['yes', 'no'] },
            },
        );
        expect(result.isValid).toBe(false);
    });

    it('정상 string 입력일 때 isValid 가 true 이고 data 에 값이 포함된다', () => {
        const result = Validator.validate(
            { name: 'John' },
            {
                name: { type: 'string', required: true },
            },
        );
        expect(result.isValid).toBe(true);
        expect(result.data?.name).toBe('John');
    });
});

describe('Validator.validate — email/url/number/boolean 타입', () => {
    it('email 타입에 잘못된 형식이 들어올 때 실패한다', () => {
        const result = Validator.validate(
            { email: 'not-an-email' },
            {
                email: { type: 'email' },
            },
        );
        expect(result.isValid).toBe(false);
    });

    it('email 타입에 올바른 형식이 들어올 때 통과한다', () => {
        const result = Validator.validate(
            { email: 'a@b.com' },
            {
                email: { type: 'email' },
            },
        );
        expect(result.isValid).toBe(true);
    });

    it('url 타입에 잘못된 형식이 들어올 때 실패한다', () => {
        const result = Validator.validate(
            { link: 'not a url' },
            {
                link: { type: 'url' },
            },
        );
        expect(result.isValid).toBe(false);
    });

    // 주의: number 타입은 문자열을 parseFloat 으로 자동 변환하므로
    // 숫자로 변환 가능한 문자열 ('20') 은 통과한다. 변환 불가능한 문자열일 때만 실패한다.
    it('number 타입에 숫자로 변환할 수 없는 문자열이 들어올 때 실패한다', () => {
        const result = Validator.validate(
            { age: 'not-a-number' },
            {
                age: { type: 'number' },
            },
        );
        expect(result.isValid).toBe(false);
    });

    it('number 의 min/max 범위를 벗어날 때 실패한다', () => {
        const r1 = Validator.validate({ age: 5 }, { age: { type: 'number', min: 18 } });
        const r2 = Validator.validate({ age: 200 }, { age: { type: 'number', max: 120 } });
        expect(r1.isValid).toBe(false);
        expect(r2.isValid).toBe(false);
    });

    // 주의: boolean 타입은 'true'/'false' 문자열을 자동 변환하므로
    // 그 외의 boolean 이 아닌 값일 때만 실패한다.
    it('boolean 타입에 boolean 이나 true/false 문자열이 아닌 값이 들어올 때 실패한다', () => {
        const result = Validator.validate(
            { active: 'maybe' },
            {
                active: { type: 'boolean' },
            },
        );
        expect(result.isValid).toBe(false);
    });
});

// 입력단 보안 denylist 제거 후의 동작:
// SQLi 는 Prisma 파라미터화가 구조적으로 막고, XSS 는 출력 인코딩의 책임이며,
// 이 프레임워크의 요청 경로는 셸을 실행하지 않으므로 cmd injection 표면도 없다.
// 따라서 정상 콘텐츠(코드/마크다운/HTML/SQL 텍스트)는 타입 검증을 통과해야 한다.
describe('Validator.validate — 입력단 보안 denylist 미적용 (정상 콘텐츠 통과)', () => {
    it('<script> 를 포함한 문자열도 string 타입 검증을 통과한다 (XSS 는 출력단 책임)', () => {
        const result = Validator.validate(
            { body: '<p>Hello</p><script>doStuff()</script>' },
            {
                body: { type: 'string' },
            },
        );
        expect(result.isValid).toBe(true);
        expect(result.data?.body).toBe('<p>Hello</p><script>doStuff()</script>');
    });

    it('SQL 처럼 보이는 문자열도 통과한다 (Prisma 파라미터화가 SQLi 를 막음)', () => {
        const result = Validator.validate(
            { note: "' OR 1=1 --" },
            {
                note: { type: 'string' },
            },
        );
        expect(result.isValid).toBe(true);
    });

    it('union select 가 포함된 산문도 통과한다', () => {
        const result = Validator.validate(
            { article: 'This post explains UNION ALL SELECT in SQL.' },
            {
                article: { type: 'string' },
            },
        );
        expect(result.isValid).toBe(true);
    });

    it('백틱/명령 치환처럼 보이는 문자열도 통과한다 (요청 경로는 셸을 실행하지 않음)', () => {
        const result = Validator.validate(
            { snippet: 'Run the `npm install` command, then echo $(date)' },
            {
                snippet: { type: 'string' },
            },
        );
        expect(result.isValid).toBe(true);
    });
});
