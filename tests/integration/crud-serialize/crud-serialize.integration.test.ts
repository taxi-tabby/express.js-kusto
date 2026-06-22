import request from 'supertest';
import { bootDbFixture, truncateAll, DbFixture } from '@tests/_setup/db-fixture';
import { applyPrismaManagerMock, buildTestApp } from '../_shared/test-app';

describe('CRUD serialize / serializeIncludes (통합)', () => {
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
            data: {
                id: 'u1',
                email: 'a@a.com',
                name: 'Alice',
                posts: { create: [{ id: 'p1', title: 'Hello', content: 'secret-body' }] },
            },
        });
    }

    it('show: root omit 으로 primary attributes 에서 필드 제거', async () => {
        const app = buildTestApp(fixture, { serialize: { omit: ['content'] } });
        await seed();
        const res = await request(app).get('/posts/p1');
        expect(res.status).toBe(200);
        expect(res.body.data.attributes.title).toBe('Hello');
        expect(res.body.data.attributes.content).toBeUndefined();
    });

    it('show + include: serializeIncludes 로 included author 필터 (email 미노출)', async () => {
        const app = buildTestApp(fixture, {
            serialize: { omit: ['content'] },
            serializeIncludes: { author: { pick: ['id', 'name'] } },
        });
        await seed();
        const res = await request(app).get('/posts/p1?include=author');
        expect(res.status).toBe(200);
        expect(res.body.data.attributes.content).toBeUndefined();
        const author = res.body.included.find((r: any) => r.id === 'u1');
        expect(author).toBeDefined();
        expect(author.attributes.name).toBe('Alice');
        expect(author.attributes.email).toBeUndefined();
    });

    it('id 보존: include pick 에 id 없어도 included author 가 유효한 id 를 가진다', async () => {
        const app = buildTestApp(fixture, {
            serializeIncludes: { author: { pick: ['name'] } },
        });
        await seed();
        const res = await request(app).get('/posts/p1?include=author');
        expect(res.status).toBe(200);
        const author = res.body.included.find((r: any) => r.attributes.name === 'Alice');
        expect(author).toBeDefined();
        expect(author.id).toBe('u1');
        expect(author.attributes.email).toBeUndefined();
    });

    it('includeMerge: 병합된 author 도 동일하게 필터된다 (양 모드 동치)', async () => {
        const app = buildTestApp(fixture, {
            includeMerge: true,
            serializeIncludes: { author: { pick: ['id', 'name'] } },
        });
        await seed();
        const res = await request(app).get('/posts/p1?include=author');
        expect(res.status).toBe(200);
        expect(res.body.included).toBeUndefined();
        expect(res.body.data.attributes.author.name).toBe('Alice');
        expect(res.body.data.attributes.author.email).toBeUndefined();
    });

    it('index: 컬렉션 각 요소 + included 가 필터된다', async () => {
        const app = buildTestApp(fixture, {
            serialize: { omit: ['content'] },
            serializeIncludes: { author: { pick: ['id', 'name'] } },
        });
        await seed();
        const res = await request(app).get(
            '/posts?include=author&page[number]=1&page[size]=10',
        );
        expect(res.status).toBe(200);
        expect(res.body.data[0].attributes.content).toBeUndefined();
        const author = res.body.included.find((r: any) => r.id === 'u1');
        expect(author).toBeDefined();
        expect(author.attributes.email).toBeUndefined();
    });

    it('update PATCH: root omit + included 필터', async () => {
        const app = buildTestApp(fixture, {
            serialize: { omit: ['content'] },
            serializeIncludes: { author: { pick: ['id', 'name'] } },
        });
        await seed();
        const res = await request(app)
            .patch('/posts/p1?include=author')
            .send({ data: { type: 'posts', id: 'p1', attributes: { title: 'Updated' } } })
            .set('Content-Type', 'application/vnd.api+json');
        expect(res.status).toBe(200);
        expect(res.body.data.attributes.content).toBeUndefined();
        const author = res.body.included.find((r: any) => r.id === 'u1');
        expect(author).toBeDefined();
        expect(author.attributes.email).toBeUndefined();
    });

    it('관계 라우트 GET /:id/:relation: serializeIncludes 로 관계 리소스 필터 (누출 차단)', async () => {
        const app = buildTestApp(fixture, {
            serializeIncludes: { author: { pick: ['id', 'name'] } },
        });
        await seed();
        const res = await request(app).get('/posts/p1/author');
        expect(res.status).toBe(200);
        expect(res.body.data.attributes.name).toBe('Alice');
        expect(res.body.data.attributes.email).toBeUndefined();
    });

    it('create POST: root omit + included 필터', async () => {
        const app = buildTestApp(fixture, {
            serialize: { omit: ['content'] },
            serializeIncludes: { author: { pick: ['id', 'name'] } },
        });
        await seed();
        const res = await request(app)
            .post('/posts?include=author')
            .send({
                data: { type: 'posts', attributes: { id: 'p9', title: 'New', content: 'x', authorId: 'u1' } },
            })
            .set('Content-Type', 'application/vnd.api+json');
        expect(res.status).toBe(201);
        expect(res.body.data.attributes.content).toBeUndefined();
        const author = res.body.included.find((r: any) => r.id === 'u1');
        expect(author).toBeDefined();
        expect(author.attributes.email).toBeUndefined();
    });

    it('보안 우선순위: ?select 로 우회해도 root omit 필드는 응답에 없다', async () => {
        const app = buildTestApp(fixture, { serialize: { omit: ['content'] } });
        await seed();
        const res = await request(app).get('/posts/p1?select=content,title');
        expect(res.status).toBe(200);
        expect(res.body.data.attributes.content).toBeUndefined();
    });

    it('옵션 없으면 응답 불변 (회귀)', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app).get('/posts/p1');
        expect(res.status).toBe(200);
        expect(res.body.data.attributes.title).toBe('Hello');
        expect(res.body.data.attributes.content).toBe('secret-body');
    });
});
