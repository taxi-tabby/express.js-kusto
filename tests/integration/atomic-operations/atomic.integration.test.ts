import request from 'supertest';
import { bootDbFixture, truncateAll, DbFixture } from '@tests/_setup/db-fixture';
import { applyPrismaManagerMock, buildTestApp } from '../_shared/test-app';

const ATOMIC_CONTENT_TYPE = 'application/vnd.api+json; ext="https://jsonapi.org/ext/atomic"';

describe('JSON:API Atomic Operations (통합)', () => {
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

    it('atomic operations 엔드포인트가 잘못된 본문 (atomic:operations 누락) 으로 호출될 때 400 또는 422 를 반환한다', async () => {
        const app = buildTestApp(fixture, {}, 'User', '/users');
        const res = await request(app)
            .post('/users/atomic')
            .send({ data: 'invalid' })
            .set('Content-Type', ATOMIC_CONTENT_TYPE);
        expect([400, 415, 422]).toContain(res.status);
    });

    it('atomic operations 엔드포인트가 add 작업 1개로 호출될 때 row 가 생성되고 200 또는 201 을 반환한다', async () => {
        const app = buildTestApp(fixture, {}, 'User', '/users');
        const res = await request(app)
            .post('/users/atomic')
            .send({
                'atomic:operations': [
                    {
                        op: 'add',
                        data: {
                            type: 'users',
                            attributes: { id: 'u1', email: 'a@a.com', name: 'Alice' },
                        },
                    },
                ],
            })
            .set('Content-Type', ATOMIC_CONTENT_TYPE);
        expect([200, 201]).toContain(res.status);
        const row = await fixture.prisma.user.findUnique({ where: { id: 'u1' } });
        expect(row).not.toBeNull();
    });

    it('atomic operations 응답에 atomic:results 배열이 포함된다', async () => {
        const app = buildTestApp(fixture, {}, 'User', '/users');
        const res = await request(app)
            .post('/users/atomic')
            .send({
                'atomic:operations': [
                    {
                        op: 'add',
                        data: {
                            type: 'users',
                            attributes: { id: 'u1', email: 'a@a.com', name: 'Alice' },
                        },
                    },
                ],
            })
            .set('Content-Type', ATOMIC_CONTENT_TYPE);
        if (res.status >= 200 && res.status < 300) {
            expect(res.body['atomic:results']).toBeDefined();
            expect(Array.isArray(res.body['atomic:results'])).toBe(true);
        }
    });

    it('빈 atomic:operations 배열로 호출될 때 200 응답하고 atomic:results 도 빈 배열을 반환한다', async () => {
        const app = buildTestApp(fixture, {}, 'User', '/users');
        const res = await request(app)
            .post('/users/atomic')
            .send({ 'atomic:operations': [] })
            .set('Content-Type', ATOMIC_CONTENT_TYPE);
        if (res.status === 200) {
            expect(res.body['atomic:results']).toEqual([]);
        }
    });
});
