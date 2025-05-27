// Module alias 등록 (다른 import보다 먼저 실행되어야 함)
import 'module-alias/register';

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { Application, log } from './core';

console.log('is running!');


// 환경 변수 파일 로딩 함수 (개발 모드에서만 실행)
function loadEnvironmentConfig() {
    // webpack 빌드 시에는 환경변수가 이미 번들에 포함되어 있으므로 건너뛰기
    if (process.env.WEBPACK_BUILD === 'true') {
        console.log('🔧 Using embedded environment variables from webpack build');
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'undefined'}`);
        console.log(`🚀 Host: ${process.env.HOST}:${process.env.PORT}`);
        return;
    }
    
    // 기본 .env 파일 경로
    const defaultEnvPath = resolve(process.cwd(), '.env');
    
    // 기본 .env 파일이 존재하는지 확인
    if (!existsSync(defaultEnvPath)) {
        console.error('❌ .env file not found! Application requires environment configuration.');
        console.error('   Please create .env file in the project root.');
        process.exit(1);
    }
    
    // 1. 기본 .env 파일 먼저 로드
    console.log(`🔧 Loading base environment config from: ${defaultEnvPath}`);
    config({ path: defaultEnvPath });
    
    // 2. NODE_ENV 기반 환경별 파일로 덮어쓰기
    const nodeEnv = process.env.NODE_ENV;
    let envSpecificPath: string | null = null;
    
    if (nodeEnv === 'development') {
        envSpecificPath = resolve(process.cwd(), '.env.dev');
    } else if (nodeEnv === 'production') {
        envSpecificPath = resolve(process.cwd(), '.env.prod');
    }
    
    // 환경별 파일이 존재하면 덮어쓰기
    if (envSpecificPath && existsSync(envSpecificPath)) {
        console.log(`🔧 Overriding with environment-specific config from: ${envSpecificPath}`);
        config({ path: envSpecificPath, override: true });
    } else if (nodeEnv) {
        console.log(`⚠️ Environment-specific file (.env.${nodeEnv}) not found, using base .env only`);
    }
    
    // 최종 환경 정보 출력
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'undefined'}`);
    console.log(`🚀 Host: ${process.env.HOST}:${process.env.PORT}`);
}

// 환경 변수 로딩 실행
loadEnvironmentConfig();




// 애플리케이션 생성 및 설정
const app = new Application({
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
    host: process.env.HOST || '0.0.0.0',
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

