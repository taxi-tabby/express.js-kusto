import { ExpressRouter } from '@core/lib/expressRouter'

const router = new ExpressRouter();






router.GET((req, res, injected, repo, db) => {

    const userRepo = repo.getRepository('accountUser');
    



    // 상태
    res.status(200);

    return res.render('index', { 
        CONST_VERSION_NAME: 'v1.0.0',
    });
});



router.NOTFOUND((req, res)=>{
    res.status(404).send("Not found");
})


export default router.build();
