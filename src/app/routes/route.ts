import { ExpressRouter } from '@/src/core/lib/expressRouter'

const router = new ExpressRouter();

router.GET((req, res) => {
    return res.status(404).render('index', { 
        //배포명칭
        CONST_VERSION_NAME: 'express-custom-reborn-1.0.0',
    });
});

// 새로운 검증된 라우트 예시들

// 1. 사용자 생성 API (POST /api/users)
router.POST_VALIDATED(
    {
        // 요청 검증
        body: {
            name: { type: 'string', required: true, min: 2, max: 50 },
            email: { type: 'email', required: true },
            age: { type: 'number', required: false, min: 0, max: 120 },
            role: { type: 'string', required: false, enum: ['user', 'admin', 'moderator'] }
        }
    },
    {
        // 응답 검증 (200 상태코드일 때)
        200: {
            id: { type: 'number', required: true },
            name: { type: 'string', required: true },
            email: { type: 'string', required: true },
            age: { type: 'number', required: false },
            role: { type: 'string', required: true },
            createdAt: { type: 'string', required: true }
        }
    },
    async (req, res) => {
        // req.validatedData에 검증된 데이터가 들어있음
        const userData = req.validatedData?.body;
        
        // 비즈니스 로직 수행
        const newUser = {
            id: Math.floor(Math.random() * 1000),
            ...userData,
            role: userData.role || 'user',
            createdAt: new Date().toISOString()
        };

        // 응답 데이터 반환 (자동으로 검증되고 필터링됨)
        return newUser;
    }
);

// 2. 사용자 검색 API (GET /api/users/search?name=...&page=1&limit=10)
router.GET_WITH_VALIDATION(
    {
        query: {
            name: { type: 'string', required: false, min: 1 },
            page: { type: 'number', required: false, min: 1 },
            limit: { type: 'number', required: false, min: 1, max: 100 },
            active: { type: 'boolean', required: false }
        }
    },
    async (req, res) => {
        const searchParams = req.validatedData?.query;
        
        // 검색 로직
        const users = [
            { id: 1, name: 'John Doe', email: 'john@example.com', active: true },
            { id: 2, name: 'Jane Smith', email: 'jane@example.com', active: false }
        ];

        // 수동으로 성공 응답 전송
        return {
            users,
            pagination: {
                page: searchParams?.page || 1,
                limit: searchParams?.limit || 10,
                total: users.length
            }
        };
    }
);

// 3. 사용자 상세 조회 API (GET /api/users/:id) - 정확한 경로 매칭
router.GET_SLUG_VALIDATED(
    ['id'],
    {
        params: {
            id: { type: 'number', required: true, min: 1 }
        }
    },
    {
        200: {
            id: { type: 'number', required: true },
            name: { type: 'string', required: true },
            email: { type: 'string', required: true },
            profile: { type: 'object', required: false }
        }
    },
    async (req, res) => {
        const userId = req.validatedData?.params?.id;
        
        // 사용자 조회 로직
        if (userId === 999) {
            // 404 에러 예시
            res.status(404);
            throw new Error('User not found');
        }

        return {
            id: userId,
            name: 'John Doe',
            email: 'john@example.com',
            profile: {
                bio: 'Software Developer',
                location: 'Seoul'
            }
        };
    },
    { exact: true } // 하위 경로 매칭 방지
);

// 4. 사용자 업데이트 API (PUT /api/users/:id)
router.PUT_VALIDATED(
    {
        params: {
            id: { type: 'number', required: true }
        },
        body: {
            name: { type: 'string', required: false, min: 2, max: 50 },
            email: { type: 'email', required: false },
            active: { type: 'boolean', required: false }
        }
    },
    {
        200: {
            id: { type: 'number', required: true },
            name: { type: 'string', required: true },
            email: { type: 'string', required: true },
            active: { type: 'boolean', required: true },
            updatedAt: { type: 'string', required: true }
        }
    },
    async (req, res) => {
        const userId = req.validatedData?.params?.id;
        const updateData = req.validatedData?.body;

        return {
            id: userId,
            name: updateData?.name || 'Existing Name',
            email: updateData?.email || 'existing@email.com',
            active: updateData?.active ?? true,
            updatedAt: new Date().toISOString()
        };
    }
);

// 5. 하위 경로 매칭 예시
// GET /users/:id 는 /users/123 에만 매칭 (exact: true)
// GET /users/:id/profile 같은 하위 경로에는 매칭되지 않음
router.GET_SLUG_VALIDATED(
    ['userId', 'action'],
    {
        params: {
            userId: { type: 'number', required: true, min: 1 },
            action: { type: 'string', required: true, enum: ['profile', 'settings', 'posts'] }
        }
    },
    {
        200: {
            userId: { type: 'number', required: true },
            action: { type: 'string', required: true },
            data: { type: 'object', required: true }
        }
    },
    async (req, res) => {
        const { userId, action } = req.validatedData?.params || {};
        
        return {
            userId,
            action,
            data: {
                message: `User ${userId} ${action} data`,
                timestamp: new Date().toISOString()
            }
        };
    },
    { exact: true } // /users/123/profile 에만 매칭, /users/123/profile/edit 에는 매칭 안됨
);

// 6. 기본 동작 (하위 경로도 매칭)
router.GET_SLUG_VALIDATED(
    ['category'],
    {
        params: {
            category: { type: 'string', required: true }
        }
    },
    {
        200: {
            category: { type: 'string', required: true },
            items: { type: 'array', required: true }
        }
    },
    async (req, res) => {
        const { category } = req.validatedData?.params || {};
        
        return {
            category,
            items: [`${category} item 1`, `${category} item 2`]
        };
    }
    // exact 옵션 없음: /category/electronics, /category/electronics/phones 모두 매칭
);

router.NOTFOUND((req, res)=>{
    res.status(404).send("Not found");
})


export default router.build();
