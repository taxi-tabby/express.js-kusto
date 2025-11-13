declare module 'kusto-framework-core' {
  interface KustoConfigurableTypes {
    injectable: import('./generated-injectable-types').Injectable;
    repositoryTypeMap: import('./generated-repository-types').RepositoryTypeMap;
    databaseClientMap: import('./generated-db-types').DatabaseClientMap;
  }
}

export {}