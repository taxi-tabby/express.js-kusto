import { ExpressRouter } from '@/src/core/lib/expressRouter';

const router = new ExpressRouter();


router.GET_VALIDATED(
    {
        query: {
            name: { type: 'string', required: true, min: 2 },
            age: { type: 'number', required: false, min: 0, max: 120 }
        }
    },
    {
        200: {
            message: { type: 'string', required: true },
            data: { type: 'object', required: false },
        },
        400: {
            errorx: { type: 'string', required: true },
        },
    },
    async (req, res) => {
        const { name, age } = req.validatedData?.query || {};
        

        return {
            message: `Hello ${name || 'World'}!`,
            data: {
                receivedName: name,
                receivedAge: age,
                timestamp: new Date().toISOString()
            },
            gay: 'xxxx'
        };
    }
);




export default router.build();
