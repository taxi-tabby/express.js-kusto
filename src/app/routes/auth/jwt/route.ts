import { ExpressRouter } from '@lib/expressRouter';

const router = new ExpressRouter();


router.POST_VALIDATED(
    {
        body: {
            email: { type: 'email' },
            password: { type: 'string', min: 8, max: 64 },
        }
    },
    {
        200: {
            message: { type: 'string', required: true },
            data: { type: 'object', required: false },
        },
        400: {
            error: { type: 'string', required: true },
        }
    }, async (req, res) => {

    });





export default router.build();
