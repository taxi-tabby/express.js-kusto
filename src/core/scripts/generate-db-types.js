const fs = require('fs');
const path = require('path');

/**
 * Build the generated-db-types.ts content from a list of DB folder names.
 *
 * Pure (no I/O) — the single source of truth for the codegen. An empty list is a
 * valid state (a DB-less service): it yields `DatabaseNamesUnion = never` and no
 * client imports, so the file stays valid TypeScript and references no missing
 * `@app/db/<name>/client` module. Non-empty output is unchanged.
 */
function buildDatabaseTypesContent(dbFolders) {
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

  // Generate Union type for database names.
  // 빈 목록이면 유효한 union 멤버가 없으므로 `never` 로 둔다 (잘못된 `= ;` 방지).
  const databaseNamesUnion = dbFolders.length
    ? dbFolders.map(dbName => `'${dbName}'`).join(' | ')
    : 'never';

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
declare module '../data/database/prismaManager' {
  interface PrismaManager {
${methodOverloads}
${getClientOverloads}
  }
}`;

  // Generate the complete type file
  return `// Auto-generated file - Do not edit manually
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
}

/**
 * Generate TypeScript types based on databases in src/app/db folder
 */
function generateDatabaseTypes() {
  const dbPath = path.join(process.cwd(), 'src', 'app', 'db');

  // DB-less 서비스는 src/app/db 가 없을 수 있다 — 부재(또는 빈 폴더)는 빈 목록으로 취급해
  // 유효한(빈) 타입 파일을 그대로 쓴다. 그래야 없는 client 를 참조하던 stale 타입이 남아
  // typecheck 를 깨뜨리지 않는다.
  const dbFolders = fs.existsSync(dbPath)
    ? fs.readdirSync(dbPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
    : [];

  console.log('Found databases:', dbFolders);

  const typeFileContent = buildDatabaseTypesContent(dbFolders);

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

module.exports = { generateDatabaseTypes, buildDatabaseTypesContent };
