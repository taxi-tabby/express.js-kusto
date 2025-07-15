// Module alias 등록 (다른 import보다 먼저 실행되어야 함)
import 'module-alias/register';

import { EnvironmentLoader } from './core/lib/environmentLoader';
import { Application, log } from './core';

// 환경변수 로드 (가장 먼저 실행)
EnvironmentLoader.load();

// 환경 정보 출력
console.log(`🌍 Environment: ${EnvironmentLoader.get('NODE_ENV', 'undefined')}`);
console.log(`🚀 Host: ${EnvironmentLoader.get('HOST', 'localhost')}:${EnvironmentLoader.get('PORT', '3000')}`);
console.log(`� Production Mode: ${EnvironmentLoader.isProduction()}`);

// 애플리케이션 생성 및 설정
const app = new Application({
    port: parseInt(EnvironmentLoader.get('PORT') || '3000'),
    host: EnvironmentLoader.get('HOST') || '0.0.0.0',
    routesPath: './src/app/routes',
    viewsPath: './src/app/views',
    viewEngine: 'ejs',
    trustProxy: true
});

// 보안 헤더 설정
app.express.disable('x-powered-by');

// 애플리케이션 시작
app.start()
    .then(() => {
        log.Info('🎉 API Service started successfully!');
    })
    .catch((error: any) => {
        log.Error('Failed to API Service', { error });
        process.exit(1);
    });

