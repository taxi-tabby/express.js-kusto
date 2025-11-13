import type { Injectable, Middleware, MiddlewareParams, MIDDLEWARE_PARAM_MAPPING } from './generated-injectable-types';
import type { RepositoryTypeMap } from './generated-repository-types';
import type { DatabaseClientMap } from './generated-db-types';

declare module 'kusto-framework-core' {
  interface KustoConfigurableTypes {
    injectable: import('./generated-injectable-types').Injectable;
    middleware: import('./generated-injectable-types').Middleware;
    middlewareParams: import('./generated-injectable-types').MiddlewareParams;
    middlewareParamMapping: typeof import('./generated-injectable-types').MIDDLEWARE_PARAM_MAPPING;  // ← 이 줄 추가!
    repositoryTypeMap: import('./generated-repository-types').RepositoryTypeMap;
    databaseClientMap: import('./generated-db-types').DatabaseClientMap;
  }
}

export {}