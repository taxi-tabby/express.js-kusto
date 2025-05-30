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




// POST 테스트 라우트
router.POST_VALIDATED(
    {
        body: {
            name: { type: 'string', required: true, min: 2, max: 50 },
            email: { type: 'email', required: true },
            age: { type: 'number', required: false, min: 18, max: 100 }
        }
    },
    {
        201: {
            id: { type: 'number', required: true },
            name: { type: 'string', required: true },
            email: { type: 'string', required: true },
            createdAt: { type: 'string', required: true }
        }
    },
    async (req, res) => {
        const userData = req.validatedData?.body;
        
        // 201 상태코드 설정
        res.status(201);
        
        return {
            id: Math.floor(Math.random() * 1000),
            name: userData.name,
            email: userData.email,
            age: userData.age, // 응답 스키마에 없으므로 제거될 예정
            createdAt: new Date().toISOString()
        };
    }
);

export default router.build();
