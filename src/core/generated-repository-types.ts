// Auto-generated file - DO NOT EDIT MANUALLY
// Generated on: 2025-11-13T10:11:11.653Z
// Source: src/app/repos/

// Repository registry for dynamic loading (empty)
export const REPOSITORY_REGISTRY = {
  // No repositories available
} as const;

/**
 * Augment kusto-framework-core module with repository types
 * Currently empty - add .repository.ts files to src/app/repos/ and regenerate types
 */
declare module 'kusto-framework-core' {
  // Repository type map for getRepository return types (empty - no repositories found)
  interface RepositoryTypeMap {
    // No repository files found
    // Add TypeScript files ending with .repository.ts to src/app/repos/ and regenerate types
  }
}

// Repository names type
export type RepositoryName = keyof typeof REPOSITORY_REGISTRY;

// Helper type for getting repository type by name
export type GetRepositoryType<T extends RepositoryName> = T extends keyof import('kusto-framework-core').RepositoryTypeMap ? import('kusto-framework-core').RepositoryTypeMap[T] : never;
