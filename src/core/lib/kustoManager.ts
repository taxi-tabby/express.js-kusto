import { DependencyInjector } from './dependencyInjector';
import { repositoryManager } from './repositoryManager';
import { prismaManager } from './prismaManager';
import { Injectable } from './types/generated-injectable-types';
import { RepositoryTypeMap, RepositoryName } from './types/generated-repository-types';
import { PrismaManagerClientOverloads } from './types/generated-db-types';



/**
 * 데이터베이스 접근을 위한 프록시 인터페이스
 * PrismaManagerClientOverloads를 확장하여 동적으로 타입 안전한 오버로드 제공
 */
export interface KustoDbProxy extends Pick<PrismaManagerClientOverloads, 'getClient'> {

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

    /** 동적으로 데이터베이스 이름으로 접근 (예: db.user, db.admin) */
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
            // 메서드로 클라이언트 가져오기
            getClient: (name: string) => prismaManager.getClient(name),
            
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
                
                // 데이터베이스 이름으로 직접 접근하는 경우
                if (typeof prop === 'string' && availableDbs.includes(prop)) {
                    return prismaManager.getClient(prop);
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
     * 특정 데이터베이스 클라이언트 가져오기
     */
    public getDbClient(name: string) {
        return prismaManager.getClient(name);
    }
}

// Export singleton instance for easy access
export const kustoManager = KustoManager.getInstance();
