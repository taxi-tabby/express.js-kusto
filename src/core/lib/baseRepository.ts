import { prismaManager, PrismaManager } from './prismaManager';
import { DatabaseClientMap } from './types/generated-db-types'
import type { DatabaseNamesUnion } from './types/generated-db-types';
import { log } from '../external/winston';
import {
    TransactionCommitManager,
    TransactionParticipant,
    TransactionCommitOptions,
    TransactionCommitResult,
    TransactionState
} from './transactionCommitManager';


/**
 * 분산 트랜잭션 작업 정의
 * 자동화된 분산 트랜잭션을 위한 인터페이스 (보상 트랜잭션 지원)
 * @template TDatabase 데이터베이스 타입 (database 속성의 값에 따라 operation 매개변수 타입이 자동 추론됨)
 */
export interface DistributedTransactionOperation<TDatabase extends DatabaseNamesUnion = DatabaseNamesUnion> {
    database: TDatabase;
    operation: (prisma: DatabaseClientMap[TDatabase]) => Promise<any>;
    timeout?: number;

    /** 트랜잭션 우선순위 (높을수록 먼저 커밋) */
    priority?: number;

    /** 특정 리소스에 대한 락 요구사항 */
    requiredLocks?: string[];

    /** 보상 트랜잭션 - 실패 시 되돌리기 위한 작업 */
    rollbackOperation?: (prisma: DatabaseClientMap[TDatabase]) => Promise<void>;
}



/**
 * 리포지터리의 통합된 규칙을 위한 기본 확장용 클래스.
 * 이 클래스를 상속받아 각 더욱 편리하게 repository를 구현할 목적.
 */
export abstract class BaseRepository<T extends DatabaseNamesUnion> {

    /// PrismaManager 인스턴스
    /// 이 인스턴스는 생성자에서 주입받거나 기본값으로 설정됩니다.
    protected db: PrismaManager;

    /// 2PC 매니저 인스턴스
    private twoPhaseCommitManager: TransactionCommitManager;


    /// 리포지터리의 데이터베이스 이름
    /// 이 값은 생성자에서 설정되어야 하며, 타입 안전성을 보장합니다.
    protected repositoryDatabaseName!: T;


    /**
     * 생성자
     * @param prismaManagerInstance PrismaManager 인스턴스 (선택적)
     */
    constructor(prismaManagerInstance?: PrismaManager) {
        this.db = prismaManagerInstance || prismaManager;
        this.twoPhaseCommitManager = new TransactionCommitManager(this.db);
        
        // 하위 클래스에서 데이터베이스 설정을 완료했는지 확인
        this.validateRepositorySetup();
    }

    /**
     * 추상 메서드: 하위 클래스에서 반드시 구현해야 함
     * 데이터베이스 이름을 반환하여 타입 안전성을 보장
     */
    protected abstract getDatabaseName(): T;

    /**
     * 리포지터리 설정 검증 및 초기화
     * 생성자에서 자동으로 호출되며, 하위 클래스의 getDatabaseName() 구현을 강제
     */
    private validateRepositorySetup(): void {
        // getDatabaseName()이 구현되지 않으면 런타임 에러 발생
        const databaseName = this.getDatabaseName();
        
        if (!databaseName) {
            throw new Error(`Repository must implement getDatabaseName() method and return a valid database name. Current class: ${this.constructor.name}`);
        }
        
        this.repositoryDatabaseName = databaseName;
    }

    /**
     * @deprecated 이제 getDatabaseName() 추상 메서드를 구현하세요
     * 리포지터리 데이터베이스 이름 설정
     * 상속받은 클래스에서 생성자에서 호출해야 함
     */
    protected setRepositoryDatabase(databaseName: T): void {
        console.warn(`setRepositoryDatabase is deprecated. Implement getDatabaseName() abstract method instead in ${this.constructor.name}`);
        this.repositoryDatabaseName = databaseName;
    }

    /**
     * 리포지터리의 데이터베이스 클라이언트
     * @returns 타입 안전한 Prisma 클라이언트
     */
    protected get client(): DatabaseClientMap[T] {
        return this.db.getWrap(this.repositoryDatabaseName);
    }

    /**
     * 비동기 데이터베이스 클라이언트 (재연결 로직 포함)
     * @returns 타입 안전한 Prisma 클라이언트 (Promise)
     */
    protected async getAsyncClient(): Promise<DatabaseClientMap[T]> {
        return await this.db.getClient(this.repositoryDatabaseName) as DatabaseClientMap[T];
    }

