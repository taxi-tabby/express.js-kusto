import { DatabaseClientMap, DatabaseNamesUnion } from './types/generated-db-types';
import { PrismaManager } from './prismaManager';
import { log } from '../external/winston';

/**
 * 트랜잭션 참여자의 상태
 */
export enum TransactionState {
    INITIAL = 'INITIAL',
    PREPARING = 'PREPARING',
    PREPARED = 'PREPARED',
    COMMITTING = 'COMMITTING',
    COMMITTED = 'COMMITTED',
    ABORTING = 'ABORTING',
    ABORTED = 'ABORTED',
    FAILED = 'FAILED',
    TIMEOUT = 'TIMEOUT'
}

/**
 * 트랜잭션 참여자 정보
 */
export interface TransactionParticipant<T extends DatabaseNamesUnion = DatabaseNamesUnion> {
    database: T;
    operation: (prisma: DatabaseClientMap[T]) => Promise<any>;
    state: TransactionState;
    transactionId?: string; // 실제 데이터베이스 트랜잭션 ID
    preparedAt?: Date;
    committedAt?: Date;
    error?: Error;
    timeout?: number; // 개별 타임아웃 설정 가능
    result?: any; // Prepare 단계에서 실행된 결과
    requiredLocks?: string[]; // 특정 리소스에 대한 락 요구사항
    rollbackOperation?: (prisma: DatabaseClientMap[T]) => Promise<void>; // 보상 트랜잭션
    priority?: number; // 커밋 우선순위 (높을수록 먼저 커밋)
    validatedResult?: any; // 검증된 결과 캐시
}

/**
 * 트랜잭션 커밋 설정 옵션
 */
export interface TransactionCommitOptions {
    prepareTimeout?: number; // Prepare 단계 타임아웃 (ms)
    commitTimeout?: number; // Commit 단계 타임아웃 (ms)
    enableLogging?: boolean; // 로깅 활성화 여부
    isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
    enableCompensation?: boolean; // 보상 트랜잭션 활성화
}

/**
 * 트랜잭션 커밋 결과
 */
export interface TransactionCommitResult<T = any> {
    success: boolean;
    globalTransactionId: string;
    results: T[];
    participants: TransactionParticipant[];
    phase1Duration: number;
    phase2Duration: number;
    totalDuration: number;
    error?: Error;
    compensationResults?: any[]; // 보상 트랜잭션 결과
    partialSuccess?: boolean; // 부분 성공 여부
}

/**
 * 분산 트랜잭션 매니저 (Saga Pattern + Compensating Transactions)
 *  * ⚠️ PRISMA 제약사항으로 인한 한계:
 * - 커넥션 풀링으로 인한 수동 트랜잭션 제어 불가능
 *   (BEGIN/COMMIT이 서로 다른 커넥션에서 실행될 수 있음)
 * - client.$executeRaw`BEGIN` 후 client.$executeRaw`COMMIT` 불가능
 * - Interactive Transaction($transaction)만이 단일 커넥션 보장
 * - 진정한 2PC Phase 1 구현 불가능 (트랜잭션 유지 불가)
 * - 완전한 원자성(Atomicity) 및 격리성(Isolation) 보장 불가
 * 
 * 현재 구현 패턴:
 * 1. Phase 1: 작업 검증 및 시뮬레이션 (Validation Phase)
 *    - 실제 2PC Prepare 대신 트랜잭션 시뮬레이션 후 롤백
 * 2. Phase 2: 순차적 커밋 실행 (Sequential Commit Phase)
 *    - 개별 트랜잭션으로 순차 커밋 (부분 실패 가능)
 * 3. Compensation Phase: 실패 시 보상 트랜잭션 실행
 *    - 이미 커밋된 데이터를 보상 로직으로 되돌림
 * 
 * 📋 ACID 속성 지원 현황:
 * ✅ Consistency: 최종 일관성(Eventual Consistency) 보장
 * ✅ Durability: 개별 DB 레벨에서 완전 보장
 * ⚠️ Atomicity: 순차 커밋으로 인한 일시적 불일치 발생 가능
 * ❌ Isolation: 중간 상태가 다른 트랜잭션에 노출될 수 있음
 * 
 */
export class TransactionCommitManager {
    private prismaManager: PrismaManager;
    private globalTransactionCounter: number = 0;

