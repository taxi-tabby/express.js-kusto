import { ExpressRouter } from '@lib/expressRouter'

const router = new ExpressRouter();



router
.GET(async (req, res, injected, repo, db) => {
    return res.render('index', { 
        CONST_VERSION_NAME: `1.0.0-kusto`,
    });
});


router.NOTFOUND((req, res)=>{
    res.status(404).send("Not found");
})


export default router.build();
