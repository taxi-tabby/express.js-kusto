import { ExpressRouter } from '@lib/expressRouter'

const router = new ExpressRouter();

router.MIDDLEWARE([
    (req, res, next, injected, repo, db) => {

        console.log('This is a middleware');
        next();
    }
])

export default router.build();