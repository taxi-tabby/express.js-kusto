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

    it('옵션 없으면 응답 불변 (회귀)', async () => {
        const app = buildTestApp(fixture);
        await seed();
        const res = await request(app).get('/posts/p1');
        expect(res.status).toBe(200);
        expect(res.body.data.attributes.title).toBe('Hello');
        expect(res.body.data.attributes.content).toBe('secret-body');
    });
});
