const fs = require('fs');
const path = require('path');

/**
 * Generate TypeScript types based on databases in src/app/db folder
 */
function generateDatabaseTypes() {
  const dbPath = path.join(process.cwd(), 'src', 'app', 'db');
  
  if (!fs.existsSync(dbPath)) {
    console.error('Database directory not found:', dbPath);
    return;
  }

  // Get all database folders
  const dbFolders = fs.readdirSync(dbPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  console.log('Found databases:', dbFolders);

  // Generate imports for PrismaClient from each database
  const clientImports = dbFolders.map(dbName => 
    `import { PrismaClient as ${capitalize(dbName)}PrismaClient } from '@app/db/${dbName}/client';`
  ).join('\n');

  // Generate instance types (Prisma 7: PrismaClient is generic, use it directly)
  const instanceTypes = dbFolders.map(dbName => 
    `type ${capitalize(dbName)}Instance = ${capitalize(dbName)}PrismaClient;`
  ).join('\n');
  
  // Generate DatabaseClientMap interface
  const clientMapEntries = dbFolders.map(dbName => 
    `  ${dbName}: ${capitalize(dbName)}Instance;`
  ).join('\n');
  
  // Generate Union type for database names
  const databaseNamesUnion = dbFolders.map(dbName => `'${dbName}'`).join(' | ');
  
  // Generate method overloads
  const methodOverloads = dbFolders.map(dbName => 
    `  getWrap(databaseName: '${dbName}'): ${capitalize(dbName)}Instance;`
  ).join('\n');

  const getClientOverloads = dbFolders.map(dbName => 
    `  getClient(databaseName: '${dbName}'): Promise<${capitalize(dbName)}Instance>;`
  ).join('\n');

  // Generate PrismaManager class extension with proper overloads
  const classExtension = `
/**
 * Extend PrismaManager class with proper method overloads
 */
declare module '../prismaManager' {
  interface PrismaManager {
${methodOverloads}
${getClientOverloads}
  }
}`;

  // Generate the complete type file
  const typeFileContent = `// Auto-generated file - Do not edit manually
// Generated from src/app/db folder structure
// Prisma 7+ compatible

/**
 * Import PrismaClient from each database
 */
${clientImports}

/**
 * Instance types for each database client
 */
${instanceTypes}

/**
 * Type mapping for database names to their corresponding Prisma client instances
 */
export interface DatabaseClientMap {
${clientMapEntries}
  [key: string]: any; // Allow for additional databases
}

/**
 * Enhanced client type that preserves actual Prisma client type information
 */
export type DatabaseClientType<T extends string> = T extends keyof DatabaseClientMap 
  ? DatabaseClientMap[T] 
  : any;

/**
 * Valid database names
 */
export type DatabaseName = keyof DatabaseClientMap;

/**
 * Database names as Union type
 */
export type DatabaseNamesUnion = ${databaseNamesUnion};

/**
 * Method overloads for getWrap
 */
export interface PrismaManagerWrapOverloads {
${methodOverloads}
  getWrap<T extends string>(databaseName: T): DatabaseClientType<T>;
}

/**
 * Method overloads for getClient
 */
export interface PrismaManagerClientOverloads {
${getClientOverloads}
  getClient<T = any>(databaseName: string): Promise<T>;
}

${classExtension}
`;

  // Write the generated types to a file
  const outputPath = path.join(process.cwd(), 'src', 'core', 'lib', 'types', 'generated-db-types.ts');
  
  // Ensure directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, typeFileContent);
  console.log('Generated database types at:', outputPath);

  return {
    dbFolders,
    outputPath
  };
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Run if called directly
if (require.main === module) {
  try {
    generateDatabaseTypes();
  } catch (error) {
    console.error('Error generating database types:', error);
  }
}

module.exports = { generateDatabaseTypes };
