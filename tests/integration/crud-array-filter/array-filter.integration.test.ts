import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { bootDbFixture, truncateAll, DbFixture, selectProvider } from '@tests/_setup/db-fixture';
import { applyPrismaManagerMock, buildTestApp } from '../_shared/test-app';
import { buildFieldTypeMapFromSchema } from '@lib/data/database/fieldTypeMap';

// scalar list(String[]) 는 Postgres 전용 — sqlite 는 표현 불가하므로 postgres 백엔드에서만 실행한다.
// (KUSTO_TEST_DB=postgres 일 때만; 기본 sqlite 실행에서는 describe 자체를 skip 한다.)
//
// 실행:
//   KUSTO_TEST_DB=postgres NODE_OPTIONS=--experimental-vm-modules \
//     npx jest tests/integration/crud-array-filter --runInBand
//   (PGlite 의 동적 import 때문에 --experimental-vm-modules 필요, in-process 소켓 서버 때문에 --runInBand 권장.
//    또는 외부 Postgres: KUSTO_TEST_PG_URL=... 지정.)
const describePg = selectProvider() === 'postgres' ? describe : describe.skip;

describePg('CRUD 배열 연산자 (all/elemMatch/size) end-to-end (postgres)', () => {
    let fixture: DbFixture;

    beforeAll(async () => {
        fixture = await bootDbFixture();
    });

    afterAll(async () => {
        await fixture.teardown();
    });

    afterEach(async () => {
        await truncateAll(fixture);
    });

    beforeEach(() => {
        applyPrismaManagerMock(fixture);
    });

    async function seed() {
        await fixture.prisma.user.create({
            data: { id: 'u1', email: 'a@a.com', name: 'Alice' },
        });
        await fixture.prisma.post.create({
            data: { id: 'p1', title: 'A', authorId: 'u1', labels: ['red', 'green'] },
        });
        await fixture.prisma.post.create({
            data: { id: 'p2', title: 'B', authorId: 'u1', labels: ['red'] },
        });
        await fixture.prisma.post.create({
            data: { id: 'p3', title: 'C', authorId: 'u1', labels: [] },
        });
    }

    function ids(res: any): string[] {
        return res.body.data.map((d: any) => d.id).sort();
    }

    it('buildFieldTypeMapFromSchema 가 labels 를 scalar list 로, title 을 일반 scalar 로 인식한다', () => {
        const schemaPath = path.resolve(`tests/_fixtures/test-schema.${fixture.provider}.prisma`);
        const map = buildFieldTypeMapFromSchema(fs.readFileSync(schemaPath, 'utf-8'), 'Post');
        expect(map).not.toBeNull();
        expect(map!.get('labels')).toMatchObject({ isList: true, kind: 'scalar' });
        expect(map!.get('title')).toMatchObject({ isList: false });
    });

    it('all 은 hasEvery 로 동작해 모든 라벨을 가진 레코드만 반환한다', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app).get(
            '/posts?filter[labels_all]=red,green&page[number]=1&page[size]=10',
        );
        expect(res.status).toBe(200);
        expect(ids(res)).toEqual(['p1']);
    });

    it('elemMatch 단일 값은 has 로 동작해 해당 라벨을 가진 모든 레코드를 반환한다', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app).get(
            '/posts?filter[labels_elemMatch]=red&page[number]=1&page[size]=10',
        );
        expect(res.status).toBe(200);
        expect(ids(res)).toEqual(['p1', 'p2']);
    });

    it('elemMatch 다중 값은 hasSome 으로 동작한다', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app).get(
            '/posts?filter[labels_elemMatch]=green,blue&page[number]=1&page[size]=10',
        );
        expect(res.status).toBe(200);
        expect(ids(res)).toEqual(['p1']);
    });

    it('size 0 은 isEmpty 로 동작해 빈 배열 레코드만 반환한다', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app).get(
            '/posts?filter[labels_size]=0&page[number]=1&page[size]=10',
        );
        expect(res.status).toBe(200);
        expect(ids(res)).toEqual(['p3']);
    });

    it('size N>0 은 400 INVALID_FILTER (Prisma where 로 표현 불가)', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app).get(
            '/posts?filter[labels_size]=2&page[number]=1&page[size]=10',
        );
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('INVALID_FILTER');
    });

    it('regex 는 400 INVALID_FILTER (Prisma SQL 커넥터 미지원)', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app).get(
            '/posts?filter[title_regex]=A&page[number]=1&page[size]=10',
        );
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('INVALID_FILTER');
    });

    it('all 을 일반 scalar 필드(title)에 쓰면 400 INVALID_FILTER (bogus 키 방출 금지)', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app).get(
            '/posts?filter[title_all]=A&page[number]=1&page[size]=10',
        );
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('INVALID_FILTER');
    });
});
