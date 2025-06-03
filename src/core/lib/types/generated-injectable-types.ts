// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/injectable/

import ExampleModule from '@app/injectable/exampleModule';
import Jwt from '@app/injectable/jwt';

// Module type definitions
type ExampleModuleType = InstanceType<typeof ExampleModule>;
type JwtType = InstanceType<typeof Jwt>;

// Injectable modules interface
export interface Injectable {
  exampleModule: ExampleModuleType;
  jwt: JwtType;
}

// Module registry for dynamic loading
export const MODULE_REGISTRY = {
  'exampleModule': () => import('@app/injectable/exampleModule'),
  'jwt': () => import('@app/injectable/jwt'),
} as const;

// Module names type
export type ModuleName = keyof typeof MODULE_REGISTRY;

// Helper type for getting module type by name
export type GetModuleType<T extends ModuleName> = T extends keyof Injectable ? Injectable[T] : never;
