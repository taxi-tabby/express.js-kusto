# Ketsup Store Core Framework

현대적이고 직관적인 Express.js 기반 코어 프레임워크입니다.

## ✨ 특징

- 🚀 **간단한 시작**: 몇 줄로 서버 시작
- 🏗️ **모듈러 구조**: 필요한 기능만 사용
- 📝 **체계적인 로깅**: 컬러풀하고 구조화된 로그
- 🔄 **자동 라우트 로딩**: 파일 기반 라우팅
- 🛡️ **안전한 종료**: Graceful shutdown 지원
- 🎯 **TypeScript**: 완전한 타입 지원

## 🚀 빠른 시작

### 1. 기본 사용법 (권장)

```typescript
import { Application } from './core';

// 애플리케이션 생성 및 시작
const app = new Application({
  port: 3000,
  routesPath: './app/routes',
  viewsPath: './app/views'
});

app.start();
```

### 2. 고급 사용법

```typescript
import { Application, log } from './core';

const app = new Application({
  port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
  host: '0.0.0.0',
  routesPath: './app/routes',
  viewsPath: './app/views',
  viewEngine: 'ejs',
  trustProxy: true
});

// 커스텀 미들웨어 추가
app.use(express.json());
app.use(cors());

// 서버 시작
app.start()
  .then((server) => {
    log.Info('🎉 Application started successfully!');
  })
  .catch((error) => {
    log.Error('Failed to start application', { error });
  });
```

### 3. Core 클래스 직접 사용

```typescript
import { Core } from './core';

const core = Core.getInstance();

// 초기화
core.initialize({
  port: 3000,
  routesPath: './app/routes'
});

// 서버 시작
core.start();

// Express 앱에 직접 접근
const expressApp = core.app;
expressApp.use('/api', myApiRouter);
```

## 📝 로깅 시스템

### 로그 레벨

```typescript
import { log, logger } from './core';

// 기본 로그 레벨
log.Error('에러 메시지');     // ❌ [ERROR]: 에러 메시지
log.Warn('경고 메시지');      // ⚠️ [WARN]: 경고 메시지
log.Info('정보 메시지');      // 💡 [INFO]: 정보 메시지
log.Debug('디버그 메시지');   // 🐛 [DEBUG]: 디버그 메시지

// 전용 로그 레벨
log.SQL('SELECT * FROM users');           // 🗃️ [SQL]: SELECT * FROM users
log.Route('GET /api/users 200 - 45ms');   // 🛣️ [ROUTE]: GET /api/users 200 - 45ms
log.Auth('User login successful');        // 🔑 [AUTH]: User login successful
log.Email('Email sent to user@email.com'); // 📧 [EMAIL]: Email sent to user@email.com
```

### 유틸리티 함수

```typescript
// 성능 측정
const timer = logger.startTimer('Database Query');
// ... 작업 수행
timer.end(); // ⏱️ Database Query completed in 45.23ms

// HTTP 요청 로깅
logger.httpRequest('GET', '/api/users', 200, 45);

// DB 쿼리 로깅
logger.dbQuery('SELECT * FROM users WHERE id = ?', 23, [123]);
```

## 🛣️ 라우트 시스템

### 파일 기반 라우팅

```
app/routes/
├── index.ts          # GET /
├── users/
│   ├── index.ts      # GET /users
│   ├── [id]/
│   │   └── index.ts  # GET /users/:id
│   └── create.ts     # POST /users
└── api/
    └── v1/
        └── products/
            └── index.ts  # GET /api/v1/products
```

### ExpressRouter 사용법

```typescript
import { ExpressRouter } from './core';

const router = new ExpressRouter();

router
  .GET((req, res) => {
    res.json({ message: 'Hello World' });
  })
  .POST((req, res) => {
    res.json({ success: true });
  })
  .GET_SLUG(['id'], (req, res) => {
    res.json({ id: req.params.id });
  });

export default router.router;
```

## ⚙️ 설정

### 환경 변수

```env
# 서버 설정
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# 경로 설정
CORE_APP_BASEPATH=./app

# 로그 설정
LOG_LEVEL=Info

# 프록시 설정
TRUST_PROXY=true
```

### 설정 객체

```typescript
interface CoreConfig {
  basePath?: string;      // 기본 경로 (기본값: './app')
  routesPath?: string;    // 라우트 경로 (기본값: '{basePath}/routes')
  viewsPath?: string;     // 뷰 경로 (기본값: '{basePath}/views')
  viewEngine?: string;    // 뷰 엔진 (기본값: 'ejs')
  port?: number;          // 포트 (기본값: 3000)
  host?: string;          // 호스트 (기본값: '0.0.0.0')
  trustProxy?: boolean;   // 프록시 신뢰 (기본값: true)
}
```

## 🔄 라이프사이클 관리

```typescript
import { Application } from './core';

const app = new Application();

// 시작
await app.start();

// 재시작
await app.restart();

// 정지
await app.stop();

// 상태 확인
console.log(app.isRunning);           // true/false
console.log(app.getHealthStatus());   // 상세 상태 정보
```

## 🛡️ 안전한 종료

애플리케이션은 자동으로 다음 신호들을 처리합니다:

- `SIGTERM` - 정상적인 종료 신호
- `SIGINT` - Ctrl+C 인터럽트
- `uncaughtException` - 처리되지 않은 예외
- `unhandledRejection` - 처리되지 않은 Promise 거부

## 📈 성능 모니터링

```typescript
// 헬스 체크 엔드포인트 추가
app.express.get('/health', (req, res) => {
  res.json(app.getHealthStatus());
});
```

## 🔄 마이그레이션 가이드

### 기존 코드에서 마이그레이션

```typescript
// Before (기존)
import { initExpressCore_V1 } from './core';
const app = express();
initExpressCore_V1(app);

// After (새 방식)
import { Application } from './core';
const app = new Application();
app.start();
```

## 🤝 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 라이선스

이 프로젝트는 MIT 라이선스로 배포됩니다.
