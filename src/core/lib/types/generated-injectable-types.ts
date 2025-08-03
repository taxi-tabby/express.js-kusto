// Auto-generated file - DO NOT EDIT MANUALLY
// Generated on: 2025-08-03T14:06:33.475Z
// Source: src/app/injectable/

// Injectable modules interface (empty - no modules found)
export interface Injectable {
  // No injectable modules found
  // Add TypeScript files to src/app/injectable/ and regenerate types
}

// Middleware interface (empty - no middlewares found)
export interface Middleware {
  // No middleware modules found
  // Add *.middleware.ts files to src/app/injectable/ and regenerate types
}

// Middleware parameters interface (empty - no middleware interfaces found)
export interface MiddlewareParams {
  // No middleware parameter interfaces found
  // Add *.middleware.interface.ts files to src/app/injectable/ and regenerate types
}

// Module registry for dynamic loading (empty)
export const MODULE_REGISTRY = {
  // No modules available
} as const;

// Middleware registry for dynamic loading (empty)
export const MIDDLEWARE_REGISTRY = {
  // No middlewares available
} as const;

// Middleware parameter mapping (empty)
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
