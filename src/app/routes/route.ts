// Import type augmentation to enable proper type inference
import '@core/kusto-types';

import { ExpressRouter } from 'kusto-framework-core';
// import '../../core/kusto-types';


const router = new ExpressRouter();



router
.GET(async (req, res, injected, repo, db) => {

    console.log(injected.testMath);

    // 개발 모드일 때는 HTML 페이지 렌더링
    if (process.env.NODE_ENV === 'development') {
        return res.render('index', { 
            FRAMEWORK_URL: `https://github.com/taxi-tabby/express.js-kusto`,
            NODE_ENV: process.env.NODE_ENV,
        });
    }

    
    
    // 상용 모드일 때는 JSON 응답
    return res.json({
        status: "online",
        message: "Express.js-Kusto Framework is running",
        environment: "production",
        timestamp: new Date().toISOString()
    });
});


router.NOTFOUND((req, res)=>{
    res.status(404).send("Not found");
})


export default router.build();
