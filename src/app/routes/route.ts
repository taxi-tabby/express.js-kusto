import { ExpressRouter } from '@core/lib/expressRouter'

const router = new ExpressRouter();

router.GET((req, res) => {
    return res.status(200).render('index', { 
        //배포명칭
        CONST_VERSION_NAME: 'express-custom-reborn-1.0.2',
    });
});



router.NOTFOUND((req, res)=>{
    res.status(404).send("Not found");
})


export default router.build();
