import { RepositoryName } from '@lib/types/generated-repository-types'

export interface RateLimiterOptionMiddlewareParams {
    /**
     * 요청 제한을 위한 최대 요청 수
     * - 기본값은 100
     */
    maxRequests: number;

    /**
     * 시간 윈도우 길이 (밀리초 단위)
     * - 기본값은 60000 (1분)
     */
    windowMs: number;

    /**
     * 제한 초과 시 반환할 메시지
     * - 기본값은 'Too many requests, please try again later.'
     */
    message?: string;

    /**
     * 리포지터리 명칭
     */
    repositoryName: RepositoryName;

}