    /**
     * 서버리스 최적화: DB 쿼리 실행 시 자동 재연결 래퍼
     * 연결 오류 발생 시 자동으로 재연결 후 재시도
     */
    protected async executeWithAutoReconnect<R>(
        operation: (client: DatabaseClientMap[T]) => Promise<R>,
        maxRetries: number = 1
    ): Promise<R> {
        let lastError: Error | null = null;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const client = await this.getAsyncClient();
                return await operation(client);
            } catch (error: any) {
                lastError = error;
                
                // 연결 관련 오류인지 확인
                const isConnectionError = this.isConnectionError(error);
                
                if (isConnectionError && attempt < maxRetries) {
                    // 개발 환경에서만 재연결 시도 로그 출력
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`🔄 DB connection error, attempting reconnection (${attempt + 1}/${maxRetries + 1})`);
                    }
                    
                    // 재연결 시도
                    try {
                        await this.db['reconnectDatabase'](this.repositoryDatabaseName);
                    } catch (reconnectError) {
                        // 재연결 실패 로그 제거 (성능상 불필요)
                    }
                    
                    // 짧은 대기 후 재시도
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }
                
                // 재시도 불가능하거나 재시도 횟수 초과
                throw error;
            }
        }
        
        throw lastError || new Error('Unknown error during database operation');
    }

    /**
     * 연결 관련 오류인지 판단하는 헬퍼 메서드
     */
    private isConnectionError(error: any): boolean {
        if (!error) return false;
        
        const errorMessage = error.message?.toLowerCase() || '';
        const errorCode = error.code || '';
        
        // Prisma/PostgreSQL 연결 오류 패턴
        return (
            errorMessage.includes('connection') ||
            errorMessage.includes('timeout') ||
            errorMessage.includes('econnrefused') ||
            errorMessage.includes('enotfound') ||
            errorMessage.includes('server closed the connection') ||
            errorCode === 'P1001' || // Connection error
            errorCode === 'P1008' || // Operation timeout
            errorCode === 'P1017'    // Server has closed the connection
        );
    }


    /**
     * 타입 안전성을 위한 분산 트랜잭션 작업 생성 헬퍼 메서드
     * database 값에 따라 operation 매개변수 타입이 자동으로 추론됩니다.
     * 
     * @template TDatabase 데이터베이스 타입
     * @param database 데이터베이스 이름
     * @param operation 실행할 작업 함수
     * @param rollbackOperation 보상 트랜잭션 함수 (선택적)
     * @param options 추가 옵션들
     * @returns 타입 안전한 분산 트랜잭션 작업 객체
     */

    public $createDistributedOperation<TDatabase extends DatabaseNamesUnion>(
        database: TDatabase,
        operation: (prisma: DatabaseClientMap[TDatabase]) => Promise<any>,
        options?: {
            timeout?: number;
            rollbackOperation?: (prisma: DatabaseClientMap[TDatabase]) => Promise<void>;
            priority?: number;
        }
    ): DistributedTransactionOperation<TDatabase> {
        return {
            database,
            operation,
            timeout: options?.timeout,
            rollbackOperation: options?.rollbackOperation,
            priority: options?.priority
        };
    }


    /**
     * 고급 트랜잭션 처리 메서드
     * 자동 재시도, 성능 모니터링, 에러 핸들링 통합
     */
    public async $transaction<R>(
        callback: (prisma: DatabaseClientMap[T]) => Promise<R>,
        options?: {
            isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
            maxWait?: number;
            timeout?: number;
            retryAttempts?: number;
            retryDelay?: number;
            enableLogging?: boolean;
        }
    ): Promise<R> {
        const config = {
            isolationLevel: options?.isolationLevel || 'Serializable',
            maxWait: options?.maxWait || 5000,
            timeout: options?.timeout || 30000,
            retryAttempts: options?.retryAttempts || 1,
            retryDelay: options?.retryDelay || 1000,
            enableLogging: options?.enableLogging ?? true
        };

        const txId = this.generateTransactionId();
        const startTime = process.hrtime.bigint();

        if (config.enableLogging) {
            log.Debug(`Transaction ${txId} started`, { database: this.repositoryDatabaseName });
        }

        for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
            try {
                const client = this.client as any;
                const result = await client.$transaction(
                    async (prisma: DatabaseClientMap[T]) => callback(prisma),
                    {
                        isolationLevel: config.isolationLevel,
                        maxWait: config.maxWait,
                        timeout: config.timeout
                    }
                );

                if (config.enableLogging) {
                    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
                    log.Info(`Transaction ${txId} completed`, {
                        duration: `${duration.toFixed(2)}ms`,
                        attempts: attempt
                    });
                }
                return result;

            } catch (error) {
                const isLastAttempt = attempt >= config.retryAttempts;
                const isRetryable = this.isRetryableError(error);

                if (!isRetryable || isLastAttempt) {
                    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
                    log.Error(`Transaction ${txId} failed`, {
                        duration: `${duration.toFixed(2)}ms`,
                        attempts: attempt,
                        error: error instanceof Error ? error.message : String(error)
                    });
                    throw this.enhanceError(error, txId, attempt);
                }

                if (config.enableLogging) {
                    log.Warn(`Transaction ${txId} retry ${attempt}`, {
                        error: this.getErrorType(error)
                    });
                }
                await this.sleep(config.retryDelay * attempt);
            }
        }

        throw new Error(`Transaction ${txId} failed after ${config.retryAttempts} attempts`);
    }



    /**
     * 배치 작업 처리 - 대량 데이터 작업 최적화
     */
    public async $batchOperation<R>(
        operations: Array<(prisma: DatabaseClientMap[T]) => Promise<R>>,
        batchSize: number = 100
    ): Promise<R[]> {
        const results: R[] = [];

        for (let i = 0; i < operations.length; i += batchSize) {
            const batch = operations.slice(i, i + batchSize);
            const batchResults = await this.$transaction(async (prisma) => {
                return Promise.all(batch.map(op => op(prisma)));
            });
            results.push(...batchResults);
        }

        return results;
    }

    /**
     * 비동기 sleep 함수
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    /**
     * 에러 정보 강화
     */
    private enhanceError(error: unknown, transactionId: string, attempts: number): Error {
        const baseMessage = `Transaction ${transactionId} failed after ${attempts} attempts`;

        if (!(error instanceof Error)) {
            return new Error(`${baseMessage}: ${String(error)}`);
        }

        const enhanced = new Error(`${baseMessage}: ${error.message}`);
        enhanced.stack = error.stack;
        enhanced.name = `TransactionError_${this.getErrorType(error)}`;
        return enhanced;
    }


    /**
     * 트랜잭션 ID 생성
     */
    private generateTransactionId(): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `tx_${this.repositoryDatabaseName}_${timestamp}_${random}`;
    }

    /**
     * 재시도 가능한 에러인지 확인
     */
    private isRetryableError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        const message = error.message.toLowerCase();
        return ['deadlock', 'lock timeout', 'connection', 'timeout', 'serialization failure', 'transaction was aborted']
            .some(pattern => message.includes(pattern));
    }

    /**
     * 에러 타입 분류
     */
    private getErrorType(error: unknown): string {
        if (!(error instanceof Error)) return 'unknown';
        const message = error.message.toLowerCase();

        const errorMap = {
            deadlock: 'deadlock',
            timeout: 'timeout',
            connection: 'connection',
            constraint: 'constraint_violation',
            serialization: 'serialization_failure',
            syntax: 'syntax_error'
        };

        return Object.keys(errorMap).find(key => message.includes(key))
            ? errorMap[Object.keys(errorMap).find(key => message.includes(key)) as keyof typeof errorMap]
            : 'database_error';
    }
    /**
     * Saga Pattern 분산 트랜잭션 실행 (내부 메서드)
     * 여러 데이터베이스에 걸친 분산 트랜잭션을 Saga Pattern + 보상 트랜잭션으로 처리
     * 
     * @param operations 각 데이터베이스별 실행할 작업들
     * @param options Saga 실행 옵션
     * @returns 분산 트랜잭션 실행 결과
     */    private async distributedTransaction<TResult = any>(
        operations: readonly DistributedTransactionOperation<any>[],
        options: TransactionCommitOptions = {}
    ): Promise<TransactionCommitResult<TResult>> {
        const participants: Omit<TransactionParticipant, 'state'>[] = operations.map(op => ({
            database: op.database,
            operation: op.operation,
            timeout: op.timeout,
            rollbackOperation: op.rollbackOperation,
            priority: op.priority,
            requiredLocks: op.requiredLocks
        }));        return await this.twoPhaseCommitManager.executeDistributedTransaction<TResult>(
            participants,
            {
                enableLogging: true,
                enableCompensation: true, // 보상 트랜잭션 활성화
                ...options
            }
        );
    }



    /**
     * 분산 트랜잭션 상태 검증
     * 실제 실행 전에 커밋 가능성을 미리 검사
     * 
     * @param operations 검증할 작업들
     * @returns 커밋 가능성과 이유
     */
    private async validateDistributedTransaction(
        operations: readonly DistributedTransactionOperation<any>[]
    ): Promise<{
        canProceed: boolean;
        issues: string[];
        databaseStates: { database: string; connected: boolean; healthy: boolean }[];
    }> {
        const issues: string[] = [];
        const databaseStates: { database: string; connected: boolean; healthy: boolean }[] = [];

        // 1. 데이터베이스 연결 상태 확인
        for (const operation of operations) {
            const connected = this.db.isConnected(operation.database);
            let healthy = false;

            if (connected) {
                try {
                    const healthCheck = await this.db.healthCheck();
                    const dbHealth = healthCheck.databases.find(db => db.name === operation.database);
                    healthy = dbHealth?.status === 'healthy';
                } catch (error) {
                    healthy = false;
                }
            }

            databaseStates.push({
                database: operation.database,
                connected,
                healthy
            });

            if (!connected) {
                issues.push(`Database ${operation.database} is not connected`);
            }
            if (!healthy) {
                issues.push(`Database ${operation.database} is not healthy`);
            }
        }

        // 2. 중복 데이터베이스 확인
        const databaseNames = operations.map(op => op.database);
        const duplicates = databaseNames.filter((name, index) => databaseNames.indexOf(name) !== index);
        if (duplicates.length > 0) {
            issues.push(`Duplicate databases detected: ${[...new Set(duplicates)].join(', ')}`);
        }

        // 3. 최소 참여자 수 확인
        if (operations.length < 2) {
            issues.push('Distributed transaction requires at least 2 participants');
        }

        return {
            canProceed: issues.length === 0,
            issues,
            databaseStates
        };
    }

    /**
     * 트랜잭션 복구 기능
     * 실패한 Saga 트랜잭션의 상태를 분석하고 복구 방안 제시
     */
    private analyzeTransactionFailure(result: TransactionCommitResult): {
        canRecover: boolean;
        recoveryStrategy: 'retry' | 'manual-intervention' | 'compensating-transaction';
        analysis: string;
        recommendations: string[];
    } {
        const recommendations: string[] = [];
        let canRecover = false;
        let recoveryStrategy: 'retry' | 'manual-intervention' | 'compensating-transaction' = 'manual-intervention';
        let analysis = '';

        // 실패 원인 분석
        const failedParticipants = result.participants.filter(p =>
            p.state === TransactionState.FAILED || p.state === TransactionState.TIMEOUT
        );

        const preparedParticipants = result.participants.filter(p =>
            p.state === TransactionState.PREPARED
        );

        const committedParticipants = result.participants.filter(p =>
            p.state === TransactionState.COMMITTED
        );

        if (failedParticipants.length === 0) {
            analysis = 'Transaction completed successfully';
            canRecover = true;
            recoveryStrategy = 'retry';
        } else if (preparedParticipants.length === result.participants.length) {
            analysis = 'All participants prepared but commit phase failed';
            canRecover = true;
            recoveryStrategy = 'retry';
            recommendations.push('Retry commit phase only');
        } else if (committedParticipants.length > 0 && failedParticipants.length > 0) {
            analysis = 'Partial commit detected - data inconsistency possible';
            canRecover = true;
            recoveryStrategy = 'compensating-transaction';
            recommendations.push('Execute compensating transactions for committed participants');
            recommendations.push('Check data consistency across all databases');
        } else {
            analysis = 'Prepare phase failed - no data corruption';
            canRecover = true;
            recoveryStrategy = 'retry';
            recommendations.push('Fix underlying issues and retry');
        }

        // 구체적인 에러 분석
        for (const participant of failedParticipants) {
            if (participant.error) {
                const errorMessage = participant.error.message.toLowerCase();

                if (errorMessage.includes('timeout')) {
                    recommendations.push(`Increase timeout for database ${participant.database}`);
                } else if (errorMessage.includes('deadlock')) {
                    recommendations.push(`Check for deadlock issues in database ${participant.database}`);
                } else if (errorMessage.includes('connection')) {
                    recommendations.push(`Check database connection for ${participant.database}`);
                } else if (errorMessage.includes('constraint')) {
                    recommendations.push(`Check data constraints in database ${participant.database}`);
                }
            }
        }

        return {
            canRecover,
            recoveryStrategy,
            analysis,
            recommendations: [...new Set(recommendations)] // 중복 제거
        };
    }

    
    /**
     * Saga Pattern 분산 트랜잭션 실행 (메인 메서드)
     * 사전 검증, Saga 실행, 실패 분석을 모두 포함한 완전한 분산 트랜잭션 메서드
     * 
     * @param operations 실행할 작업들 (createDistributedOperation 를 사용하여 생성하여야 타입 추론이 완전함)
     * @param options Saga 실행 옵션
     * @returns 분산 트랜잭션 실행 결과
     */
    public async $runDistributedTransaction<TResult = any>(
        operations: readonly (DistributedTransactionOperation<any> | {
            database: DatabaseNamesUnion;
            operation: (prisma: any) => Promise<any>;
            timeout?: number;
        })[],        options: {
            prepareTimeout?: number;
            commitTimeout?: number;
            enableLogging?: boolean;
            isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
            skipValidation?: boolean; // 검증 단계를 건너뛸지 여부
        } = {}): Promise<{
        success: boolean;
        result?: TransactionCommitResult<TResult>;
        validationIssues?: string[];
        error?: Error;
        recommendations?: string[];
    }> {
        try {
            // 1. 사전 검증 (옵션으로 건너뛸 수 있음)
            if (!options.skipValidation) {
                const validation = await this.validateDistributedTransaction(operations);

                if (!validation.canProceed) {
                    const recommendations = this.getRecommendationsFromValidation(validation);

                    if (options.enableLogging !== false) {
                        log.Warn('Distributed transaction validation failed', {
                            issues: validation.issues,
                            databaseStates: validation.databaseStates,
                            recommendations
                        });
                    }

                    return {
                        success: false,
                        validationIssues: validation.issues,
                        recommendations
                    };
                }
            }

            // 2. 분산 트랜잭션 실행
            const result = await this.distributedTransaction<TResult>(operations, {
                enableLogging: true,
                ...options
            });

            // 3. 결과 분석 및 권장사항 제공
            if (!result.success) {
                const analysis = this.analyzeTransactionFailure(result);

                if (options.enableLogging !== false) {
                    log.Error('Distributed transaction failed', {
                        globalTransactionId: result.globalTransactionId,
                        analysis,
                        participantStates: result.participants.map(p => ({
                            database: p.database,
                            state: p.state,
                            error: p.error?.message
                        }))
                    });
                }

                return {
                    success: false,
                    result,
                    recommendations: analysis.recommendations
                };
            }

            // 4. 성공 시 결과 반환
            if (options.enableLogging !== false) {
                log.Info('Distributed transaction completed successfully', {
                    globalTransactionId: result.globalTransactionId,
                    participantCount: result.participants.length,
                    totalDuration: `${result.totalDuration}ms`
                });
            }

            return {
                success: true,
                result
            };

        } catch (error) {
            const errorObj = error instanceof Error ? error : new Error(String(error));

            if (options.enableLogging !== false) {
                log.Error('Unexpected error in distributed transaction', {
                    error: errorObj.message,
                    operationCount: operations.length,
                    databases: operations.map(op => op.database)
                });
            }

            return {
                success: false,
                error: errorObj,
                recommendations: ['Check logs for detailed error information', 'Verify database connections', 'Review operation logic']
            };
        }
    }

    /**
     * 검증 결과에서 권장사항 추출
     */
    private getRecommendationsFromValidation(validation: {
        issues: string[];
        databaseStates: { database: string; connected: boolean; healthy: boolean }[];
    }): string[] {
        const recommendations: string[] = [];

        for (const state of validation.databaseStates) {
            if (!state.connected) {
                recommendations.push(`Reconnect to database ${state.database}`);
            }
            if (!state.healthy) {
                recommendations.push(`Check health of database ${state.database}`);
            }
        }

        // 일반적인 문제에 대한 권장사항
        if (validation.issues.some(issue => issue.includes('not connected'))) {
            recommendations.push('Verify database connection strings and network connectivity');
        }

        if (validation.issues.some(issue => issue.includes('not healthy'))) {
            recommendations.push('Check database server status and resource availability');
        }

        if (validation.issues.some(issue => issue.includes('Duplicate databases'))) {
            recommendations.push('Remove duplicate database operations or combine them into single operations');
        }

        if (validation.issues.some(issue => issue.includes('at least 2 participants'))) {
            recommendations.push('Add more operations or use single database transaction instead');
        } return [...new Set(recommendations)]; // 중복 제거
    }
}
