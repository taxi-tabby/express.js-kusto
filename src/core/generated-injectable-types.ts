// Auto-generated file - DO NOT EDIT MANUALLY
// Source: ./src/app/injectable

import TestMathModule from '../app/injectable/test/math.module';

// Type definitions
type TestMathModuleType = InstanceType<typeof TestMathModule>;

// Module registry for dynamic loading
export const MODULE_REGISTRY = {
  'testMath': () => import('../app/injectable/test/math.module'),
} as const;

// Middleware registry for dynamic loading
export const MIDDLEWARE_REGISTRY = {

} as const;

// Middleware parameter mapping
export const MIDDLEWARE_PARAM_MAPPING = {
  // No middleware parameter mappings found
} as const;

/**
 * Augment kusto-framework-core module with actual injectable types
 */
declare module 'kusto-framework-core' {
  // Injectable modules interface
  interface Injectable {
  testMath: TestMathModuleType;
  }

  // Middleware interface
  interface Middleware {

  }

  // Middleware parameters interface
  interface MiddlewareParams {
    // No middleware parameters
  }
  
  // Middleware parameter mapping interface
  interface MiddlewareParamMapping {
    // No middleware parameter mappings
  }

  // Augment KustoConfigurableTypes for type inference
  interface KustoConfigurableTypes {
    injectable: Injectable;
    middleware: Middleware;
    middlewareParams: MiddlewareParams;
    middlewareParamMapping: MiddlewareParamMapping;
  }
}

// Module names type
export type ModuleName = keyof typeof MODULE_REGISTRY;

// Middleware names type
export type MiddlewareName = keyof typeof MIDDLEWARE_REGISTRY;

// Middleware parameter names type
export type MiddlewareParamName = keyof typeof MIDDLEWARE_PARAM_MAPPING;

// Helper type for getting module type by name
export type GetModuleType<T extends ModuleName> = T extends keyof import('kusto-framework-core').Injectable ? import('kusto-framework-core').Injectable[T] : never;

// Helper type for getting middleware type by name
export type GetMiddlewareType<T extends MiddlewareName> = T extends keyof import('kusto-framework-core').Middleware ? import('kusto-framework-core').Middleware[T] : never;

// Helper type for getting middleware parameter type by name
export type GetMiddlewareParamType<T extends MiddlewareParamName> = T extends keyof import('kusto-framework-core').MiddlewareParams ? import('kusto-framework-core').MiddlewareParams[T] : never;
