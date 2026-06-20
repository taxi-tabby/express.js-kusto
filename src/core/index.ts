import 'module-alias/register';

// Core exports
export { Core, CoreConfig } from '@core/bootstrap/Core';
export { Application, createApplication } from '@core/bootstrap/Application';

// Environment and utilities
export { EnvironmentLoader } from '@lib/config/environmentLoader';
export { ErrorFormatter } from '@lib/http/errors/errorFormatter';

// Router and utilities
export { ExpressRouter, injectedMiddleware } from '@lib/http/routing/expressRouter';
export { log, logger } from '@ext/winston';
export * from '@ext/util';

// Schema API (개발 모드 전용)
export { CrudSchemaRegistry } from '@lib/devtools/schema-api/crudSchemaRegistry';
export { PrismaSchemaAnalyzer } from '@lib/devtools/schema-api/prismaSchemaAnalyzer';
export { SchemaApiRouter } from '@lib/devtools/schema-api/schemaApiRouter';
export { SchemaApiSetup } from '@lib/devtools/schema-api/schemaApiSetup';
export * from '@lib/devtools/schema-api/crudSchemaTypes';

// Validation system
export { Validator, ValidationResult, ValidationError, Schema, FieldSchema } from '@lib/http/validation/validator';
export { 
    RequestHandler, 
    RequestConfig, 
    ResponseConfig, 
    ValidatedRequest,
    createValidatedHandler,
    withValidation,
    withFullValidation,
    sendSuccess,
    sendError
} from '@lib/http/validation/requestHandler';


// Legacy singleton for backward compatibility
export { default as expressApp } from '@core/bootstrap/expressAppSingleton';

// Re-export for convenience
export { default as core } from '@core/bootstrap/Core';


