import { ExpressRouter } from '@lib/expressRouter'

const router = new ExpressRouter();

// UUID 기반 사용자 CRUD (UUID 파서 추가)
router.CRUD('user', 'user', {
    primaryKey: 'uuid',
});




export default router.build();
