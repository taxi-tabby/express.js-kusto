import { ExpressRouter } from '@lib/expressRouter'

const router = new ExpressRouter();

router.GET((req, res) => {
    res.send('loaderio-f1f70758a01c3fa3ccbf10e39b2c12c5');
});

export default router.build();