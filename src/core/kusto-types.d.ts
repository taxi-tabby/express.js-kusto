import type { Injectable } from './generated-injectable-types';
import type { RepositoryTypeMap } from './generated-repository-types';
import type { DatabaseClientMap } from './generated-db-types';

declare module 'kusto-framework-core' {
  interface KustoConfigurableTypes {
    injectable: Injectable;
    repositoryTypeMap: RepositoryTypeMap;
    databaseClientMap: DatabaseClientMap;
  }
}

export {}