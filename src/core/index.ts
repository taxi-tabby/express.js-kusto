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


