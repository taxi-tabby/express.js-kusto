import { ExpressRouter } from '@core/lib/expressRouter'

const router = new ExpressRouter();

router.GET((req, res, injected, db) => {

    // db.getWrap('testdb1').order
    injected.exampleModule.setData('express-custom-reborn-1.0.5');
    

    return res.status(200).render('index', { 
        //배포명칭
        CONST_VERSION_NAME: injected.exampleModule.getData(),
    });
});



router.NOTFOUND((req, res)=>{
    res.status(404).send("Not found");
})


export default router.build();
