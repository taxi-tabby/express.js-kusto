
import { Request, Response, NextFunction } from 'express';
import { prismaManager } from './prismaManager';

/**
 * Database Connection Middleware Options
 */
export interface DbConnectionMiddlewareOptions {
    /** 연결 확인할 데이터베이스 목록 (빈 배열이면 모든 DB 확인) */
    databases?: string[];
    
    /** 연결 실패 시 요청을 계속 처리할지 여부 */
    continueOnFailure?: boolean;
    
    /** 헬스체크 간격 (밀리초) */
    checkInterval?: number;
    
    /** 에러 발생 시 커스텀 응답 */
    onError?: (error: Error, req: Request, res: Response, next: NextFunction) => void;
    
    /** 재연결 성공 시 콜백 */
    onReconnect?: (database: string, req: Request) => void;
}

/**
 * Database Connection Health Check Middleware
 * Serverless 환경에서 각 요청마다 DB 연결 상태를 확인하고 필요시 재연결합니다.
 */
export function createDbConnectionMiddleware(options: DbConnectionMiddlewareOptions = {}) {
    const {
        databases = [], // 빈 배열이면 모든 DB 확인
        continueOnFailure = false,
        checkInterval = 30000, // 30초
        onError,
        onReconnect
    } = options;

    // 마지막 체크 시간을 저장
    const lastChecks: Map<string, number> = new Map();

    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            // 확인할 데이터베이스 목록 결정
            const databasesToCheck = databases.length > 0 
                ? databases 
                : prismaManager.getAvailableDatabases();

            if (databasesToCheck.length === 0) {
                return next(); // 확인할 DB가 없으면 통과
            }

            // 각 데이터베이스에 대해 연결 상태 확인
            const checkPromises = databasesToCheck.map(async (dbName) => {
                const now = Date.now();
                const lastCheck = lastChecks.get(dbName) || 0;

                // 체크 간격이 지나지 않았으면 스킵
                if (now - lastCheck < checkInterval) {
                    return { database: dbName, status: 'skipped' };
                }

                try {
                    // 서버리스 환경에서는 매번 연결 상태를 확인하고 필요시 재연결
                    const client = await prismaManager.getClient(dbName);
                    
                    // 간단한 헬스체크 쿼리 실행
                    await client.$queryRaw`SELECT 1 as health_check`;
                    
                    lastChecks.set(dbName, now);
                    
                    return { database: dbName, status: 'healthy' };
                } catch (error) {
                    console.warn(`⚠️ Database connection check failed for '${dbName}':`, error);
                    
                    // 재연결 시도
                    try {
                        console.log(`🔄 Attempting to reconnect to database '${dbName}'...`);
                        const client = await prismaManager.getClient(dbName);
                        await client.$queryRaw`SELECT 1 as health_check`;
                        
                        if (onReconnect) {
                            onReconnect(dbName, req);
                        }
                        
                        lastChecks.set(dbName, now);
                        return { database: dbName, status: 'reconnected' };
                    } catch (reconnectError) {
                        console.error(`❌ Failed to reconnect to database '${dbName}':`, reconnectError);
                        
                        if (continueOnFailure) {
                            return { database: dbName, status: 'failed', error: reconnectError };
                        } else {
                            throw reconnectError;
                        }
                    }
                }
            });

            // 모든 체크 완료 대기
            const results = await Promise.all(checkPromises);
            
            // 결과를 request 객체에 추가 (디버깅 용도)
            (req as any).dbConnectionCheck = {
                timestamp: new Date().toISOString(),
                results: results
            };

            next();

        } catch (error) {
            console.error('❌ Database connection middleware error:', error);
            
            if (onError) {
                onError(error as Error, req, res, next);
            } else if (continueOnFailure) {
                // 에러를 무시하고 계속 진행
                (req as any).dbConnectionError = error;
                next();
            } else {
                // 에러 응답 반환
                res.status(503).json({
                    error: 'Database connection failed',
                    message: error instanceof Error ? error.message : 'Unknown database error',
                    timestamp: new Date().toISOString()
                });
            }
        }
    };
}

/**
 * Express 앱에 DB 연결 미들웨어를 자동으로 등록하는 유틸리티
 */
export function setupDbConnectionMiddleware(
    app: any, 
    options: DbConnectionMiddlewareOptions = {}
) {
    const middleware = createDbConnectionMiddleware(options);
    
    // 모든 라우트에 미들웨어 적용
    app.use(middleware);
    
    console.log('🔗 Database connection middleware registered');
    
    return middleware;
}

/**
 * 특정 라우트에만 적용할 수 있는 선택적 DB 연결 체크 미들웨어
 */
export function dbHealthCheck(databases?: string[]) {
    return createDbConnectionMiddleware({
        databases: databases || [],
        continueOnFailure: false,
        checkInterval: 0 // 매번 체크
    });
}
