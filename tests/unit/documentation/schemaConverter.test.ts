import { fieldToOpenApi, schemaToOpenApi } from '@lib/devtools/documentation/schemaConverter';
import { FieldSchema } from '@lib/http/validation/validator';

describe('schemaConverter', () => {
    describe('fieldToOpenApi', () => {
        it('type=string + min/max 일 때 type/minLength/maxLength 로 변환된다', () => {
            const field: FieldSchema = { type: 'string', min: 3, max: 50 };
            const result = fieldToOpenApi(field);
            expect(result).toEqual({ type: 'string', minLength: 3, maxLength: 50 });
        });

        it('type=number + min/max 일 때 minimum/maximum 으로 변환된다', () => {
            const field: FieldSchema = { type: 'number', min: 0, max: 100 };
            const result = fieldToOpenApi(field);
            expect(result).toEqual({ type: 'number', minimum: 0, maximum: 100 });
        });

        it('type=email 일 때 type=string + format=email 로 변환된다', () => {
            const field: FieldSchema = { type: 'email' };
            const result = fieldToOpenApi(field);
            expect(result).toEqual({ type: 'string', format: 'email' });
        });

        it('type=url 일 때 type=string + format=uri 로 변환된다', () => {
            const field: FieldSchema = { type: 'url' };
            const result = fieldToOpenApi(field);
            expect(result).toEqual({ type: 'string', format: 'uri' });
        });

        it('type=file 일 때 type=string + format=binary 로 변환된다', () => {
            const field: FieldSchema = { type: 'file' };
            const result = fieldToOpenApi(field);
            expect(result).toEqual({ type: 'string', format: 'binary' });
        });

        it('type=array 일 때 type=array 로 변환된다', () => {
            const field: FieldSchema = { type: 'array', min: 1, max: 10 };
            const result = fieldToOpenApi(field);
            expect(result.type).toBe('array');
            expect(result.minItems).toBe(1);
            expect(result.maxItems).toBe(10);
        });

        it('enum 이 있을 때 그대로 OpenAPI enum 으로 옮겨진다', () => {
            const field: FieldSchema = { type: 'string', enum: ['a', 'b', 'c'] };
            const result = fieldToOpenApi(field);
            expect(result.enum).toEqual(['a', 'b', 'c']);
        });

        it('pattern (RegExp) 이 있을 때 source 가 OpenAPI pattern 으로 옮겨진다', () => {
            const field: FieldSchema = { type: 'string', pattern: /^[A-Z]+$/ };
            const result = fieldToOpenApi(field);
            expect(result.pattern).toBe('^[A-Z]+$');
        });

        it('알 수 없는 type 일 때 throw 한다', () => {
            const field = { type: 'unknown' as any };
            expect(() => fieldToOpenApi(field)).toThrow(/Unknown FieldSchema type/);
        });
    });

    describe('schemaToOpenApi', () => {
        it('빈 schema 일 때 properties 가 빈 객체인 object schema 를 반환한다', () => {
            const result = schemaToOpenApi({});
            expect(result).toEqual({ type: 'object', properties: {} });
        });

        it('required: true 인 필드만 required 배열에 포함된다', () => {
            const result = schemaToOpenApi({
                name: { type: 'string', required: true },
                age: { type: 'number' },
            });
            expect(result.required).toEqual(['name']);
            expect(result.properties.name).toEqual({ type: 'string' });
            expect(result.properties.age).toEqual({ type: 'number' });
        });

        it('required 필드가 없을 때 required 키 자체를 생략한다', () => {
            const result = schemaToOpenApi({ x: { type: 'string' } });
            expect((result as any).required).toBeUndefined();
        });
    });
});
