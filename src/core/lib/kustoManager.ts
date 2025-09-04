import { DependencyInjector } from './dependencyInjector';
import { repositoryManager } from './repositoryManager';
import { prismaManager } from './prismaManager';
import { Injectable } from './types/generated-injectable-types';
import { RepositoryTypeMap, RepositoryName } from './types/generated-repository-types';
import { PrismaManagerClientOverloads, DatabaseNamesUnion, DatabaseClientType } from './types/generated-db-types';



/**
 * 데이터베이스 접근을 위한 프록시 인터페이스
 * PrismaManagerClientOverloads를 확장하여 동적으로 타입 안전한 오버로드 제공
 */
export interface KustoDbProxy {
    /** 비동기 클라이언트 가져오기 (재연결 로직 포함) */
    getClient<T extends DatabaseNamesUnion>(name: T): Promise<DatabaseClientType<T>>;
    getClient<T = any>(name: string): Promise<T>;
    
    /** 동기 클라이언트 가져오기 (재연결 로직 없음) */
    getClientSync<T extends DatabaseNamesUnion>(name: T): DatabaseClientType<T>;
    getClientSync<T = any>(name: string): T;

    /** 래핑된 클라이언트 가져오기 (동기, Repository에서 사용) */
    getWrap<T extends DatabaseNamesUnion>(name: T): DatabaseClientType<T>;
    getWrap<T = any>(name: string): T;

    /** 사용 가능한 데이터베이스 목록 */
    available: string[];

    /** 데이터베이스 상태 정보 */
    status(): {
        initialized: boolean;
        connectedDatabases: number;
        totalDatabases: number;
        databases: { name: string; connected: boolean; generated: boolean }[];
    };
    
    /** 데이터베이스 헬스체크 */
    healthCheck(): Promise<{
        overall: 'healthy' | 'degraded' | 'unhealthy';
        databases: Array<{
            name: string;
            status: 'healthy' | 'unhealthy' | 'not-connected';
            responseTime?: number;
            error?: string;
        }>;
    }>;

    /** 동적으로 데이터베이스 이름으로 접근 (예: db.user, db.admin) - 동기 버전 */
    [databaseName: string]: any;
}

/**
 * Kusto Manager - Express.js-Kusto 프레임워크의 중앙 관리자
 * 싱글톤으로 생성되며 모든 주요 서비스에 대한 접근을 제공합니다.
 */
export class KustoManager {
    private static instance: KustoManager;
    private dependencyInjector: DependencyInjector;

    private constructor() {
        this.dependencyInjector = DependencyInjector.getInstance();
    }

    public static getInstance(): KustoManager {
        if (!KustoManager.instance) {
            KustoManager.instance = new KustoManager();
        }
        return KustoManager.instance;
    }

    /**
     * 주입된 모듈들에 접근
     */
    public get injectable(): Injectable {
        return this.dependencyInjector.getInjectedModules();
    }    /**
     * 레포지토리들에 접근
     * 동적으로 모든 등록된 레포지토리에 접근할 수 있는 프록시 객체를 반환
     */
    public get repo(): RepositoryTypeMap {
        const loadedRepositories = repositoryManager.getLoadedRepositoryNames();
        
        // 동적으로 레포지토리 이름을 속성으로 접근할 수 있는 프록시 객체 생성
        const repoProxy = new Proxy({}, {
            get(target, prop) {
                if (typeof prop === 'string' && loadedRepositories.includes(prop)) {
                    return repositoryManager.getRepository(prop as RepositoryName);
                }
                return undefined;
            },
            
            has(target, prop) {
                return typeof prop === 'string' && loadedRepositories.includes(prop);
            },
            
            ownKeys(target) {
                return loadedRepositories;
            },
            
            getOwnPropertyDescriptor(target, prop) {
                if (typeof prop === 'string' && loadedRepositories.includes(prop)) {
                    return {
                        enumerable: true,
                        configurable: true,
                        get: () => repositoryManager.getRepository(prop as RepositoryName)
                    };
                }
                return undefined;
            }
        });
        
        return repoProxy as RepositoryTypeMap;
    }
    
    /**
     * 데이터베이스 클라이언트 접근 인터페이스
     * 사용법: kusto.db.getClient('admin') 또는 kusto.db.user (동적 접근)
     */
    public get db(): KustoDbProxy {
        const availableDbs = prismaManager.getAvailableDatabases();
        
        // 동적으로 데이터베이스 이름을 속성으로 접근할 수 있는 프록시 객체 생성
        const dbProxy = new Proxy({
            // 메서드로 클라이언트 가져오기 (async) - hint 추적 포함
            getClient: async (name: string) => {
                // prismaManager의 getClient 메서드가 자동으로 hint 추적을 수행함
                return await prismaManager.getClient(name);
            },
            
            // 동기 버전 (연결 상태 확인 없이) - hint 추적 포함
            getClientSync: (name: string) => {
                // prismaManager의 getClientSync 메서드가 자동으로 hint 추적을 수행함
                return prismaManager.getClientSync(name);
            },
            
            // 래핑된 클라이언트 가져오기 (Repository에서 사용)
            getWrap: (name: string) => prismaManager.getClientSync(name),
            
            // 사용 가능한 데이터베이스 목록
            available: availableDbs,
            
            // 상태 정보
            status: () => prismaManager.getStatus(),
            
            // 헬스체크
            healthCheck: () => prismaManager.healthCheck()
        }, {
            get(target, prop) {
                // 먼저 target의 기본 속성들 확인
                if (prop in target) {
                    return target[prop as keyof typeof target];
                }
                
                // 데이터베이스 이름으로 직접 접근하는 경우 (동기 버전 사용) - hint 추적 포함
                if (typeof prop === 'string' && availableDbs.includes(prop)) {
                    // prismaManager의 getClientSync 메서드가 자동으로 hint 추적을 수행함
                    return prismaManager.getClientSync(prop);
                }
                
                return undefined;
            }
        });
        
        return dbProxy;
    }

    /**
     * 특정 모듈 가져오기
     */
    public getModule<T extends keyof Injectable>(name: T): Injectable[T] | undefined {
        return this.dependencyInjector.getModule(name);
    }

    /**
     * 특정 레포지토리 가져오기
     */
    public getRepository<T extends keyof RepositoryTypeMap>(name: T): RepositoryTypeMap[T] {
        return repositoryManager.getRepository(name as RepositoryName) as RepositoryTypeMap[T];
    }

    /**
     * 특정 데이터베이스 클라이언트 가져오기 (재연결 로직 포함)
     */
    public async getDbClient(name: string) {
        // prismaManager의 getClient 메서드가 자동으로 hint 추적을 수행함
        return await prismaManager.getClient(name);
    }

    /**
     * 특정 데이터베이스 클라이언트 가져오기 (동기 버전, 재연결 로직 없음)
     */
    public getDbClientSync(name: string) {
        // prismaManager의 getClientSync 메서드가 자동으로 hint 추적을 수행함
        return prismaManager.getClientSync(name);
    }
}

// Export singleton instance for easy access
export const kustoManager = KustoManager.getInstance();
