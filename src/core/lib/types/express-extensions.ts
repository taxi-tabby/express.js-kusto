// Type extensions for Express Request object
import { MiddlewareParamName, MiddlewareParams } from './generated-injectable-types';
import type { KustoManager } from '../kustoManager';

declare global {
  namespace Express {
    interface Request {
      /**
       * WITH 메서드에서 전달된 미들웨어 파라미터들
       * 각 미들웨어별로 전달된 파라미터에 접근할 수 있습니다.
       */
      with: {
        [K in MiddlewareParamName]?: MiddlewareParams[K];
      };
      
      /**
       * Kusto 프레임워크의 중앙 관리자
       * injectable, repo, db 등 모든 주요 서비스에 접근할 수 있습니다.
       */
      kusto: KustoManager;
    }
  }
}





export {};
