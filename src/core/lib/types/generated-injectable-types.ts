// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/injectable/

import AuthCSRFHelperModule from '@app/injectable/auth/csrf/helper.module';
import AuthCSRFMiddlewareModule from '@app/injectable/auth/csrf/middleware.module';
import AuthCSRFReferrerMiddleware from '@app/injectable/auth/csrf/referrer.middleware';
import { AuthTryMiddlewareParams as AuthGuideAuthTryMiddlewareParamsType } from '@app/injectable/auth/guide.middleware.interface';
import AuthJsonWebTokenModule from '@app/injectable/auth/jsonWebToken.module';
import AuthJWTExportModule from '@app/injectable/auth/jwt/export.module';
import { AuthTryMiddlewareParams as AuthJWTGuideAuthTryMiddlewareParamsType } from '@app/injectable/auth/jwt/guide.middleware.interface';
import AuthJWTNoLoginOnlyMiddleware from '@app/injectable/auth/jwt/noLoginOnly.middleware';
import AuthJWTRoleMiddleware from '@app/injectable/auth/jwt/role.middleware';
import AuthRateLimiterDefaultMiddleware from '@app/injectable/auth/rateLimiter/default.middleware';
import { RateLimiterOptionMiddlewareParams as AuthRateLimiterOptionRateLimiterOptionMiddlewareParamsType } from '@app/injectable/auth/rateLimiter/option.middleware.interface';
import AuthTRYMiddleware from '@app/injectable/auth/try.middleware';

// Type definitions
type AuthCSRFHelperModuleType = InstanceType<typeof AuthCSRFHelperModule>;
type AuthCSRFMiddlewareModuleType = InstanceType<typeof AuthCSRFMiddlewareModule>;
type AuthJsonWebTokenModuleType = InstanceType<typeof AuthJsonWebTokenModule>;
type AuthJWTExportModuleType = InstanceType<typeof AuthJWTExportModule>;
type AuthCSRFReferrerMiddlewareType = ReturnType<typeof AuthCSRFReferrerMiddleware>;
type AuthJWTNoLoginOnlyMiddlewareType = ReturnType<typeof AuthJWTNoLoginOnlyMiddleware>;
type AuthJWTRoleMiddlewareType = ReturnType<typeof AuthJWTRoleMiddleware>;
type AuthRateLimiterDefaultMiddlewareType = ReturnType<typeof AuthRateLimiterDefaultMiddleware>;
type AuthTRYMiddlewareType = ReturnType<typeof AuthTRYMiddleware>;
type authGuideMiddlewareParamsType = AuthGuideAuthTryMiddlewareParamsType;
type authJwtGuideMiddlewareParamsType = AuthJWTGuideAuthTryMiddlewareParamsType;
type authRateLimiterOptionMiddlewareParamsType = AuthRateLimiterOptionRateLimiterOptionMiddlewareParamsType;

// Injectable modules interface
export interface Injectable {
  authCsrfHelper: AuthCSRFHelperModuleType;
  authCsrfMiddleware: AuthCSRFMiddlewareModuleType;
  authJsonWebToken: AuthJsonWebTokenModuleType;
  authJwtExport: AuthJWTExportModuleType;
}

// Middleware interface
export interface Middleware {
  authCsrfReferrer: AuthCSRFReferrerMiddlewareType;
  authJwtNoLoginOnly: AuthJWTNoLoginOnlyMiddlewareType;
  authJwtRole: AuthJWTRoleMiddlewareType;
  authRateLimiterDefault: AuthRateLimiterDefaultMiddlewareType;
  authTry: AuthTRYMiddlewareType;
}

// Middleware parameters interface
export interface MiddlewareParams {
  authGuide: authGuideMiddlewareParamsType;
  authJwtGuide: authJwtGuideMiddlewareParamsType;
  authRateLimiterOption: authRateLimiterOptionMiddlewareParamsType;
}

// Module registry for dynamic loading
export const MODULE_REGISTRY = {
  'authCsrfHelper': () => import('@app/injectable/auth/csrf/helper.module'),
  'authCsrfMiddleware': () => import('@app/injectable/auth/csrf/middleware.module'),
  'authJsonWebToken': () => import('@app/injectable/auth/jsonWebToken.module'),
  'authJwtExport': () => import('@app/injectable/auth/jwt/export.module'),
} as const;

// Middleware registry for dynamic loading
export const MIDDLEWARE_REGISTRY = {
  'authCsrfReferrer': () => import('@app/injectable/auth/csrf/referrer.middleware'),
  'authJwtNoLoginOnly': () => import('@app/injectable/auth/jwt/noLoginOnly.middleware'),
  'authJwtRole': () => import('@app/injectable/auth/jwt/role.middleware'),
  'authRateLimiterDefault': () => import('@app/injectable/auth/rateLimiter/default.middleware'),
  'authTry': () => import('@app/injectable/auth/try.middleware'),
} as const;

// Middleware parameter mapping
export const MIDDLEWARE_PARAM_MAPPING = {
  'authJwtNoLoginOnly': 'authJwtGuide',
  'authJwtRole': 'authJwtGuide',
  'authRateLimiterDefault': 'authRateLimiterOption',
  'authTry': 'authGuide',
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
