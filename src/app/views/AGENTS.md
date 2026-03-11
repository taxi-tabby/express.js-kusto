# views/ - Server-Side Templates

EJS 템플릿 엔진을 사용한 서버사이드 렌더링 뷰 파일 폴더.

## Template Engine

**EJS** (Embedded JavaScript) — `.ejs` 확장자

## Usage in Routes

```typescript
// route.ts에서 EJS 렌더링
res.render('index', {
    FRAMEWORK_URL: 'https://example.com',
    NODE_ENV: process.env.NODE_ENV
});
```

## Conventions

- 주로 개발 모드 대시보드, 랜딩 페이지 등에 사용
- 프로덕션에서는 JSON API 응답이 일반적
- 변수 전달: `<%= variableName %>`, 조건문: `<% if (...) { %>`
