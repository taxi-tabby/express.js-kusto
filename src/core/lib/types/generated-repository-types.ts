// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/repos/

import AccountUserRepository from '@app/repos/account/user.repository';

// Repository type definitions
type AccountUserRepositoryType = InstanceType<typeof AccountUserRepository>;

// Repository classes interface
export interface Repositories {
  accountUser: AccountUserRepositoryType;
}

// Repository registry for dynamic loading
export const REPOSITORY_REGISTRY = {
  'accountUser': () => import('@app/repos/account/user.repository'),
} as const;

// Repository names type
export type RepositoryName = keyof typeof REPOSITORY_REGISTRY;

// Helper type for getting repository type by name
export type GetRepositoryType<T extends RepositoryName> = T extends keyof Repositories ? Repositories[T] : never;
