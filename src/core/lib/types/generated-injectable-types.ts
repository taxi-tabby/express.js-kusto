// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/injectable/

import AUTHJSONWEBTokenModule from '@app/injectable/auth/jsonWebToken.module';

// Module type definitions
type AUTHJSONWEBTokenModuleType = InstanceType<typeof AUTHJSONWEBTokenModule>;

// Injectable modules interface
export interface Injectable {
  authJSONWEBToken: AUTHJSONWEBTokenModuleType;
}

// Module registry for dynamic loading
export const MODULE_REGISTRY = {
  'authJSONWEBToken': () => import('@app/injectable/auth/jsonWebToken.module'),
} as const;

// Module names type
export type ModuleName = keyof typeof MODULE_REGISTRY;

// Helper type for getting module type by name
export type GetModuleType<T extends ModuleName> = T extends keyof Injectable ? Injectable[T] : never;
