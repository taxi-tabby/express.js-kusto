import { ExpressRouter } from '@/src/core/lib/expressRouter';
import { prismaManager } from '@core/lib/prismaManager';

const router = new ExpressRouter();


// 간단한 테스트 라우트
router.GET(async (req, res) => {
    try {

        
        // 기본 클라이언트 (타입 정보 기본)
        // const client = prismaManager.getClient('testdb1'); // 기본 타입


        
        // // 향상된 타입 정보를 가진 클라이언트 
        const typedClient = prismaManager.getWrap('testdb1'); // 향샹된 타입 (기본 인터페이스는 같으나 자원을 더 소모하여 안정적임)

        

        // // 그런거 없으면
        // const emptyConnectionInterface = prismaManager.getWrap('testdb1x');

        return res.json({
            message: 'Hello, this is a simple GET route for testing validation!',
            dbConnectionStatus: 'connected'
        });


    } catch (error) {
        console.error('라우트 처리 중 오류 발생:', error);
        return res.status(500).json({
            error: error instanceof Error ? error.message : '데이터베이스 연결 오류',
            status: 'failed'
        });
    }
});




export default router.build();
