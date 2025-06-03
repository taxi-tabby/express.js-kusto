const fs = require('fs');
const path = require('path');

/**
 * Generate TypeScript types for injectable modules
 */
function generateInjectableTypes() {
  const injectablePath = path.join(process.cwd(), 'src', 'app', 'injectable');
  
  if (!fs.existsSync(injectablePath)) {
    console.log('Injectable directory not found, creating default types...');
    generateDefaultTypes();
    return;
  }

  // Get all TypeScript files in injectable folder
  const files = fs.readdirSync(injectablePath)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .map(file => path.basename(file, '.ts'));

  console.log('Found injectable modules:', files);

  if (files.length === 0) {
    generateDefaultTypes();
    return;
  }

  // Generate import statements
  const imports = files.map(moduleName => 
    `import ${capitalize(moduleName)} from '@app/injectable/${moduleName}';`
  ).join('\n');
  // Generate module type definitions
  const moduleTypes = files.map(moduleName => {
    const capitalizedName = capitalize(moduleName);
    return `type ${capitalizedName}Type = InstanceType<typeof ${capitalizedName}>;`;
  }).join('\n');

  // Generate Injectable interface
  const injectableProperties = files.map(moduleName => 
    `  ${moduleName}: ${capitalize(moduleName)}Type;`
  ).join('\n');

  // Generate module registry for runtime loading
  const moduleRegistry = files.map(moduleName => 
    `  '${moduleName}': () => import('@app/injectable/${moduleName}'),`
  ).join('\n');

  const typeDefinition = `// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/injectable/

${imports}

// Module type definitions
${moduleTypes}

// Injectable modules interface
export interface Injectable {
${injectableProperties}
}

// Module registry for dynamic loading
export const MODULE_REGISTRY = {
${moduleRegistry}
} as const;

// Module names type
export type ModuleName = keyof typeof MODULE_REGISTRY;

// Helper type for getting module type by name
export type GetModuleType<T extends ModuleName> = T extends keyof Injectable ? Injectable[T] : never;
`;

  // Write the generated types to file
  const outputPath = path.join(process.cwd(), 'src', 'core', 'lib', 'types', 'generated-injectable-types.ts');
  
  // Ensure directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, typeDefinition, 'utf8');
  console.log('Generated injectable types:', outputPath);
}

/**
 * Generate default types when no injectable modules exist
 */
function generateDefaultTypes() {
  const typeDefinition = `// Auto-generated file - DO NOT EDIT MANUALLY
// Generated on: ${new Date().toISOString()}
// Source: src/app/injectable/

// Injectable modules interface (empty - no modules found)
export interface Injectable {
  // No injectable modules found
  // Add TypeScript files to src/app/injectable/ and regenerate types
}

// Module registry for dynamic loading (empty)
export const MODULE_REGISTRY = {
  // No modules available
} as const;

// Module names type
export type ModuleName = keyof typeof MODULE_REGISTRY;

// Helper type for getting module type by name
export type GetModuleType<T extends ModuleName> = T extends keyof Injectable ? Injectable[T] : never;
`;

  const outputPath = path.join(process.cwd(), 'src', 'core', 'lib', 'types', 'generated-injectable-types.ts');
  
  // Ensure directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, typeDefinition, 'utf8');
  console.log('Generated default injectable types:', outputPath);
}

/**
 * Capitalize first letter of string
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Run the generator
if (require.main === module) {
  try {
    generateInjectableTypes();
    console.log('Injectable types generation completed successfully!');
  } catch (error) {
    console.error('Error generating injectable types:', error);
    process.exit(1);
  }
}

module.exports = { generateInjectableTypes };