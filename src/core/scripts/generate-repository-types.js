const fs = require('fs');
const path = require('path');
const { analyzeWordType, smartSplit, toCamelCase, toPascalCase } = require('./fnCamelConvert');

/**
 * Recursively scan directory for repository TypeScript files
 */
function scanDirectory(dirPath, basePath = '', repositories = []) {
	if (!fs.existsSync(dirPath)) {
		return repositories;
	}

	const items = fs.readdirSync(dirPath, { withFileTypes: true });

	for (const item of items) {
		const itemPath = path.join(dirPath, item.name);
		const relativePath = basePath ? `${basePath}/${item.name}` : item.name;

		if (item.isDirectory()) {
			// Recursively scan subdirectories
			scanDirectory(itemPath, relativePath, repositories);
		} else if (item.isFile() && item.name.endsWith('.repository.ts')) {
			// Only include *.repository.ts files
			const fileName = path.basename(item.name, '.ts');
			const cleanFileName = fileName.replace('.repository', ''); // Remove .repository suffix
			const repositoryPath = basePath ? `${basePath}/${fileName}` : fileName;

			// Generate property name by converting path to camelCase (without Repository suffix)
			const propertyName = basePath
				? toCamelCase(`${basePath.replace(/\//g, '_')}_${cleanFileName}`)
				: toCamelCase(cleanFileName);

			// Generate unique import alias using full path
			const importAlias = basePath
				? toPascalCase(`${basePath.replace(/\//g, '_')}_${cleanFileName}_Repository`)
				: toPascalCase(`${cleanFileName}_Repository`);

			repositories.push({
				repositoryPath,
				propertyName,
				className: importAlias, // Use unique alias as className
				importPath: repositoryPath
			});
		}
	}

	return repositories;
}

/**
 * Generate TypeScript types for repository classes
 */
function generateRepositoryTypes() {
	const repositoryPath = path.join(process.cwd(), 'src', 'app', 'repos');

	if (!fs.existsSync(repositoryPath)) {
		console.log('Repository directory not found, creating default types...');
		generateDefaultTypes();
		return;
	}

	// Recursively scan for all repository TypeScript files
	const repositories = scanDirectory(repositoryPath);

	console.log('Found repository files:', repositories.map(r => r.repositoryPath));

	if (repositories.length === 0) {
		generateDefaultTypes();
		return;
	}

	// Generate import statements
	const imports = repositories.map(repository =>
		`import ${repository.className} from '@app/repos/${repository.importPath}';`
	).join('\n');

	// Generate repository type definitions
	const repositoryTypes = repositories.map(repository => {
		return `type ${repository.className}Type = InstanceType<typeof ${repository.className}>;`;
	}).join('\n');
	// Generate Repository type map (for getRepository return types)
	const repositoryTypeMap = repositories.map(repository =>
		`  '${repository.propertyName}': ${repository.className}Type;`
	).join('\n');

	// Ensure RepositoryTypeMap interface is always present (even if empty)
	const repositoryTypeMapInterface = repositoryTypeMap 
		? `// Repository type map for getRepository return types
export interface RepositoryTypeMap {
${repositoryTypeMap}
}`
		: `// Repository type map for getRepository return types (empty - no repositories found)
export interface RepositoryTypeMap {
  // No repository files found
  // Add TypeScript files ending with .repository.ts to src/app/repos/ and regenerate types
}`;

	// Generate repository registry for runtime loading
	const repositoryRegistry = repositories.map(repository =>
		`  '${repository.propertyName}': () => import('@app/repos/${repository.importPath}'),`
	).join('\n');

	const typeDefinition = `// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/repos/

${imports}

// Repository type definitions
${repositoryTypes}

${repositoryTypeMapInterface}

// Repository registry for dynamic loading
export const REPOSITORY_REGISTRY = {
${repositoryRegistry}
} as const;

// Repository names type
export type RepositoryName = keyof typeof REPOSITORY_REGISTRY;

// Helper type for getting repository type by name
export type GetRepositoryType<T extends RepositoryName> = T extends keyof RepositoryTypeMap ? RepositoryTypeMap[T] : never;
`;

	// Write the generated types to file
	const outputPath = path.join(process.cwd(), 'src', 'core', 'lib', 'types', 'generated-repository-types.ts');

	// Ensure directory exists
	const outputDir = path.dirname(outputPath);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	fs.writeFileSync(outputPath, typeDefinition, 'utf8');
	console.log('Generated repository types:', outputPath);
}

/**
 * Generate default types when no repository files exist
 */
function generateDefaultTypes() {
	const typeDefinition = `// Auto-generated file - DO NOT EDIT MANUALLY
// Generated on: ${new Date().toISOString()}
// Source: src/app/repos/

// Repository type map for getRepository return types (empty - no repositories found)
export interface RepositoryTypeMap {
  // No repository files found
  // Add TypeScript files ending with .repository.ts to src/app/repos/ and regenerate types
}

// Repository registry for dynamic loading (empty)
export const REPOSITORY_REGISTRY = {
  // No repositories available
} as const;

// Repository names type
export type RepositoryName = keyof typeof REPOSITORY_REGISTRY;

// Helper type for getting repository type by name
export type GetRepositoryType<T extends RepositoryName> = T extends keyof RepositoryTypeMap ? RepositoryTypeMap[T] : never;
`;

	const outputPath = path.join(process.cwd(), 'src', 'core', 'lib', 'types', 'generated-repository-types.ts');

	// Ensure directory exists
	const outputDir = path.dirname(outputPath);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	fs.writeFileSync(outputPath, typeDefinition, 'utf8');
	console.log('Generated default repository types:', outputPath);
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
		generateRepositoryTypes();
		console.log('Repository types generation completed successfully!');
	} catch (error) {
		console.error('Error generating repository types:', error);
		process.exit(1);
	}
}

module.exports = { generateRepositoryTypes };
