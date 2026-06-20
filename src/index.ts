// Module alias 등록 (다른 import보다 먼저 실행되어야 함)
import 'module-alias/register';

import { EnvironmentLoader } from './core/lib/config/environmentLoader';
import { Application, log } from './core';
import { resolveServerDefaults } from './core/bootstrap/Core';

// 환경변수 로드 (가장 먼저 실행)
EnvironmentLoader.load();

// 환경 정보 출력
log.Debug(`Environment: ${EnvironmentLoader.get('NODE_ENV', 'undefined')}`);
log.Debug(`Host: ${EnvironmentLoader.get('HOST', 'localhost')}:${EnvironmentLoader.get('PORT', '3000')}`);
log.Debug(`Production Mode: ${EnvironmentLoader.isProduction()}`);

// 애플리케이션 생성 및 설정
// port/host 의 env 기본값 해석은 Core 와 공유하는 resolveServerDefaults() 로 일원화한다.
// (EnvironmentLoader.load() 이후 호출하므로 .env 값이 반영된다 — 기존 동작과 동일)
const app = new Application({
    ...resolveServerDefaults(),
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
        log.Info('API Service started successfully!');
    })
    .catch((error: any) => {
        log.Error('Failed to start API Service', { error });
        process.exit(1);
    });

