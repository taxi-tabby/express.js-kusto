import { ExpressRouter } from '@core/lib/expressRouter'

const router = new ExpressRouter();






router.GET((req, res, injected, db) => {

    // 자동 수집된 의존성
    injected.exampleModule.setData('express-custom-reborn-1.0.5');
    
    // 상태
    res.status(200);

    return res.render('index', { 
        CONST_VERSION_NAME: injected.exampleModule.getData(),
    });
});



router.NOTFOUND((req, res)=>{
    res.status(404).send("Not found");
})


export default router.build();
