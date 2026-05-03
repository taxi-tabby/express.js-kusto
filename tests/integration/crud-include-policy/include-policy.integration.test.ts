import request from 'supertest';
import { bootDbFixture, truncateAll, DbFixture } from '../../_setup/db-fixture';
import { applyPrismaManagerMock, buildTestApp } from '../_shared/test-app';

describe('CRUD include 정책 wiring (통합)', () => {
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
                posts: {
                    create: [
                        { id: 'p1', title: 'Hello' },
                        { id: 'p2', title: 'World' }
                    ]
                }
            }
        });
    }

    it('index 에서 ?include= 가 maxIncludeCount 초과할 때 400 INCLUDE_LIMIT_EXCEEDED 응답한다', async () => {
        const app = buildTestApp(fixture, { maxIncludeCount: 1 });
        await seed();
        const res = await request(app).get('/posts?include=author,comments&page[number]=1&page[size]=10');
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('INCLUDE_LIMIT_EXCEEDED');
    });

    it('index 에서 ?include= 가 maxIncludeDepth 초과할 때 400 INCLUDE_DEPTH_EXCEEDED 응답한다', async () => {
        const app = buildTestApp(fixture, { maxIncludeDepth: 1 });
        await seed();
        const res = await request(app).get('/posts?include=author.profile&page[number]=1&page[size]=10');
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('INCLUDE_DEPTH_EXCEEDED');
    });

    it('index 에서 allowedIncludes 에 없는 path 일 때 400 INCLUDE_NOT_ALLOWED 응답한다', async () => {
        const app = buildTestApp(fixture, { allowedIncludes: ['author'] });
        await seed();
        const res = await request(app).get('/posts?include=tags&page[number]=1&page[size]=10');
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('INCLUDE_NOT_ALLOWED');
    });

    it('index 에서 defaultIncludes 가 지정된 경우 client ?include= 미지정이어도 응답에 included 가 포함된다', async () => {
        const app = buildTestApp(fixture, { defaultIncludes: ['author'] });
        await seed();
        const res = await request(app).get('/posts?page[number]=1&page[size]=10');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.included)).toBe(true);
        expect(res.body.included.length).toBeGreaterThan(0);
    });

    it('show 에서 maxIncludeDepth 초과 path 일 때 400 INCLUDE_DEPTH_EXCEEDED 응답한다', async () => {
        const app = buildTestApp(fixture, { maxIncludeDepth: 1 });
        await seed();
        const res = await request(app).get('/posts/p1?include=author.profile');
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('INCLUDE_DEPTH_EXCEEDED');
    });

    it('create POST 에 ?include=author 가 붙을 때 응답에 included 배열이 포함된다', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app)
            .post('/posts?include=author')
            .send({
                data: {
                    type: 'posts',
                    attributes: { id: 'p3', title: 'New', authorId: 'u1' }
                }
            })
            .set('Content-Type', 'application/vnd.api+json');
        expect(res.status).toBe(201);
        expect(Array.isArray(res.body.included)).toBe(true);
        expect(res.body.included.length).toBeGreaterThan(0);
    });

    it('update PATCH 에 ?include=author 가 붙을 때 응답에 included 배열이 포함된다', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app)
            .patch('/posts/p1?include=author')
            .send({
                data: {
                    type: 'posts',
                    id: 'p1',
                    attributes: { title: 'Updated' }
                }
            })
            .set('Content-Type', 'application/vnd.api+json');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.included)).toBe(true);
    });

    it('defaultIncludes 가 allowedIncludes 화이트리스트에 없어도 통과한다 (서버 신뢰)', async () => {
        const app = buildTestApp(fixture, {
            allowedIncludes: ['author'],
            defaultIncludes: ['tags']
        });
        await seed();
        const res = await request(app).get('/posts?page[number]=1&page[size]=10');
        expect(res.status).toBe(200);
    });
});
