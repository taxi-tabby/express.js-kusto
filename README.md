# Express.js-Kusto Framework

> **엔터프라이즈급 TypeScript 백엔드 프레임워크**  
> Express.js 기반의 확장 가능하고 타입 안전한 웹 애플리케이션 프레임워크

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.18+-black.svg)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5.0+-2D3748.svg)](https://www.prisma.io/)

## ✨ 핵심 기능

<div align="center">

| 🏗️ **혁신적 아키텍처** | 🛡️ **완전 타입 안전** | ⚡ **제로 코드 자동화** | 🔧 **고급 개발 환경** |
|:---:|:---:|:---:|:---:|
| **App 라우트 시스템**<br/>파일 기반 자동 등록 | **Injectable DI**<br/>타입 안전 의존성 주입 | **CRUD 자동 생성**<br/>REST API + 문서화 | **Webpack 빌드**<br/>프로덕션 최적화 |
| **DB/Repo 분리**<br/>멀티 데이터베이스 관리 | **Import-Free 구조**<br/>injected/repo/db 자동 주입 | **테스트 자동 생성**<br/>보안 테스트 포함 | **실시간 대시보드**<br/>/docs/dev 모니터링 |

</div>

---

<div align="center">

### 🎯 **쓸데없는 추상화 제거!**

**기능 하나 수정한답시고 여러 파일과 폴더를 바꿔야 하는 번거로움을 완전히 제거합니다**

</div>

<div align="center">

📋 **DTO 변환**, **Mapper 로직**, **반복적인 CRUD 작성**에 지친 개발자들을 위한 혁신적 솔루션  

🚀 복잡한 설정과 불필요한 추상화를 제거하고 **진짜 비즈니스 로직**에만 집중  

⚡ **개발 속도 3배 향상** • **팀 협업 효율성 극대화** • **유지보수성 혁신적 개선**

</div>




## 🚀 빠른 시작

```bash
# 프로젝트 복제 및 의존성 설치
git clone <repository-url>
cd express.js-kusto
npm install

# 환경 설정
cp .env.example .env
# .env 파일을 편집하여 데이터베이스 연결 정보 입력

# 개발 서버 시작
npm run dev
```

서버가 시작되면 다음 주소에서 확인할 수 있습니다:
- **API 서버**: http://localhost:3000
- **자동 문서화**: http://localhost:3000/docs
- **개발자 대시보드**: http://localhost:3000/docs/dev



## 📄 라이선스

ISC

---

## 🔗 주요 링크

<div align="center">

### 📚 [개발 시작하기](./docs/00-documentation-index.md)
> 프레임워크 사용법과 개발 가이드를 확인하세요

### 💬 [이슈 리포트](../../issues)
> 버그 신고나 기능 요청을 해주세요

</div>

---

## 성능

> CRUD 메서드의 INDEX (/example?page[number]=1&page[size]=10) 성능 테스트 입니다.
> 해당 메서드로 성능 테스트 했을 때 이정도지 일반 메서드로 구현하면 더 성능이 좋아집니다.
[CRUD - INDEX : https://app.artillery.io/share/sh_7bceb339dff363ef0a79ded0b8a63c29d43d8f49bc683a62f199d253467aadd4](https://app.artillery.io/share/sh_7bceb339dff363ef0a79ded0b8a63c29d43d8f49bc683a62f199d253467aadd4)

```text
OS: WINDOW 11
CPU: RYZEN 5600X
RAM: samsung ddr4 2666 8gb * 4 
DB: postgresql
TestData Row Count: 2,008
```


---

<div align="center">

**Express.js-Kusto Framework**  
엔터프라이즈급 TypeScript 백엔드 프레임워크

</div>
