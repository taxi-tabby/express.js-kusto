// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/repos/

import UserRepository from '@app/repos/user.repository';

// Repository type definitions
type UserRepositoryType = InstanceType<typeof UserRepository>;

// Repository classes interface
export interface Repositories {
  user: UserRepositoryType;
}

// Repository registry for dynamic loading
export const REPOSITORY_REGISTRY = {
  'user': () => import('@app/repos/user.repository'),
} as const;

// Repository names type
export type RepositoryName = keyof typeof REPOSITORY_REGISTRY;

// Helper type for getting repository type by name
export type GetRepositoryType<T extends RepositoryName> = T extends keyof Repositories ? Repositories[T] : never;
