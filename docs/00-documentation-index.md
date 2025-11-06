# 📋 Express.js-Kusto Framework 문서 색인

> **완전한 문서 가이드**  
> 초보자부터 전문가까지, 모든 수준의 개발자를 위한 체계적인 학습 경로



## 📚 전체 문서 목록

### 기본 문서 (필수)

| 순서 | 문서 | 소요 시간 | 난이도 | 설명 |
|------|------|-----------|--------|------|
| 1 | **[🏗️ 핵심 아키텍처](./01-core-architecture.md)** | 10분 | ⭐ | Application, Core 클래스의 역할과 초기화 과정 |
| 2 | **[🛣️ 라우팅 시스템](./02-routing-system.md)** | 15분 | ⭐⭐ | ExpressRouter를 이용한 API 엔드포인트 구현 |
| 3 | **[🗄️ 데이터베이스 관리](./03-database-management.md)** | 20분 | ⭐⭐ | 멀티 DB 지원, Prisma 스키마, npm run db CLI |
| 4 | **[🔌 의존성 주입 시스템](./04-injectable-system.md)** | 15분 | ⭐⭐ | Injectable 폴더를 통한 모듈 및 미들웨어 관리 |
| 5 | **[🗂️ 리포지터리 패턴](./05-repository-pattern.md)** | 15분 | ⭐⭐ | Repos 폴더를 통한 데이터 액세스 레이어 구현 |
| 6 | **[🔄 CRUD 라우터](./06-crud-router.md)** | 20분 | ⭐⭐⭐ | CRUD 자동화 생성 및 관계형 쿼리 최적화 |
| 7 | **[🔄 업데이트 시스템](./07-update-system.md)** | 5분 | ⭐ | 최신 코드 베이스로 업데이트 |
| 8 | **[📋 CRUD 스키마 API](./08-crud-schema-api.md)** | 10분 | ⭐⭐ | 개발 모드 전용 스키마 정보 조회 API |





### 초기 실행 방법
1. git clone 또는 수동으로 파일을 받아서 npm 또는 패키지 매니저로 의존성을 설치
2. DB 연결 `app/db/...` 에서 연결 정보를 확인 후 `.env` 또는 `.env.prod`, `.env.dev` 로 연결 정보를 입력
3. `npm run db --- generate -a` 를 실행하여 prisma client 를 설치
4. `npm run db --- migrate -t dev -n "init" -d <db이름>` 또는 `npm run db --- push -d <db이름>` 를 실행하여 DB에 스키마를 배포
5. `npm run dev` 를 실행하여 서비스를 실행 





### 개발 도구 링크

개발 서버 실행 후 (`npm run dev`) 다음 URL에서 확인:

- **API 문서**: http://localhost:3000/docs
- **개발 대시보드**: http://localhost:3000/docs/dev
- **테스트 리포트**: http://localhost:3000/docs/test-report
- **CRUD 스키마 API** (개발 모드 전용): http://localhost:3000/api/schema

## 📞 도움이 필요하다면

- **GitHub Issues**: 버그 리포트 및 기능 제안
- **코드 리뷰**: Pull Request를 통한 코드 개선

