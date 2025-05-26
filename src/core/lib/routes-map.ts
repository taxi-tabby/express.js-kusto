/**
 * 자동 생성된 라우트 맵
 * 이 파일은 빌드 타임에 생성되어 Webpack에서 번들링됩니다.
 */
import route_0 from '../../app/routes/route';
import route_1 from '../../app/routes/test1/route';
import route_2 from '../../app/routes/test2/route';
import middleware_0 from '../../app/routes/middleware';

// 라우트 맵 - 경로와 해당 라우트 모듈 연결
export const routesMap = {
  "/": route_0,
  "/test1": route_1,
  "/test2": route_2
};

// 미들웨어 맵 - 경로와 해당 미들웨어 모듈 연결
export const middlewaresMap = {
  "/": Array.isArray(middleware_0) ? middleware_0 : [middleware_0]
};

// 디렉토리 구조
export const directoryStructure = {
  "/": [
    "test1",
    "test2"
  ],
  "/test1": [],
  "/test2": []
};
