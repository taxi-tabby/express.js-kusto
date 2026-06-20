import request from 'supertest';
import { bootDbFixture, truncateAll, DbFixture } from '@tests/_setup/db-fixture';
import { applyPrismaManagerMock, buildTestApp } from '../_shared/test-app';

describe('CRUD soft delete 흐름 (통합)', () => {
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

    async function seedUser(id = 'u1', email = 'a@a.com') {
        await fixture.prisma.user.create({
            data: { id, email, name: 'Alice' }
        });
    }

    it('soft delete 활성 모델에서 DELETE /:id 호출 시 row 가 살아있고 deletedAt 이 채워진다', async () => {
        const app = buildTestApp(
            fixture,
            { softDelete: { enabled: true, field: 'deletedAt' } },
            'User',
            '/users'
        );
        await seedUser();
        const res = await request(app).delete('/users/u1');
        expect([200, 204]).toContain(res.status);
        const row = await fixture.prisma.user.findUnique({ where: { id: 'u1' } });
        expect(row).not.toBeNull();
        expect(row.deletedAt).toBeInstanceOf(Date);
    });

    it('index 호출 시 deletedAt 이 null 인 row 만 반환한다', async () => {
        const app = buildTestApp(
            fixture,
            { softDelete: { enabled: true, field: 'deletedAt' } },
            'User',
            '/users'
        );
        await seedUser('u1');
        await seedUser('u2', 'b@b.com');
        await fixture.prisma.user.update({
            where: { id: 'u2' },
            data: { deletedAt: new Date() }
        });
        const res = await request(app).get('/users?page[number]=1&page[size]=10');
        expect(res.status).toBe(200);
        const ids = res.body.data.map((d: any) => d.id);
        expect(ids).toContain('u1');
        expect(ids).not.toContain('u2');
    });

    it('?include_deleted=true 일 때 deletedAt 이 채워진 row 도 반환한다', async () => {
        const app = buildTestApp(
            fixture,
            { softDelete: { enabled: true, field: 'deletedAt' } },
            'User',
            '/users'
        );
        await seedUser('u1');
        await seedUser('u2', 'b@b.com');
        await fixture.prisma.user.update({
            where: { id: 'u2' },
            data: { deletedAt: new Date() }
        });
        const res = await request(app).get('/users?include_deleted=true&page[number]=1&page[size]=10');
        expect(res.status).toBe(200);
        const ids = res.body.data.map((d: any) => d.id);
        expect(ids).toEqual(expect.arrayContaining(['u1', 'u2']));
    });

    it('show 가 deleted row 를 가리킬 때 410 RESOURCE_DELETED 응답한다', async () => {
        const app = buildTestApp(
            fixture,
            { softDelete: { enabled: true, field: 'deletedAt' } },
            'User',
            '/users'
        );
        await seedUser('u1');
        await fixture.prisma.user.update({
            where: { id: 'u1' },
            data: { deletedAt: new Date() }
        });
        const res = await request(app).get('/users/u1');
        expect(res.status).toBe(410);
        expect(res.body.errors[0].code).toBe('RESOURCE_DELETED');
    });

    it('POST /:id/recover 호출 시 deletedAt 이 null 로 복구된다', async () => {
        const app = buildTestApp(
            fixture,
            { softDelete: { enabled: true, field: 'deletedAt' } },
            'User',
            '/users'
        );
        await seedUser('u1');
        await fixture.prisma.user.update({
            where: { id: 'u1' },
            data: { deletedAt: new Date() }
        });
        const res = await request(app).post('/users/u1/recover');
        expect([200, 201]).toContain(res.status);
        const row = await fixture.prisma.user.findUnique({ where: { id: 'u1' } });
        expect(row.deletedAt).toBeNull();
    });

    it('P0-3: 커스텀 soft-delete 필드(removedAt)로 recover 가 동작한다 (deletedAt 하드코딩 금지)', async () => {
        const app = buildTestApp(
            fixture,
            { softDelete: { enabled: true, field: 'removedAt' } },
            'User',
            '/users'
        );
        await seedUser('u1');
        // 커스텀 필드로 soft-delete 상태 만들기
        await fixture.prisma.user.update({
            where: { id: 'u1' },
            data: { removedAt: new Date() }
        });
        const res = await request(app).post('/users/u1/recover');
        // 수정 전: recover 가 deletedAt:{not:null} 로 조회 → 매칭 실패 → 409/404, removedAt 그대로
        expect([200, 201]).toContain(res.status);
        const row = await fixture.prisma.user.findUnique({ where: { id: 'u1' } });
        expect(row.removedAt).toBeNull();
    });

    it('soft delete 비활성 모델에서 DELETE 가 실제로 row 를 삭제한다', async () => {
        // softDelete 옵션 미지정 — 일반 DELETE 동작
        const app = buildTestApp(fixture, {}, 'User', '/users');
        await seedUser('u1');
        const res = await request(app).delete('/users/u1');
        expect([200, 204]).toContain(res.status);
        const row = await fixture.prisma.user.findUnique({ where: { id: 'u1' } });
        expect(row).toBeNull();
    });
});