    constructor(prismaManager: PrismaManager) {
        this.prismaManager = prismaManager;
    }


    /**
     * 분산 트랜잭션 실행 (Saga Pattern + Compensating Transactions)
     * 
     * 실행 단계:
     * 1. Validation Phase: 모든 작업의 실행 가능성 검증
     * 2. Sequential Commit Phase: 우선순위 순으로 순차 커밋
     * 3. Compensation Phase: 실패 시 보상 트랜잭션 실행
     * 
     * @param participants 참여자 목록
     * @param options 실행 옵션
     */    
    async executeDistributedTransaction<T = any>(
        participants: Omit<TransactionParticipant, 'state'>[],
        options: TransactionCommitOptions = {}
    ): Promise<TransactionCommitResult<T>> {        const config = {
            prepareTimeout: options.prepareTimeout || 10000,
            commitTimeout: options.commitTimeout || 15000,
            enableLogging: options.enableLogging ?? true,
            isolationLevel: options.isolationLevel || 'Serializable',
            enableCompensation: options.enableCompensation ?? true
        };

        const globalTransactionId = this.generateGlobalTransactionId();
        const startTime = Date.now();
        let phase1Duration = 0;
        let phase2Duration = 0;

        // 참여자 초기화
        const transactionParticipants: TransactionParticipant[] = participants.map(p => ({
            ...p,
            state: TransactionState.INITIAL
        })); if (config.enableLogging) {
            log.Info(`Starting Saga transaction ${globalTransactionId}`, {
                participantCount: transactionParticipants.length,
                databases: transactionParticipants.map(p => p.database),
                pattern: 'Saga + Compensating Transactions'
            });
        }

        try {            // Phase 1: Validation (작업 검증 단계)
            const phase1Start = Date.now();
            const prepareResult = await this.preparePhase(transactionParticipants, config, globalTransactionId);
            phase1Duration = Date.now() - phase1Start;

            if (!prepareResult.success) {
                // 검증 실패 시 중단 (아직 커밋된 것이 없으므로 보상 불필요)
                return {
                    success: false,
                    globalTransactionId,
                    results: [],
                    participants: transactionParticipants,
                    phase1Duration,
                    phase2Duration: 0,
                    totalDuration: Date.now() - startTime,
                    error: prepareResult.error,
                    partialSuccess: false
                };
            }

            // Phase 2: Sequential Commit (순차 커밋 단계)
            const phase2Start = Date.now();
            const commitResult = await this.commitPhase(transactionParticipants, config, globalTransactionId);
            phase2Duration = Date.now() - phase2Start;

            const totalDuration = Date.now() - startTime;
            // 커밋 실패 시 보상 트랜잭션 처리 (Saga Pattern)
            if (!commitResult.success && config.enableCompensation) {
                const compensationResults = await this.executeCompensation(
                    transactionParticipants,
                    config,
                    globalTransactionId
                );

                if (config.enableLogging) {
                    log.Warn(`Saga transaction ${globalTransactionId} failed, compensation executed`, {
                        compensationResults,
                        partialSuccess: commitResult.partialSuccess,
                        pattern: 'Compensating Transaction Pattern'
                    });
                }

                return {
                    success: false,
                    globalTransactionId,
                    results: commitResult.results,
                    participants: transactionParticipants,
                    phase1Duration,
                    phase2Duration,
                    totalDuration,
                    error: commitResult.error,
                    compensationResults,
                    partialSuccess: commitResult.partialSuccess
                };
            }

            if (config.enableLogging) {
                log.Info(`Saga transaction ${globalTransactionId} completed successfully`, {
                    success: commitResult.success,
                    phase1Duration: `${phase1Duration}ms`,
                    phase2Duration: `${phase2Duration}ms`,
                    totalDuration: `${totalDuration}ms`,
                    pattern: 'Saga + Compensating Transactions'
                });
            } return {
                success: commitResult.success,
                globalTransactionId,
                results: commitResult.results,
                participants: transactionParticipants,
                phase1Duration,
                phase2Duration,
                totalDuration,
                error: commitResult.error,
                partialSuccess: commitResult.partialSuccess
            };
        } catch (error) {
            // 예상치 못한 에러 발생 시 롤백
            await this.abortPhase(transactionParticipants, config, globalTransactionId);

            const totalDuration = Date.now() - startTime;

            return {
                success: false,
                globalTransactionId,
                results: [],
                participants: transactionParticipants,
                phase1Duration,
                phase2Duration,
                totalDuration,
                error: error instanceof Error ? error : new Error(String(error)),
                partialSuccess: false
            };
        }
    }



