import 'module-alias/register';

// Core exports
export { Core, CoreConfig } from './Core';
export { Application, createApplication, initExpressCore_V1 } from './Application';

// Router and utilities
export { ExpressRouter } from './lib/expressRouter';
export { log, logger } from './external/winston';
export * from './external/util';

// Legacy singleton for backward compatibility
export { default as expressApp } from './lib/expressAppSingleton';

// Re-export for convenience
export { default as core } from './Core';

console.log('Done');