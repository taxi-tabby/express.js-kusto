// Module alias 등록 (다른 import보다 먼저 실행되어야 함)
import 'module-alias/register';
import KustoFramework from 'kusto-framework-core'
import { MODULE_REGISTRY, MIDDLEWARE_REGISTRY } from './core/generated-injectable-types';

const Application = KustoFramework.Application;
const Log = KustoFramework.log;
const envLoader = KustoFramework.EnvironmentLoader;

// 환경변수 로드 (가장 먼저 실행)
envLoader.load();

// 환경 정보 출력
console.log(`🌍 Environment: ${envLoader.get('NODE_ENV', 'undefined')}`);
console.log(`🚀 Host: ${envLoader.get('HOST', 'localhost')}:${envLoader.get('PORT', '3000')}`);
console.log(`- Production Mode: ${envLoader.isProduction()}`);

// 애플리케이션 생성 및 설정
const app = new Application({
    port: parseInt(envLoader.get('PORT') || '3000'),
    host: envLoader.get('HOST') || '0.0.0.0',
    routesPath: './src/app/routes',
    viewsPath: './src/app/views',
    viewEngine: 'ejs',
    trustProxy: true,
    dependencyInjector: {
        moduleRegistry: MODULE_REGISTRY,
        middlewareRegistry: MIDDLEWARE_REGISTRY,
    }
});

// 보안 헤더 설정
app.express.disable('x-powered-by');

// 애플리케이션 시작
app.start()
    .then(() => {
        Log.Info('🎉 API Service started successfully!');
    })
    .catch((error: any) => {
        Log.Error('Failed to API Service', { error });
        process.exit(1);
    });

