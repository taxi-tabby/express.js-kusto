import { ExpressRouter } from '@lib/expressRouter';

const router = new ExpressRouter();


router.POST_VALIDATED(
    {
        body: {
            email: { type: 'email' },
            password: { type: 'string', min: 8, max: 64 }
        }
    },
    {
        200: {
            message: { type: 'string' },
            token: { type: 'string' },
            refreshToken: { type: 'string' },
            isSuccess: { type: 'string' }

        },
        400: {
            message: { type: 'string' }
        },
    },
    async (req, res, inject, db) => {
        
        const jwt = inject.authJSONWEBToken;
        // inject.authJSONWEBToken.
        
        const callbackResult = await jwt.handleSignIn(
            {
                email: req.body.email,
                password: req.body.password
            },
            // 사용자 조회 콜백
            async (email) => {

                // 주의: 현재 스키마에는 password 필드가 없으므로 테스트용 데이터 사용
                let user: any = null;
                // const user = await db.getWrap('omofictions').user.findUnique({
                //     where: { email }
                // });


                if (user) {
                    return {
                        id: user.id.toString(), // number를 string으로 변환
                        email: user.email,
                        role: 'user', // 기본 역할
                        hashedPassword: '$2b$10$example.hash.for.testing', // 테스트용 해시 (실제로는 DB에서 가져와야 함)
                        isActive: true,
                        name: user.name
                    }
                }

                return null;
            },
            // 성공 콜백
            async (result) => {
                console.log(`사용자 ${result.user?.email} 로그인 성공`);
                return result;
            },
            // 실패 콜백
            async (error) => {
                return null;
            }
        );


        if (callbackResult === null) {
            res.status(400);
            return {
                message: '로그인에 실패했습니다. 이메일 또는 비밀번호를 확인해주세요.'
            };
        }

        return {
            message: callbackResult.message,
            token: callbackResult.accessToken,
            refreshToken: callbackResult.refreshToken,
            isSuccess: callbackResult.success
        };
    }
);


export default router.build();
