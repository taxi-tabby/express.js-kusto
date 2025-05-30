import { ExpressRouter } from '@/src/core/lib/expressRouter';

const router = new ExpressRouter();


// 간단한 테스트 라우트
router.GET_VALIDATED(
    {
        query: {
            name: { type: 'string', required: true, min: 2 },
            age: { type: 'number', required: false, min: 0, max: 120 }
        }
    },
    {
        200: {
            message: { type: 'string', required: true },
            data: { type: 'object', required: false },
        }
    },
    async (req, res) => {
        const { name, age } = req.validatedData?.query || {};
        
        return {
            message: `Hello ${name || 'World'}!`,
            data: {
                receivedName: name,
                receivedAge: age,
                timestamp: new Date().toISOString()
            },
        };
    }
);



export default router.build();
