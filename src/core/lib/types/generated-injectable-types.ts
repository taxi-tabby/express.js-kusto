// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/injectable/

import AUTHJSONWEBToken from '@app/injectable/auth/jsonWebToken';
import AUTHTYPE from '@app/injectable/auth/type';
import ExampleModule from '@app/injectable/exampleModule';

// Module type definitions
type AUTHJSONWEBTokenType = InstanceType<typeof AUTHJSONWEBToken>;
type AUTHTYPEType = InstanceType<typeof AUTHTYPE>;
type ExampleModuleType = InstanceType<typeof ExampleModule>;

// Injectable modules interface
export interface Injectable {
  authJSONWEBToken: AUTHJSONWEBTokenType;
  authTYPE: AUTHTYPEType;
  exampleModule: ExampleModuleType;
}

// Module registry for dynamic loading
export const MODULE_REGISTRY = {
  'authJSONWEBToken': () => import('@app/injectable/auth/jsonWebToken'),
  'authTYPE': () => import('@app/injectable/auth/type'),
  'exampleModule': () => import('@app/injectable/exampleModule'),
} as const;

// Module names type
export type ModuleName = keyof typeof MODULE_REGISTRY;

// Helper type for getting module type by name
export type GetModuleType<T extends ModuleName> = T extends keyof Injectable ? Injectable[T] : never;
