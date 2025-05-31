import { ExpressRouter } from '@/src/core/lib/expressRouter';
import { prismaManager } from '@core/lib/prismaManager';

const router = new ExpressRouter();


// 간단한 테스트 라우트
router.GET(async (req, res) => {

    // 기본 클라이언트 (타입 정보 기본)
    const client = prismaManager.getClient('testdb1'); // any 타입

    // 향상된 타입 정보를 가진 클라이언트 
    const typedClient = prismaManager.getWrap('testdb1'); // Testdb1Instance 타입 - 완전한 자동완성



    return res.json({
        message: 'Hello, this is a simple GET route for testing validation!',
    });
});




export default router.build();
