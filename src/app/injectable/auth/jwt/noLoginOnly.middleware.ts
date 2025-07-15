import { Request, Response, NextFunction } from 'express';
import JWTService from './export.module';
import { TokenPayload } from './type';

export default () => {

    const jwt = new JWTService();
    let user: TokenPayload | undefined = undefined;
    const authenticate = (req: Request, res: Response, next: NextFunction) => {

        // WITH 메서드에서 전달된 파라미터 접근
        const token = jwt.extractTokenFromHeader(req.headers.authorization);

        // 토큰이 없으면 통과 (로그인하지 않은 상태여야 함)
        if (token === null) {
            return next();
        }

        try {
            // 토큰이 유효하면 이미 로그인된 상태이므로 접근 거부
            if (user = jwt.verifyAccessToken(token ?? '')) {
                return res.status(403).json({ error: 'Already logged in. Please logout first.' });
            } else {
                // 토큰이 무효하면 통과 (로그인하지 않은 상태)
                return next();
            }
        } catch (error) {
            // 토큰 검증 실패시에도 통과 (로그인하지 않은 상태)
            return next();
        }
        
    };
    

    


    return {
        authenticate,
    };
};