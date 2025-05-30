import { ExpressRouter } from '@/src/core/lib/expressRouter';

const router = new ExpressRouter();


// 간단한 테스트 라우트
router.GET(async (req, res) => {
    return res.json({
        message: 'Hello, this is a simple GET route for testing validation!',
    });
});




export default router.build();
