// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/injectable/

import TestMathModule from '@app/injectable/test/math.module';

// Type definitions
type TestMathModuleType = InstanceType<typeof TestMathModule>;

// Injectable modules interface
export interface Injectable {
  testMath: TestMathModuleType;
}

// Middleware interface
export interface Middleware {

}

// Middleware parameters interface (empty - no middleware interfaces found)
export interface MiddlewareParams {
  // No middleware parameter interfaces found
  // Add *.middleware.interface.ts files to src/app/injectable/ and regenerate types
}

// Module registry for dynamic loading
export const MODULE_REGISTRY = {
  'testMath': () => import('@app/injectable/test/math.module'),
} as const;

// Middleware registry for dynamic loading
export const MIDDLEWARE_REGISTRY = {

} as const;

// Middleware parameter mapping
export const MIDDLEWARE_PARAM_MAPPING = {
  // No middleware parameter mappings found
} as const;

// Module names type
export type ModuleName = keyof typeof MODULE_REGISTRY;

// Middleware names type
export type MiddlewareName = keyof typeof MIDDLEWARE_REGISTRY;

// Middleware parameter names type
export type MiddlewareParamName = keyof MiddlewareParams;

// Helper type for getting module type by name
export type GetModuleType<T extends ModuleName> = T extends keyof Injectable ? Injectable[T] : never;

// Helper type for getting middleware type by name
export type GetMiddlewareType<T extends MiddlewareName> = T extends keyof Middleware ? Middleware[T] : never;

// Helper type for getting middleware parameter type by name
export type GetMiddlewareParamType<T extends MiddlewareParamName> = T extends keyof MiddlewareParams ? MiddlewareParams[T] : never;
