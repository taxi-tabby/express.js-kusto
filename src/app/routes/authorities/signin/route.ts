import { ExpressRouter } from '@lib/expressRouter';
const router = new ExpressRouter();









/**
 * 관리자 로그인 요청입니다.
 */
router
.WITH('authRateLimiterDefault', {
    repositoryName: 'accountUser', 
    maxRequests: 3, 
    windowMs: 1*60*1000, 
    message: "로그인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
})
.WITH('authJwtNoLoginOnly')
.POST_VALIDATED(
    {
        body: {
            email: { type: 'email', required: true },
            password: { type: 'string', required: true }
        }
    },
    {
        200: {
            success: {type: 'boolean', required: true},
            accessToken: { type: 'string', required: true },
            refreshToken: { type: 'string', required: true },
            uuid: { type: 'string', required: false },
        },
        400: {
            error: { type: 'string', required: true }
        },
    },
    async (req, res, injected, repo, db) => {
    
        const jwt = injected.authJwtExport;                  
        const userRepo = repo.getRepository('accountUser');   
        const data = req.validatedData;    



        const _userInfo = await userRepo.findByEmail(data?.body.email);

        if (!_userInfo) {
            res.status(400);
            return {
                error: '로그인에 실패했습니다'
            }
        }

        if (!await jwt.verifyPassword(data?.body.password, _userInfo?.passwordHash ?? '')) {
            res.status(400);
            return {
                error: '로그인에 실패했습니다'
            }
        }

        if (!_userInfo.isActive) {
            res.status(400);
            return {
                error: '사용자가 비활성화되었습니다'
            }
        }

        if (_userInfo.isSuspended) {
            res.status(400);
            return {
                error: '사용자가 정지되었습니다'
            }
        }

        const withRoles = await userRepo.findWithRoles(_userInfo.uuid);


        // accessToken?: string;
        // refreshToken?: string;

        const accessToken = jwt.generateAccessToken({
            uuid: _userInfo.uuid.toString(),
            email: _userInfo.email,
            role: withRoles?.roles.map((userRole: any) => userRole.role.uuid) ?? []
        });

        const refreshToken = jwt.generateRefreshToken({
            uuid: _userInfo.uuid.toString(),
            email: _userInfo.email,
            role: withRoles?.roles.map((userRole: any) => userRole.role.uuid) ?? []
        })

        const payload = jwt.verifyAccessToken(accessToken);


        return {
            success: true,
            accessToken,
            refreshToken,
            uuid: payload.uuid
        }
    }
)

export default router.build();
