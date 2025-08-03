import { ExpressRouter } from '@lib/expressRouter'

const router = new ExpressRouter();



router
.GET(async (req, res, injected, repo, db) => {
    return res.render('index', { 
        FRAMEWORK_URL: `https://github.com/taxi-tabby/express.js-kusto`,
    });
});


router.NOTFOUND((req, res)=>{
    res.status(404).send("Not found");
})


export default router.build();
