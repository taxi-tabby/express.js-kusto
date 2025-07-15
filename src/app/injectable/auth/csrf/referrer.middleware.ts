import { Request, Response, NextFunction } from 'express';
import { log } from '@/src/core/external/winston';

/**
 * CSRF Referrer 미들웨어
 * 요청의 Referrer 헤더를 검증하여 CSRF 공격을 방지합니다.
 * 신뢰할 수 있는 오리진에서만 요청을 허용합니다.
 */
export default () => {

    const validateReferrer = (req: Request, res: Response, next: NextFunction) => {

        const dep = req.app.get('_csrfReferrerMiddleware');
        if (!dep) {
            log.Error('CSRF Referrer Middleware is not initialized. Please ensure it is set up correctly.');
            return res.status(500).json({ error: 'CSRF Internal Server Error' });
        }

        if (process.env.NODE_ENV === 'production') {
            dep(req, res, next);
        } else {
            next();
        }


    }


    return {
        validateReferrer
    };
};