#!/usr/bin/env node
// filepath: r:\project\express.js-kusto\src\core\scripts\kusto-db-cli.ts

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import * as util from 'util';

const execPromise = util.promisify(exec);

// Define the program
const program = new Command();

// Setup basic program info
program
  .name('kusto-db')
  .description('CLI tool for managing Prisma databases in express.js-kusto project')
  .version('1.0.0');

/**
 * Get all database directories from src/app/db
 */
function getDatabaseDirs(): string[] {
  const dbPath = path.join(process.cwd(), 'src', 'app', 'db');
  
  if (!fs.existsSync(dbPath)) {
    console.error(`Database directory not found: ${dbPath}`);
    return [];
  }
  
  return fs.readdirSync(dbPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && fs.existsSync(path.join(dbPath, dirent.name, 'schema.prisma')))
    .map(dirent => dirent.name);
}

/**
 * Get schema path for a database
 */
function getSchemaPath(dbName: string): string {
  return path.join(process.cwd(), 'src', 'app', 'db', dbName, 'schema.prisma');
}

/**
 * Execute a Prisma command for a specific database
 */
async function executePrismaCommand(dbName: string, command: string): Promise<void> {
  const schemaPath = getSchemaPath(dbName);
  
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }
  
  const fullCommand = `npx prisma ${command} --schema ${schemaPath}`;
  
  console.log(`Executing: ${fullCommand}`);  try {
    const { stdout, stderr } = await execPromise(fullCommand);
    console.log(`[${dbName}] ${stdout}`);
    if (stderr) console.error(`[${dbName}] Error: ${stderr}`);
  } catch (error: any) {
    console.error(`[${dbName}] Failed to execute command: ${error?.message || String(error)}`);
  }
}

// List command - Shows all available databases
program
  .command('list')
  .description('List all available databases')
  .action(() => {
    const dbs = getDatabaseDirs();
    if (dbs.length === 0) {
      console.log('No databases found in src/app/db');
      return;
    }
    
    console.log('Available databases:');
    dbs.forEach(db => console.log(` - ${db}`));
  });

// Generate command - Generates Prisma client
program
  .command('generate')
  .description('Generate Prisma client for one or all databases')
  .option('-d, --db <database>', 'Specific database to generate client for')
  .option('-a, --all', 'Generate for all databases (default)')
  .action(async (options) => {
    const dbs = options.db ? [options.db] : getDatabaseDirs();
    
    if (dbs.length === 0) {
      console.log('No databases found to generate');
      return;
    }
    
    console.log(`Generating Prisma client for ${options.db ? `database: ${options.db}` : 'all databases'}`);
    
    for (const db of dbs) {      try {
        await executePrismaCommand(db, 'generate');
        console.log(`✅ Generated client for ${db}`);
      } catch (error: any) {
        console.error(`❌ Failed to generate client for ${db}: ${error?.message || String(error)}`);
      }
    }
  });

// Migrate command - Handles Prisma migrations
program
  .command('migrate')
  .description('Manage Prisma migrations')
  .option('-d, --db <database>', 'Specific database to run migration for')
  .option('-a, --all', 'Run migration for all databases')
  .option('-n, --name <name>', 'Name for the migration (required for dev)')
  .requiredOption('-t, --type <type>', 'Migration type: dev, deploy, reset, status')
  .action(async (options) => {
    if (!['dev', 'deploy', 'reset', 'status'].includes(options.type)) {
      console.error('Invalid migration type. Must be one of: dev, deploy, reset, status');
      return;
    }
    
    const dbs = options.db ? [options.db] : (options.all ? getDatabaseDirs() : []);
    
    if (dbs.length === 0) {
      console.error('Please specify a database with --db or use --all flag');
      return;
    }
    
    if (options.type === 'dev' && !options.name) {
      console.error('Migration name is required for dev migrations. Use --name flag');
      return;
    }
    
    const migrationCommand = options.type === 'dev' 
      ? `migrate ${options.type} --name ${options.name}`
      : `migrate ${options.type}`;
    
    for (const db of dbs) {      try {
        await executePrismaCommand(db, migrationCommand);
        console.log(`✅ Migration '${options.type}' completed for ${db}`);
      } catch (error: any) {
        console.error(`❌ Migration failed for ${db}: ${error?.message || String(error)}`);
      }
    }
  });

// Studio command - Opens Prisma Studio for a specific database
program
  .command('studio')
  .description('Open Prisma Studio for a database')
  .requiredOption('-d, --db <database>', 'Database to open in Prisma Studio')
  .action(async (options) => {    try {
      await executePrismaCommand(options.db, 'studio');
    } catch (error: any) {
      console.error(`❌ Failed to open Prisma Studio: ${error?.message || String(error)}`);
    }
  });

// Format command - Format schema for one or all databases
program
  .command('format')
  .description('Format Prisma schema for one or all databases')
  .option('-d, --db <database>', 'Specific database to format schema for')
  .option('-a, --all', 'Format schemas for all databases (default)')
  .action(async (options) => {
    const dbs = options.db ? [options.db] : getDatabaseDirs();
    
    if (dbs.length === 0) {
      console.log('No databases found to format');
      return;
    }
    
    console.log(`Formatting Prisma schema for ${options.db ? `database: ${options.db}` : 'all databases'}`);
    
    for (const db of dbs) {      try {
        await executePrismaCommand(db, 'format');
        console.log(`✅ Formatted schema for ${db}`);
      } catch (error: any) {
        console.error(`❌ Failed to format schema for ${db}: ${error?.message || String(error)}`);
      }
    }
  });

// Parse arguments
program.parse(process.argv);

// Show help if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}