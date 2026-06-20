import '@lib/types/express-extensions';
import { defaultGlobalMiddleware } from '@core/index';

/**
 * 글로벌 미들웨어 (모든 요청에 순서대로 적용).
 *
 * 프레임워크 기본 정책 스택(helmet · CORS · cookie · body 파서 · 요청 로깅)을 그대로 쓰되,
 * 필요하면 옵션으로 조정하거나(`defaultGlobalMiddleware({ corsWhitelist, bodyLimit, ... })`)
 * 아래에 자신의 미들웨어를 추가한다.
 *
 * 참고: req.kusto 주입 · 클라이언트 IP 해석 · 전역 에러 핸들러 같은 프레임워크 "필수"
 * 미들웨어는 Core 가 직접 소유·등록하므로 여기에 둘 필요가 없다. 이 파일을 삭제하면
 * Core 가 defaultGlobalMiddleware() 기본을 자동 적용한다.
 */
export default [
    ...defaultGlobalMiddleware(),

    // ↓ 여기에 프로젝트 전역 미들웨어를 추가하세요.
];
