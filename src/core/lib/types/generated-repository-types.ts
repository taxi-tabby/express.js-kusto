// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/repos/

import ExampleRepository from '@app/repos/example.repository';

// Repository type definitions
type ExampleRepositoryType = InstanceType<typeof ExampleRepository>;

// Repository type map for getRepository return types
export interface RepositoryTypeMap {
  'example': ExampleRepositoryType;
}

// Repository registry for dynamic loading
export const REPOSITORY_REGISTRY = {
  'example': () => import('@app/repos/example.repository'),
} as const;

// Repository names type
export type RepositoryName = keyof typeof REPOSITORY_REGISTRY;

// Helper type for getting repository type by name
export type GetRepositoryType<T extends RepositoryName> = T extends keyof RepositoryTypeMap ? RepositoryTypeMap[T] : never;
