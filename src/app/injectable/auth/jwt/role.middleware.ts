import { Request, Response, NextFunction } from 'express';
import JWTService from './export.module';
import { TokenPayload } from './type';

export default () => {

    const jwt = new JWTService();
    let user: TokenPayload | undefined = undefined;


    /**
     * JWT 인증 미들웨어
     * WITH 메서드에서 전달된 파라미터를 활용할 수 있습니다.
     */
    const authenticate = (req: Request, res: Response, next: NextFunction) => {
        // WITH 메서드에서 전달된 파라미터 접근
        const token = jwt.extractTokenFromHeader(req.headers.authorization);

        // 토큰이 없으면 인증 실패
        if (token === null) {
            return res.status(401).json({ error: 'Authorization header is missing or invalid' });
        }

        try {
           
            if (user = jwt.verifyAccessToken(token ?? '')) {
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

        
        const middlewareParams = req.with.authJwtGuide;

        const requiredRoles = middlewareParams?.requiredRoles || [];


        if (user === undefined) {
            return res.status(401).json({ error: 'User not authenticated' });
        }

        if (requiredRoles.length > 0) {
            const userRoles = user.role || [];
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