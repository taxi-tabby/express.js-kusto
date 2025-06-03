// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/injectable/

import AUTHJSONWEBToken from '@app/injectable/auth/jsonWebToken';
import ExampleModule from '@app/injectable/exampleModule';

// Module type definitions
type AUTHJSONWEBTokenType = InstanceType<typeof AUTHJSONWEBToken>;
type ExampleModuleType = InstanceType<typeof ExampleModule>;

// Injectable modules interface
export interface Injectable {
  authJSONWEBToken: AUTHJSONWEBTokenType;
  exampleModule: ExampleModuleType;
}

// Module registry for dynamic loading
export const MODULE_REGISTRY = {
  'authJSONWEBToken': () => import('@app/injectable/auth/jsonWebToken'),
  'exampleModule': () => import('@app/injectable/exampleModule'),
} as const;

// Module names type
export type ModuleName = keyof typeof MODULE_REGISTRY;

// Helper type for getting module type by name
export type GetModuleType<T extends ModuleName> = T extends keyof Injectable ? Injectable[T] : never;
