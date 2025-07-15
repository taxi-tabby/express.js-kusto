import { Request, Response, NextFunction } from 'express';

export default () => {

    /**
     * JWT 인증 미들웨어
     * WITH 메서드에서 전달된 파라미터를 활용할 수 있습니다.
     */
    const authenticate = (req: Request, res: Response, next: NextFunction) => {
        // WITH 메서드에서 전달된 파라미터 접근
        const middlewareParams = req.with.authGuide;


        
        const token = req.headers.authorization?.replace('Bearer ', '');
        


        // 여기서 JWT 토큰 검증 로직을 구현
        // 예: jwt.verify(token, secretKey)
        
        try {
            // 임시로 간단한 검증 로직
            if (token === 'valid-token') {
                (req as any).user = { id: 1, username: 'testuser' };
                
                
                next();
            } else {
                return res.status(401).json({ error: 'Invalid token' });
            }
        } catch (error) {
            return res.status(401).json({ error: 'Token verification failed' });
        }
    };    
    
    /**
     * 권한 확인 미들웨어
     * WITH 메서드에서 전달된 파라미터를 활용할 수 있습니다.
     */
    const authorize = (req: Request, res: Response, next: NextFunction) => {

        const middlewareParams = req.with.authGuide;

        const requiredRoles = middlewareParams?.requiredRoles || [];

        const user = (req as any).user;
        
        if (!user) {
            return res.status(401).json({ error: 'User not authenticated' });
        }



        // 필요한 역할이 지정된 경우 확인
        if (requiredRoles.length > 0) {
            const userRoles = user.roles || [];
            const hasRequiredRole = requiredRoles.some((role: string) => userRoles.includes(role));
            
            if (!hasRequiredRole) {
                return res.status(403).json({ 
                    error: `Access denied. Required roles: ${requiredRoles.join(', ')}` 
                });
            }
        }
        
        next();
    };    
    


    return {
        authenticate,
        authorize
    };
};