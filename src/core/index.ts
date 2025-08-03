import 'module-alias/register';

// Core exports
export { Core, CoreConfig } from './Core';
export { Application, createApplication, initExpressCore_V1 } from './Application';

// Environment and utilities
export { EnvironmentLoader } from './lib/environmentLoader';
export { ErrorFormatter } from './lib/errorFormatter';

// Router and utilities
export { ExpressRouter } from './lib/expressRouter';
export { log, logger } from './external/winston';
export * from './external/util';

// Schema API (개발 모드 전용)
export { CrudSchemaRegistry } from './lib/crudSchemaRegistry';
export { PrismaSchemaAnalyzer } from './lib/prismaSchemaAnalyzer';
export { SchemaApiRouter } from './lib/schemaApiRouter';
export { SchemaApiSetup } from './lib/schemaApiSetup';
export { SchemaApiDebugger } from './lib/schemaApiDebugger';
export * from './lib/crudSchemaTypes';

// Validation system
export { Validator, ValidationResult, ValidationError, Schema, FieldSchema } from './lib/validator';
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
} from './lib/requestHandler';


// Legacy singleton for backward compatibility
export { default as expressApp } from './lib/expressAppSingleton';

// Re-export for convenience
export { default as core } from './Core';