    /**
     * Phase 1: Validation - 모든 참여자의 작업 실행 가능성 검증
     * 실제 데이터 변경 없이 시뮬레이션을 통해 검증만 수행
     */    
    
    private async preparePhase(
        participants: TransactionParticipant[],
        config: TransactionCommitOptions,
        globalTxId: string
    ): Promise<{ success: boolean; error?: Error }> {
        const preparePromises = participants.map(participant =>
            this.prepareParticipant(participant, config, globalTxId)
        );

        try {
            // 모든 참여자의 Prepare 단계 실행 (타임아웃 적용)
            await Promise.race([
                Promise.all(preparePromises),
                this.createTimeoutPromise(config.prepareTimeout!, 'Prepare phase timeout')
            ]);

            // 모든 참여자가 PREPARED 상태인지 확인
            const allPrepared = participants.every(p => p.state === TransactionState.PREPARED);

            if (!allPrepared) {
                const failedParticipants = participants.filter(p => p.state !== TransactionState.PREPARED);
                const error = new Error(`Prepare phase failed for databases: ${failedParticipants.map(p => p.database).join(', ')}`);

                if (config.enableLogging) {
                    log.Error(`2PC ${globalTxId} prepare phase failed`, {
                        failedDatabases: failedParticipants.map(p => ({
                            database: p.database,
                            state: p.state,
                            error: p.error?.message
                        }))
                    });
                }

                return { success: false, error };
            } if (config.enableLogging) {
                log.Info(`Saga ${globalTxId} validation phase completed successfully`, {
                    participantStates: participants.map(p => ({ database: p.database, state: p.state })),
                    pattern: 'Validation Phase'
                });
            }

            return { success: true };

        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error))
            };
        }
    }

    /**
     * 개별 참여자의 Validation 단계 실행 (시뮬레이션 방식)
     * Interactive Transaction을 사용하여 작업을 검증하고 롤백
     */    private async prepareParticipant(
        participant: TransactionParticipant,
        config: TransactionCommitOptions,
        globalTxId: string
    ): Promise<void> {
        try {
            participant.state = TransactionState.PREPARING;

            // 데이터베이스 연결 상태 확인
            if (!this.prismaManager.isConnected(participant.database)) {
                throw new Error(`Database ${participant.database} is not connected`);
            }

            // 데이터베이스 건강성 확인
            const healthCheck = await this.prismaManager.healthCheck();
            const dbHealth = healthCheck.databases.find(db => db.name === participant.database);

            if (dbHealth?.status !== 'healthy') {
                throw new Error(`Database ${participant.database} is not healthy: ${dbHealth?.error || 'Unknown issue'}`);
            }

            const client = this.prismaManager.getClientSync(participant.database);

            // 안전한 트랜잭션 제어 구현
            const transactionId = this.generateTransactionId(participant.database);
            participant.transactionId = transactionId;

            // Interactive Transaction을 사용하여 안전하게 실행
            await this.startManagedTransaction(
                client,
                participant,
                config,
                transactionId
            );

            participant.state = TransactionState.PREPARED;
            participant.preparedAt = new Date();

            if (config.enableLogging) {
                log.Debug(`Saga ${globalTxId} participant ${participant.database} validation completed with simulation ${transactionId}`);
            }

        } catch (error) {
            participant.state = TransactionState.FAILED;
            participant.error = error instanceof Error ? error : new Error(String(error));

            if (config.enableLogging) {
                log.Error(`Safe 2PC ${globalTxId} participant ${participant.database} prepare failed`, {
                    error: participant.error.message
                });
            }
        }
    }    
    
    
    /**
     * 진정한 2PC Phase 1: Prepare 트랜잭션 시작 및 검증
     *     * ⚠️ PRISMA 제약사항:
     * - 커넥션 풀링으로 인한 수동 트랜잭션 제어 불가능
     *   각 쿼리가 다른 커넥션에서 실행될 수 있어 BEGIN/COMMIT 분리 불가
     * - client.$executeRaw`BEGIN` → 커넥션1
     *   client.$executeRaw`UPDATE` → 커넥션2 (다른 커넥션!)
     *   client.$executeRaw`COMMIT` → 커넥션3 (또 다른 커넥션!)
     * - Interactive Transaction($transaction)만이 단일 커넥션 보장
     * - 따라서 시뮬레이션 방식으로 검증 후 강제 롤백
     * 
     * 이상적인 2PC Phase 1 (현재 불가능):
     * 1. BEGIN TRANSACTION
     * 2. 작업 수행 및 검증
     * 3. 트랜잭션 유지 (PREPARED 상태)
     * 4. 글로벌 코디네이터 지시 대기
     * 5. COMMIT 또는 ROLLBACK
     * 
     * 현재 구현 (타협점):
     * 1. 트랜잭션 시작 → 작업 수행 → 강제 롤백 (검증 목적)
     * 2. 검증 성공 시 Phase 2에서 실제 커밋 수행
     */private async startManagedTransaction(
        client: any,
        participant: TransactionParticipant,
        config: TransactionCommitOptions,
        transactionId: string
    ): Promise<void> {
        const timeout = participant.timeout || config.prepareTimeout || 10000;

        try {
            // Phase 1: 작업 검증 및 준비
            // 실제로는 트랜잭션을 시작하고 검증만 하고 롤백해야 하지만,
            // Prisma의 제약으로 인해 시뮬레이션 방식 사용

            // 1. 데이터베이스 연결 및 리소스 확인
            const healthCheck = await this.checkDatabaseResources(client, participant);
            if (!healthCheck.healthy) {
                throw new Error(`Database resources not available: ${healthCheck.issue}`);
            }

            // 2. 작업 시뮬레이션 (실제 데이터 변경 없이 검증)
            const simulationResult = await this.simulateOperation(client, participant, config, timeout);

            // 3. 결과 저장 (Prepare 단계 완료)
            participant.result = simulationResult;
            participant.validatedResult = simulationResult;

            if (config.enableLogging) {
                log.Debug(`2PC Phase 1 (Prepare) completed for ${participant.database} with transaction ${transactionId}`);
            }

        } catch (error) {
            throw new Error(`2PC Prepare failed for ${participant.database}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }




    /**
     * 데이터베이스 리소스 확인
     */
    private async checkDatabaseResources(client: any, participant: TransactionParticipant): Promise<{
        healthy: boolean;
        issue?: string;
    }> {
        try {
            // 기본 연결 테스트
            await client.$queryRaw`SELECT 1`;

            // 필요한 락 확인 (선택적)
            if (participant.requiredLocks && participant.requiredLocks.length > 0) {
                // 리소스 락 확인 로직 (데이터베이스별로 구현 필요)
                const lockStatus = await this.checkResourceLocks(client, participant.requiredLocks);
                if (!lockStatus.available) {
                    return { healthy: false, issue: `Required locks not available: ${lockStatus.blockedLocks.join(', ')}` };
                }
            }

            return { healthy: true };
        } catch (error) {
            return { healthy: false, issue: error instanceof Error ? error.message : String(error) };
        }
    }    
    



    
    /**
     * 리소스 락 상태 확인
     * PrismaManager에서 provider 정보를 가져와서 동적으로 락 확인 방법 결정
     */
    private async checkResourceLocks(client: any, requiredLocks: string[]): Promise<{
        available: boolean;
        blockedLocks: string[];
    }> {
        const blockedLocks: string[] = [];

        try {
            // 클라이언트에서 데이터베이스 이름 추출 시도
            const dbName = this.getDatabaseNameFromClient(client);
            
            // PrismaManager에서 provider 정보 가져오기
            let provider = 'postgresql'; // 기본값
            
            if (dbName && this.prismaManager) {
                try {
                    provider = this.prismaManager.getProviderForDatabase(dbName);
                } catch (error) {
                    log.Warn(`Could not get provider for ${dbName}, using default PostgreSQL`);
                }
            }
            
            // provider별 락 확인 로직 분기
            for (const lockName of requiredLocks) {
                const isBlocked = await this.checkLockByProvider(client, lockName, provider);
                if (isBlocked) {
                    blockedLocks.push(lockName);
                }
            }
        } catch (error) {
            // 락 확인 실패 시 모든 락이 차단된 것으로 간주 (안전한 방향)
            log.Error('Lock check failed:', error);
            blockedLocks.push(...requiredLocks);
        }

        return {
            available: blockedLocks.length === 0,
            blockedLocks
        };
    }    
    
    
    
    
    /**
     * 클라이언트에서 데이터베이스 이름 추출 시도
     */
    private getDatabaseNameFromClient(client: any): string | null {
        try {
            // 클라이언트에 데이터베이스 이름이 설정되어 있는지 확인
            if (client.__databaseName) {
                return client.__databaseName;
            }
            
            // PrismaManager의 모든 연결된 데이터베이스에서 클라이언트 매칭 시도
            const availableDbs = this.prismaManager.getAvailableDatabases();
            for (const dbName of availableDbs) {
                const dbClient = this.prismaManager.getClientSync(dbName);
                if (dbClient === client) {
                    return dbName;
                }
            }
            
            return null;
        } catch (error) {
            log.Warn('Could not determine database name from client:', error);
            return null;
        }
    }





    /**
     * Provider별 락 확인 로직
     */
    private async checkLockByProvider(client: any, lockName: string, provider: string): Promise<boolean> {
        switch (provider.toLowerCase()) {
            case 'postgresql':
                return this.checkPostgreSQLLock(client, lockName);
            case 'mysql':
                return this.checkMySQLLock(client, lockName);
            case 'sqlite':
                return this.checkSQLiteLock(client, lockName);
            default:
                log.Warn(`Unsupported database provider: ${provider}, falling back to PostgreSQL`);
                return this.checkPostgreSQLLock(client, lockName);
        }
    }






    /**
     * PostgreSQL 개별 락 상태 확인
     * @param client Prisma 클라이언트
     * @param lockName 확인할 락 이름 (테이블명, 레코드ID 등)
     */
    private async checkPostgreSQLLock(client: any, lockName: string): Promise<boolean> {
        try {

            // PostgreSQL의 pg_locks 시스템 뷰를 사용하여 락 상태 확인
            // lockName 형식: "table:table_name" 또는 "record:table_name:id"
            
            const lockParts = lockName.split(':');
            const lockType = lockParts[0]; // 'table' 또는 'record'
            const tableName = lockParts[1];
            const recordId = lockParts[2]; // record 타입인 경우에만

            if (lockType === 'table') {
                // 테이블 레벨 락 확인
                const result = await client.$queryRaw`
                    SELECT COUNT(*) as lock_count
                    FROM pg_locks pl
                    JOIN pg_class pc ON pl.relation = pc.oid
                    JOIN pg_namespace pn ON pc.relnamespace = pn.oid
                    WHERE pc.relname = ${tableName}
                      AND pl.mode IN ('AccessExclusiveLock', 'ExclusiveLock', 'ShareUpdateExclusiveLock')
                      AND pl.granted = true
                      AND pl.pid != pg_backend_pid()
                `;

                return Number(result[0]?.lock_count || 0) > 0;

            } else if (lockType === 'record' && recordId) {
                // 레코드 레벨 락 확인 (advisory lock 사용)
                const lockKey = this.generateAdvisoryLockKey(tableName, recordId);
                
                const result = await client.$queryRaw`
                    SELECT pg_try_advisory_lock(${lockKey}) as acquired
                `;

                const acquired = result[0]?.acquired;
                
                // 락을 획득했다면 즉시 해제 (테스트 목적이므로)
                if (acquired) {
                    await client.$queryRaw`
                        SELECT pg_advisory_unlock(${lockKey})
                    `;
                    return false; // 락이 사용 가능
                } else {
                    return true; // 락이 이미 사용 중
                }

            } else {
                console.warn(`Unsupported lock format: ${lockName}`);
                return false; // 형식이 잘못된 경우 사용 가능으로 간주
            }

        } catch (error) {
            console.error(`Failed to check PostgreSQL lock for ${lockName}:`, error);
            return true; // 에러 시 안전하게 차단된 것으로 간주
        }
    }






    /**
     * PostgreSQL Advisory Lock용 숫자 키 생성
     * 테이블명과 레코드ID를 조합하여 고유한 정수 키 생성
     */
    private generateAdvisoryLockKey(tableName: string, recordId: string): number {
        // 간단한 해시 함수로 문자열을 정수로 변환
        let hash = 0;
        const combined = `${tableName}:${recordId}`;
        
        for (let i = 0; i < combined.length; i++) {
            const char = combined.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 32비트 정수로 변환
        }
        
        // 양수로 변환 (PostgreSQL advisory lock은 양수 키를 선호)
        return Math.abs(hash);
    }






    /**
     * MySQL 개별 락 상태 확인 (참고용 - 현재 프로젝트에서 사용 안함)
     */
    private async checkMySQLLock(client: any, lockName: string): Promise<boolean> {
        try {
            const lockParts = lockName.split(':');
            const lockType = lockParts[0];
            const tableName = lockParts[1];

            if (lockType === 'table') {
                // MySQL 테이블 락 확인
                const result = await client.$queryRaw`
                    SELECT COUNT(*) as lock_count
                    FROM INFORMATION_SCHEMA.INNODB_LOCKS
                    WHERE lock_table LIKE CONCAT('%', ${tableName}, '%')
                `;

                return Number(result[0]?.lock_count || 0) > 0;

            } else if (lockType === 'record') {
                // MySQL Named Lock 사용
                const result = await client.$queryRaw`
                    SELECT IS_USED_LOCK(${lockName}) as is_used
                `;

                return result[0]?.is_used !== null;
            }

            return false;
        } catch (error) {
            console.error(`Failed to check MySQL lock for ${lockName}:`, error);
            return true;
        }
    }






    /**
     * SQLite 개별 락 상태 확인 (참고용 - 현재 프로젝트에서 사용 안함)
     */
    private async checkSQLiteLock(client: any, lockName: string): Promise<boolean> {
        try {
            // SQLite는 파일 레벨 락킹만 지원하므로 간단한 구현
            // 실제로는 WAL 모드에서의 동시성을 확인
            const result = await client.$queryRaw`
                PRAGMA busy_timeout = 1000;
                BEGIN IMMEDIATE;
                ROLLBACK;
            `;

            return false; // 성공하면 락 사용 가능
        } catch (error) {
            // BUSY 에러가 발생하면 락이 사용 중
            return error instanceof Error && error.message.includes('BUSY');
        }
    }






    /**
     * 작업 시뮬레이션 (실제 커밋 없이 검증)
     */    
    private async simulateOperation(
        client: any,
        participant: TransactionParticipant,
        config: TransactionCommitOptions,
        timeout: number
    ): Promise<any> {
        try {
            // 트랜잭션 시뮬레이션: 실행 후 롤백
            const result = await client.$transaction(
                async (tx: any) => {
                    // 실제 작업 수행
                    const operationResult = await participant.operation(tx);

                    // 결과 검증
                    if (operationResult === null || operationResult === undefined) {
                        throw new Error('Operation returned null/undefined result');
                    }

                    // 명시적으로 롤백을 위해 에러 발생
                    // (시뮬레이션이므로 실제 데이터 변경을 원하지 않음)
                    throw new Error('SIMULATION_ROLLBACK');
                },
                {
                    maxWait: timeout,
                    timeout: timeout,
                    isolationLevel: config.isolationLevel as any
                }
            );

            // 여기는 도달하지 않음 (위에서 롤백 에러 발생)
            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            // 시뮬레이션 롤백은 정상 상황
            if (errorMessage === 'SIMULATION_ROLLBACK') {
                // 시뮬레이션 성공 - 실제 Phase 2에서 실행할 수 있음을 의미
                return { simulationSuccess: true, validatedForCommit: true };
            }

            // 실제 에러인 경우
            throw error;
        }
    }    
    
    
    
    
    /**
     * Phase 2: Sequential Commit - 우선순위 순으로 순차적 커밋 수행
     * 실패 시 이미 커밋된 것들에 대해 보상 트랜잭션 필요
     */    
    
    private async commitPhase(
        participants: TransactionParticipant[],
        config: TransactionCommitOptions,
        globalTxId: string
    ): Promise<{ success: boolean; results: any[]; error?: Error; partialSuccess?: boolean }> {

        const results: any[] = [];

        try {
            // 우선순위 순으로 정렬 (높은 우선순위부터)
            const sortedParticipants = [...participants].sort((a, b) => (b.priority || 0) - (a.priority || 0));

            // 순차적 커밋 실행 (Saga Pattern)
            for (const participant of sortedParticipants) {
                try {
                    const result = await this.commitParticipant(participant, config, globalTxId);
                    results.push(result);
                } catch (error) {
                    // 하나라도 실패하면 즉시 중단하고 보상 실행 준비
                    const failedError = error instanceof Error ? error : new Error(String(error));

                    if (config.enableLogging) {
                        log.Error(`Saga ${globalTxId} sequential commit failed at ${participant.database}`, {
                            error: failedError.message,
                            completedCommits: results.length,
                            remainingParticipants: sortedParticipants.length - results.length - 1
                        });
                    }

                    // 부분 성공 상황 처리
                    const hasPartialSuccess = results.length > 0;

                    return {
                        success: false,
                        results: results,
                        error: failedError,
                        partialSuccess: hasPartialSuccess
                    };
                }
            }

            // 모든 참여자가 COMMITTED 상태인지 확인
            const allCommitted = participants.every(p => p.state === TransactionState.COMMITTED);

            if (!allCommitted) {
                const failedParticipants = participants.filter(p => p.state !== TransactionState.COMMITTED);
                const committedParticipants = participants.filter(p => p.state === TransactionState.COMMITTED);

                const error = new Error(`Commit phase failed for databases: ${failedParticipants.map(p => p.database).join(', ')}`);

                if (config.enableLogging) {
                    log.Error(`2PC ${globalTxId} commit phase failed`, {
                        failedDatabases: failedParticipants.map(p => ({
                            database: p.database,
                            state: p.state,
                            error: p.error?.message
                        })),
                        committedDatabases: committedParticipants.map(p => p.database)
                    });
                }

                // 부분 실패 상황: 일부는 커밋되고 일부는 실패
                // 이미 커밋된 참여자가 있으면 부분 성공으로 처리
                const hasPartialSuccess = committedParticipants.length > 0;

                return {
                    success: false,
                    results: results,
                    error,
                    partialSuccess: hasPartialSuccess
                };
            }

            if (config.enableLogging) {
                log.Info(`Saga ${globalTxId} sequential commit phase completed successfully`, {
                    totalCommits: results.length,
                    pattern: 'Sequential Commit'
                });
            }

            return { success: true, results, partialSuccess: false };

        } catch (error) {
            return {
                success: false,
                results: [],
                error: error instanceof Error ? error : new Error(String(error)),
                partialSuccess: false
            };
        }
    }






    /**
      * 개별 참여자의 Sequential Commit 실행
      * 검증된 작업을 실제로 커밋 수행
      */    
     private async commitParticipant(
        participant: TransactionParticipant,
        config: TransactionCommitOptions,
        globalTxId: string
    ): Promise<any> {
        try {
            participant.state = TransactionState.COMMITTING;

            if (!participant.transactionId) {
                throw new Error(`No active transaction found for participant ${participant.database}`);
            }

            const client = this.prismaManager.getClientSync(participant.database);

            // 검증된 결과가 있으면 재사용, 없으면 다시 실행
            let finalResult;

            if (participant.validatedResult !== undefined) {
                // 이미 검증된 작업을 다시 실행 (최종 커밋)
                finalResult = await client.$transaction(
                    async (tx: any) => {
                        return await participant.operation(tx);
                    }, {
                    isolationLevel: config.isolationLevel as any,
                    maxWait: config.commitTimeout || 15000,
                    timeout: config.commitTimeout || 15000
                }
                );
            } else {
                // Prepare 단계에서 저장된 결과 사용
                finalResult = participant.result;
            }

            participant.state = TransactionState.COMMITTED;
            participant.committedAt = new Date(); if (config.enableLogging) {
                log.Debug(`Saga ${globalTxId} participant ${participant.database} commit completed for transaction ${participant.transactionId}`);
            }

            return finalResult;

        } catch (error) {
            participant.state = TransactionState.FAILED;
            participant.error = error instanceof Error ? error : new Error(String(error));

            if (config.enableLogging) {
                log.Error(`Safe 2PC ${globalTxId} participant ${participant.database} commit failed`, {
                    error: participant.error.message
                });
            }

            throw participant.error;
        }
    }

    /**
     * Abort 단계 - 검증 실패 시 정리 작업
     * Saga Pattern에서는 아직 커밋되지 않았으므로 상태 정리만 수행
     */    private async abortPhase(
        participants: TransactionParticipant[],
        config: TransactionCommitOptions,
        globalTxId: string
    ): Promise<void> {
        if (config.enableLogging) {
            log.Warn(`Saga ${globalTxId} aborting transaction (validation failed)`);
        }

        // 검증 단계에서 실패했으므로 실제 커밋된 데이터는 없음
        // 참여자 상태만 업데이트
        for (const participant of participants) {
            if (participant.state === TransactionState.PREPARED || participant.state === TransactionState.PREPARING) {
                participant.state = TransactionState.ABORTED;
                if (config.enableLogging) {
                    log.Debug(`Saga ${globalTxId} participant ${participant.database} validation aborted`);
                }
            }
        }
    }

    /**
     * 타임아웃 Promise 생성
     */
    private createTimeoutPromise<T>(timeoutMs: number, message: string): Promise<T> {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`${message} (${timeoutMs}ms)`));
            }, timeoutMs);
        });
    }


    /**
     * 글로벌 트랜잭션 ID 생성 (Saga Pattern용)
     */
    private generateGlobalTransactionId(): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `saga_${timestamp}_${random}`;
    }

    /**
     * 개별 트랜잭션 ID 생성
     */
    private generateTransactionId(database: string): string {
        const counter = ++this.globalTransactionCounter;
        const timestamp = Date.now().toString(36);
        return `tx_${database}_${timestamp}_${counter}`;
    }




    

    /**
     * 보상 트랜잭션 실행 (Compensating Transaction Pattern)
     * 이미 커밋된 작업들을 되돌리기 위한 보상 작업 수행
     * Saga Pattern의 핵심 요소로, 분산 트랜잭션의 일관성 보장
     */    
    private async executeCompensation(
        participants: TransactionParticipant[],
        config: TransactionCommitOptions,
        globalTxId: string
    ): Promise<any[]> {

        const compensationResults: any[] = [];
        const committedParticipants = participants.filter(p => p.state === TransactionState.COMMITTED);

        if (config.enableLogging && committedParticipants.length > 0) {
            log.Warn(`Saga ${globalTxId} executing compensating transactions for ${committedParticipants.length} committed operations`);
        }

        // 역순으로 보상 실행 (LIFO 방식 - Last In, First Out)
        // 커밋된 순서의 반대로 보상하여 의존성 문제 해결
        for (const participant of committedParticipants.reverse()) {
            if (participant.rollbackOperation) {
                try {
                    const client = this.prismaManager.getClientSync(participant.database);

                    const compensationResult = await client.$transaction(
                        async (tx: any) => {
                            return await participant.rollbackOperation!(tx);
                        },
                        {
                            isolationLevel: config.isolationLevel as any,
                            maxWait: config.commitTimeout || 15000,
                            timeout: config.commitTimeout || 15000
                        }
                    );

                    compensationResults.push({
                        database: participant.database,
                        result: compensationResult,
                        success: true,
                        type: 'compensation'
                    });

                    if (config.enableLogging) {
                        log.Debug(`Compensating transaction executed successfully for ${participant.database}`);
                    }

                } catch (compensationError) {

                    compensationResults.push({
                        database: participant.database,
                        error: compensationError instanceof Error ? compensationError.message : String(compensationError),
                        success: false,
                        type: 'compensation_failed'
                    });

                    if (config.enableLogging) {
                        log.Error(`Compensating transaction failed for ${participant.database}`, {
                            error: compensationError instanceof Error ? compensationError.message : String(compensationError),
                            warning: 'Manual intervention may be required'
                        });
                    }

                }
            } else {
                
                // 보상 트랜잭션이 정의되지 않은 경우 경고
                compensationResults.push({
                    database: participant.database,
                    warning: 'No rollback operation defined - manual intervention required',
                    success: false,
                    type: 'no_compensation'
                });

                if (config.enableLogging) {
                    log.Warn(`No compensating transaction defined for ${participant.database}`, {
                        warning: 'Manual data cleanup may be required'
                    });
                }
            }
        }

        return compensationResults;
    }
}
