import { ExpressRouter } from '@/src/core/lib/expressRouter'

const router = new ExpressRouter();

router.GET((req, res) => {
    return res.status(404).render('index', { 
        //배포명칭
        CONST_VERSION_NAME: 'express-custom-reborn-1.0.0',
    });
});

router.NOTFOUND((req, res)=>{
    res.status(404).send("Not found [root]");
})


export default router.build();
