import { Request, Response, NextFunction } from 'express';


export default () => {



    /**
     * Authentication Token
     */
    var token: string | null = null;



    /**
     * 기본 Rate Limiter 미들웨어
     * - 요청 제한을 위한 기본 설정을 적용합니다.
     * - 환경 변수에 따라 동작합니다.
     */    
    return [        
        (req: Request, res: Response, next: NextFunction) => {
            const jwt = req.kusto.injectable.authJwtExport;
            token = jwt.extractTokenFromHeader(req.headers.authorization);
            next();
        },
        async (req: Request, res: Response, next: NextFunction) => {
            const jwt = req.kusto.injectable.authJwtExport;
            const param = req.with.authRateLimiterOption;
            var adminUUID: string | undefined = undefined;

            if (process.env.NODE_ENV === 'development' ) {
                next();
                return;
            }


            if (param === undefined) {
                return res.status(400).json({ error: 'Rejected' });
            }
            const repoName = param.repositoryName;


            const rateLimit = {
                maxRequests: param.maxRequests || parseInt('10'),
                windowMs: param.windowMs || parseInt('60000'), 
                message: param.message || '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
            };

            const ip = req.ip; // IP 주소를 키로 사용
            const currentTime = Date.now();
            
            if (token !== null) {
                const payload = jwt.verifyAccessToken(token ?? '');
                adminUUID = payload.uuid;
            }



            const windowStart = new Date(Math.floor(currentTime / rateLimit.windowMs) * rateLimit.windowMs);
            const windowEnd = new Date(windowStart.getTime() + rateLimit.windowMs);      

              if (repoName === 'accountUser') {
                const repo = req.kusto.getRepository(repoName);
                
                // 1. 현재 rate limit 상태 조회
                const currentRateLimit = await repo.getRateLimit({
                    adminUuid: adminUUID,
                    ipAddress: ip || '',
                    endpoint: req.originalUrl,
                    method: req.method,
                    windowStart: windowStart
                });

                // 2. 이미 차단된 상태인지 확인
                if (currentRateLimit?.isBlocked) {
                    return res.status(429).json({ error: `${rateLimit.message} [0]` });
                    // return res.status(429).json({ error: rateLimit.message });
                }

                // 3. 현재 요청 수 확인
                const currentCount = currentRateLimit?.requestCount || 0;

                // 4. 제한 초과 시 차단 처리
                if (currentCount >= rateLimit.maxRequests) {
                    await repo.createOrUpdateRateLimit({
                        adminUuid: adminUUID,
                        ipAddress: ip || '',
                        endpoint: req.originalUrl,
                        method: req.method,
                        windowStart: windowStart,
                        windowEnd: windowEnd,
                        isBlocked: true,
                        blockUntil: new Date(Date.now() + rateLimit.windowMs),
                        requestCount: currentCount + 1
                    });
                    
                    return res.status(429).json({ error: `${rateLimit.message} [1]` });
                }

                // 5. 정상적인 요청 - 카운트 증가 (단일 호출로 최적화)
                await repo.createOrUpdateRateLimit({
                    adminUuid: adminUUID,
                    ipAddress: ip || '',
                    endpoint: req.originalUrl,
                    method: req.method,
                    windowStart: windowStart,
                    windowEnd: windowEnd,
                    requestCount: currentCount + 1
                });

            } else {
                return res.status(400).json({ error: 'Repository not supported' });
            }



            next();

        }
    ]
}


