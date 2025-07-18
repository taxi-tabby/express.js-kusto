// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/repos/

import AccountUserRepository from '@app/repos/account/user.repository';

// Repository type definitions
type AccountUserRepositoryType = InstanceType<typeof AccountUserRepository>;

// Repository type map for getRepository return types
export interface RepositoryTypeMap {
  'accountUser': AccountUserRepositoryType;
}

// Repository registry for dynamic loading
export const REPOSITORY_REGISTRY = {
  'accountUser': () => import('@app/repos/account/user.repository'),
} as const;

// Repository names type
export type RepositoryName = keyof typeof REPOSITORY_REGISTRY;

// Helper type for getting repository type by name
export type GetRepositoryType<T extends RepositoryName> = T extends keyof RepositoryTypeMap ? RepositoryTypeMap[T] : never;
