const fs = require('fs');
const path = require('path');
const { analyzeWordType, smartSplit, toCamelCase, toPascalCase } = require('./fnCamelConvert');

/**
 * Extract exported interface names from a TypeScript file
 */
function extractExportedInterfaces(filePath) {
	try {
		const content = fs.readFileSync(filePath, 'utf8');
		const interfaceRegex = /export\s+interface\s+(\w+)/g;
		const interfaces = [];
		let match;
		
		while ((match = interfaceRegex.exec(content)) !== null) {
			interfaces.push(match[1]);
		}
		
		return interfaces;
	} catch (error) {
		console.warn(`Could not read file ${filePath}:`, error.message);
		return [];
	}
}

/**
 * Extract named exports from a TypeScript file using static analysis
 * Since dynamic imports don't work with .ts files in Node.js, we use static analysis
 */
async function extractNamedExports(filePath) {
	// For TypeScript files, always use static analysis since Node.js can't import .ts files directly
	if (filePath.endsWith('.ts')) {
		return extractNamedExportsStatic(filePath);
	}
	
	// For JavaScript files, try dynamic import first, then fall back to static analysis
	try {
		// Convert to file:// URL for Windows compatibility
		const absolutePath = path.resolve(filePath);
		const fileUrl = `file://${absolutePath.replace(/\\/g, '/')}`;
		
		// Dynamically import the module to get actual exports
		const module = await import(fileUrl);
		const namedExports = [];
		
		// Iterate through all exported names
		for (const [exportName, exportValue] of Object.entries(module)) {
			// Skip default export as it's handled separately
			if (exportName === 'default') continue;
			
			// Check if the export is middleware-related by analyzing the value
			if (isMiddlewareExport(exportName, exportValue)) {
				namedExports.push(exportName);
			}
		}
		
		return namedExports;
	} catch (error) {
		// If dynamic import fails, fall back to static analysis
		console.warn(`Could not dynamically import ${filePath}, falling back to static analysis:`, error.message);
		return extractNamedExportsStatic(filePath);
	}
}

/**
 * Determine if an export is middleware-related based on its name and value
 */
function isMiddlewareExport(exportName, exportValue) {
	// Check if it's a function that looks like middleware
	if (typeof exportValue === 'function') {
		// Check function signature - middleware typically has (req, res, next) parameters
		const funcStr = exportValue.toString();
		const params = extractFunctionParameters(funcStr);
		
		// Middleware functions typically have 3 parameters (req, res, next) or 4 (err, req, res, next)
		if (params.length === 3 || params.length === 4) {
			const hasMiddlewareParams = params.some(param => 
				/^(req|request|res|response|next|err|error)$/i.test(param.trim())
			);
			if (hasMiddlewareParams) return true;
		}
	}
	
	// Check if it's a class that might be injectable middleware
	if (typeof exportValue === 'function' && exportValue.prototype) {
		// Look for middleware-like methods in the prototype
		const proto = exportValue.prototype;
		const methods = Object.getOwnPropertyNames(proto);
		
		if (methods.some(method => /^(use|handle|process|execute|middleware)$/i.test(method))) {
			return true;
		}
	}
	
	// Name-based fallback (but more specific than hardcoded strings)
	return isMiddlewareRelatedName(exportName);
}

/**
 * Determine if an export name suggests it's middleware-related (for static analysis)
 */
function isMiddlewareRelatedName(exportName) {
	const namePatterns = [
		/Middleware$/,
		/^middleware/i,
		/Handler$/,
		/Guard$/,
		/Interceptor$/,
		/^csrf/i,
		/^jwt/i,
		/^auth/i,
		/^rate/i,
		/limiter/i,
		/validator/i,
		/parser/i,
		/^cors/i,
		/logger/i,
		/helmet/i,
		/security/i
	];
	
	return namePatterns.some(pattern => pattern.test(exportName));
}

/**
 * Extract function parameters from function string
 */
function extractFunctionParameters(funcStr) {
	const match = funcStr.match(/\(([^)]*)\)/);
	if (!match || !match[1]) return [];
	
	return match[1].split(',').map(param => 
		param.trim().replace(/=.*$/, '').replace(/\.\.\./g, '')
	).filter(param => param.length > 0);
}

/**
 * Improved static analysis for TypeScript files
 */
function extractNamedExportsStatic(filePath) {
	try {
		const content = fs.readFileSync(filePath, 'utf8');
		const namedExports = [];
		
		// Remove all types of comments from content first
		let contentWithoutComments = content;
		
		// Remove multi-line comments /* ... */
		contentWithoutComments = contentWithoutComments.replace(/\/\*[\s\S]*?\*\//g, '');
		
		// Remove single-line comments //
		contentWithoutComments = contentWithoutComments.replace(/\/\/.*$/gm, '');
		
		// Remove lines that are commented out with // (entire lines)
		contentWithoutComments = contentWithoutComments
			.split('\n')
			.filter(line => !line.trim().startsWith('//'))
			.join('\n');
		
		// Enhanced regex patterns for TypeScript exports - excluding default exports
		const exportPatterns = [
			// export const/let/var name = ...
			/export\s+(?:const|let|var)\s+(\w+)/g,
			// export function name(...) { ... } (not default)
			/export\s+(?!default\s+)function\s+(\w+)/g,
			// export class name { ... } (not default)
			/export\s+(?!default\s+)class\s+(\w+)/g,
			// export interface name { ... }
			/export\s+interface\s+(\w+)/g,
			// export type name = ...
			/export\s+type\s+(\w+)/g,
			// export enum name { ... }
			/export\s+enum\s+(\w+)/g,
			// export async function name(...) { ... } (not default)
			/export\s+(?!default\s+)async\s+function\s+(\w+)/g,
			// export { name1, name2, ... }
			/export\s*\{\s*([^}]+)\s*\}/g
		];
		
		exportPatterns.forEach(pattern => {
			let match;
			while ((match = pattern.exec(contentWithoutComments)) !== null) {
				if (pattern.source.includes('\\{')) {
					// Handle export { name1, name2, ... } case
					const exportList = match[1];
					const names = exportList.split(',').map(name => {
						// Handle "name as alias" syntax and type exports
						const cleanName = name.trim()
							.replace(/^type\s+/, '') // Remove 'type' keyword for type exports
							.split(/\s+as\s+/)[0].trim();
						return cleanName;
					}).filter(name => name && !name.includes('*'));
					
					namedExports.push(...names);
				} else {
					// Handle single export case
					if (match[1] && !namedExports.includes(match[1])) {
						namedExports.push(match[1]);
					}
				}
			}
		});
		
		// Remove duplicates and filter out invalid names
		const uniqueExports = [...new Set(namedExports)].filter(name => 
			name && 
			/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && // Valid JavaScript identifier
			!['default', 'from', 'as', 'type'].includes(name) // Exclude keywords
		);
		
		console.log(`Static analysis for ${filePath}: found exports [${uniqueExports.join(', ')}]`);
		return uniqueExports;
	} catch (error) {
		console.warn(`Could not read file ${filePath}:`, error.message);
		return [];
	}
}

/**
 * Recursively scan directory for TypeScript files
 */
async function scanDirectory(dirPath, basePath = '', modules = []) {
	if (!fs.existsSync(dirPath)) {
		return modules;
	}

	const items = fs.readdirSync(dirPath, { withFileTypes: true });

	for (const item of items) {
		const itemPath = path.join(dirPath, item.name);
		const relativePath = basePath ? `${basePath}/${item.name}` : item.name;

		if (item.isDirectory()) {			// Recursively scan subdirectories
			await scanDirectory(itemPath, relativePath, modules);} else if (item.isFile() && item.name.endsWith('.module.ts')) {
			// Only include *.module.ts files
			const fileName = path.basename(item.name, '.ts');
			const cleanFileName = fileName.replace('.module', ''); // Remove .module suffix
			const modulePath = basePath ? `${basePath}/${fileName}` : fileName;
			const fullPath = path.join(dirPath, item.name);

			// Generate property name by converting path to camelCase (without Module suffix)
			const propertyName = basePath
				? toCamelCase(`${basePath.replace(/\//g, '_')}_${cleanFileName}`)
				: toCamelCase(cleanFileName);

			// Generate unique import alias using full path
			const importAlias = basePath
				? toPascalCase(`${basePath.replace(/\//g, '_')}_${cleanFileName}_Module`)
				: toPascalCase(`${cleanFileName}_Module`);

			modules.push({
				modulePath,
				propertyName,
				className: importAlias, // Use unique alias as className
				importPath: modulePath,
				type: 'module'
			});			// Check for named exports (like CSRFTokenMiddleware)
			const namedExports = await extractNamedExports(fullPath);
			namedExports.forEach(exportName => {
				// Check if it's a middleware-related export using name patterns
				if (isMiddlewareRelatedName(exportName)) {
					const namedPropertyName = basePath
						? toCamelCase(`${basePath.replace(/\//g, '_')}_${exportName}`)
						: toCamelCase(exportName);
					
					const namedImportAlias = basePath
						? toPascalCase(`${basePath.replace(/\//g, '_')}_${exportName}`)
						: toPascalCase(exportName);

					// Avoid duplicates
					const isDuplicate = modules.some(m => 
						m.propertyName === namedPropertyName || 
						m.className === namedImportAlias
					);

					if (!isDuplicate) {
						modules.push({
							modulePath,
							propertyName: namedPropertyName,
							className: namedImportAlias,
							importPath: modulePath,
							namedExport: exportName,
							type: 'namedMiddleware'
						});
					}
				}
			});} else if (item.isFile() && item.name.endsWith('.middleware.ts')) {
			// Include *.middleware.ts files
			const fileName = path.basename(item.name, '.ts');
			const cleanFileName = fileName.replace('.middleware', ''); // Remove .middleware suffix
			const modulePath = basePath ? `${basePath}/${fileName}` : fileName;

			// Generate property name by converting path to camelCase (without Middleware suffix)
			const propertyName = basePath
				? toCamelCase(`${basePath.replace(/\//g, '_')}_${cleanFileName}`)
				: toCamelCase(cleanFileName);

			// Generate unique import alias using full path
			const importAlias = basePath
				? toPascalCase(`${basePath.replace(/\//g, '_')}_${cleanFileName}_Middleware`)
				: toPascalCase(`${cleanFileName}_Middleware`);

			modules.push({
				modulePath,
				propertyName,
				className: importAlias, // Use unique alias as className
				importPath: modulePath,
				type: 'middleware'
			});		} else if (item.isFile() && item.name.endsWith('.middleware.interface.ts')) {
			// Include *.middleware.interface.ts files for parameter types
			const fileName = path.basename(item.name, '.ts');
			const cleanFileName = fileName.replace('.middleware.interface', ''); // Remove .middleware.interface suffix
			const modulePath = basePath ? `${basePath}/${fileName}` : fileName;
			const fullPath = path.join(dirPath, item.name);

			// Extract actual exported interface names from the file
			const exportedInterfaces = extractExportedInterfaces(fullPath);
			
			// Generate property name matching the corresponding middleware name
			// This should match the middleware property name, not a separate camelCase version
			const middlewarePropertyName = basePath
				? toCamelCase(`${basePath.replace(/\//g, '_')}_${cleanFileName}`)
				: toCamelCase(cleanFileName);

			// Use the first exported interface (assuming one interface per file)
			const actualInterfaceName = exportedInterfaces.length > 0 ? exportedInterfaces[0] : `${toPascalCase(cleanFileName)}MiddlewareParams`;

			modules.push({
				modulePath,
				propertyName: middlewarePropertyName, // This should match the middleware name
				actualInterfaceName,
				importPath: modulePath,
				type: 'middleware-interface'
			});
		}
	}

	return modules;
}

/**
 * Generate TypeScript types for injectable modules
 */
async function generateInjectableTypes() {
	const injectablePath = path.join(process.cwd(), 'src', 'app', 'injectable');

	if (!fs.existsSync(injectablePath)) {
		console.log('Injectable directory not found, creating default types...');
		generateDefaultTypes();
		return;
	}
	// Recursively scan for all TypeScript modules
	const modules = await scanDirectory(injectablePath);
	console.log('Found injectable modules:', modules.filter(m => m.type === 'module').map(m => m.modulePath));
	console.log('Found middleware modules:', modules.filter(m => m.type === 'middleware').map(m => m.modulePath));
	console.log('Found middleware interface modules:', modules.filter(m => m.type === 'middleware-interface').map(m => m.modulePath));

	if (modules.length === 0) {
		generateDefaultTypes();
		return;
	}	// Separate modules, middlewares, named middlewares, and middleware interfaces
	const moduleEntries = modules.filter(m => m.type === 'module');
	const middlewareEntries = modules.filter(m => m.type === 'middleware');
	const namedMiddlewareEntries = modules.filter(m => m.type === 'namedMiddleware');
	const middlewareInterfaceEntries = modules.filter(m => m.type === 'middleware-interface');

	console.log('Found named middleware exports:', namedMiddlewareEntries.map(m => `${m.namedExport} from ${m.modulePath}`));	// Generate import statements
	const imports = modules.map(module => {
		if (module.type === 'middleware-interface') {
			// For interface files, import the actual exported interface name
			const actualInterfaceName = module.actualInterfaceName;
			// Generate dynamic alias name based on the module path and property name
			const pathPrefix = toPascalCase(module.modulePath.replace(/\.middleware\.interface$/, '').replace(/[\/\\]/g, '_'));
			const aliasName = `${pathPrefix}${actualInterfaceName}Type`;
			return `import { ${actualInterfaceName} as ${aliasName} } from '@app/injectable/${module.importPath}';`;
		} else if (module.type === 'namedMiddleware') {
			// For named exports, import the specific named export
			return `import { ${module.namedExport} as ${module.className} } from '@app/injectable/${module.importPath}';`;
		}
		return `import ${module.className} from '@app/injectable/${module.importPath}';`;
	}).join('\n');
	// Generate module type definitions
	const moduleTypes = moduleEntries.map(module => {
		return `type ${module.className}Type = InstanceType<typeof ${module.className}>;`;
	}).join('\n');	// Generate middleware type definitions (middlewares are functions, not classes)
	const middlewareTypes = middlewareEntries.map(middleware => {
		return `type ${middleware.className}Type = ReturnType<typeof ${middleware.className}>;`;
	}).join('\n');

	// Generate named middleware type definitions
	const namedMiddlewareTypes = namedMiddlewareEntries.map(middleware => {
		return `type ${middleware.className}Type = typeof ${middleware.className};`;
	}).join('\n');// Generate middleware parameter type definitions
	const middlewareParamTypes = middlewareInterfaceEntries.map(middlewareInterface => {
		// Generate dynamic alias name based on the module path and property name
		const pathPrefix = toPascalCase(middlewareInterface.modulePath.replace(/\.middleware\.interface$/, '').replace(/[\/\\]/g, '_'));
		const aliasName = `${pathPrefix}${middlewareInterface.actualInterfaceName}Type`;
		return `type ${middlewareInterface.propertyName}MiddlewareParamsType = ${aliasName};`;
	}).join('\n');
	// Combine all type definitions
	const allTypes = [moduleTypes, middlewareTypes, namedMiddlewareTypes, middlewareParamTypes].filter(t => t).join('\n');

	// Generate Injectable interface for modules
	const injectableProperties = moduleEntries.map(module =>
		`  ${module.propertyName}: ${module.className}Type;`
	).join('\n');	// Generate Middleware interface for middlewares
	const middlewareProperties = middlewareEntries.concat(namedMiddlewareEntries).map(middleware =>
		`  ${middleware.propertyName}: ${middleware.className}Type;`
	).join('\n');
	// Generate MiddlewareParams interface for middleware parameters
	const middlewareParamProperties = middlewareInterfaceEntries.map(middlewareInterface =>
		`  ${middlewareInterface.propertyName}: ${middlewareInterface.propertyName}MiddlewareParamsType;`
	).join('\n');

	// Ensure MiddlewareParams interface is always present (even if empty)
	const middlewareParamsInterface = middlewareParamProperties 
		? `// Middleware parameters interface
export interface MiddlewareParams {
${middlewareParamProperties}
}`
		: `// Middleware parameters interface (empty - no middleware interfaces found)
export interface MiddlewareParams {
  // No middleware parameter interfaces found
  // Add *.middleware.interface.ts files to src/app/injectable/ and regenerate types
}`;

	// Generate module registry for runtime loading
	const moduleRegistry = moduleEntries.map(module =>
		`  '${module.propertyName}': () => import('@app/injectable/${module.importPath}'),`
	).join('\n');
	// Generate middleware registry for runtime loading
	const middlewareRegistry = middlewareEntries.concat(namedMiddlewareEntries).map(middleware =>
		`  '${middleware.propertyName}': () => import('@app/injectable/${middleware.importPath}'),`
	).join('\n');

	// Generate middleware to parameter mapping
	const middlewareParamMapping = {};
	middlewareEntries.forEach(middleware => {
		// Find matching parameter interface for this middleware
		const matchingParam = middlewareInterfaceEntries.find(paramInterface => {
			// Check if the base path matches (without the .middleware/.middleware.interface suffix)
			const middlewareBasePath = middleware.modulePath.replace(/\.middleware$/, '');
			const paramBasePath = paramInterface.modulePath.replace(/\.middleware\.interface$/, '');
			
			// Extract directory and compare
			const middlewareDir = middlewareBasePath.substring(0, middlewareBasePath.lastIndexOf('/'));
			const paramDir = paramBasePath.substring(0, paramBasePath.lastIndexOf('/'));
			
			return middlewareDir === paramDir;
		});
		
		if (matchingParam) {
			middlewareParamMapping[middleware.propertyName] = matchingParam.propertyName;
		}
	});

	// Generate middleware parameter mapping export (always present)
	const middlewareParamMappingExport = Object.entries(middlewareParamMapping).length > 0
		? Object.entries(middlewareParamMapping)
			.map(([middlewareName, paramName]) => `  '${middlewareName}': '${paramName}',`)
			.join('\n')
		: '  // No middleware parameter mappings found';

	const typeDefinition = `// Auto-generated file - DO NOT EDIT MANUALLY
// Source: src/app/injectable/

${imports}

// Type definitions
${allTypes}

// Injectable modules interface
export interface Injectable {
${injectableProperties}
}

// Middleware interface
export interface Middleware {
${middlewareProperties}
}

${middlewareParamsInterface}

// Module registry for dynamic loading
export const MODULE_REGISTRY = {
${moduleRegistry}
} as const;

// Middleware registry for dynamic loading
export const MIDDLEWARE_REGISTRY = {
${middlewareRegistry}
} as const;

// Middleware parameter mapping
export const MIDDLEWARE_PARAM_MAPPING = {
${middlewareParamMappingExport}
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
function generateDefaultTypes() {	const typeDefinition = `// Auto-generated file - DO NOT EDIT MANUALLY
// Generated on: ${new Date().toISOString()}
// Source: src/app/injectable/

// Injectable modules interface (empty - no modules found)
export interface Injectable {
  // No injectable modules found
  // Add TypeScript files to src/app/injectable/ and regenerate types
}

// Middleware interface (empty - no middlewares found)
export interface Middleware {
  // No middleware modules found
  // Add *.middleware.ts files to src/app/injectable/ and regenerate types
}

// Middleware parameters interface (empty - no middleware interfaces found)
export interface MiddlewareParams {
  // No middleware parameter interfaces found
  // Add *.middleware.interface.ts files to src/app/injectable/ and regenerate types
}

// Module registry for dynamic loading (empty)
export const MODULE_REGISTRY = {
  // No modules available
} as const;

// Middleware registry for dynamic loading (empty)
export const MIDDLEWARE_REGISTRY = {
  // No middlewares available
} as const;

// Middleware parameter mapping (empty)
export const MIDDLEWARE_PARAM_MAPPING = {
  // No middleware parameter mappings found
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



// Run the generator
if (require.main === module) {
	(async () => {
		try {
			await generateInjectableTypes();
			console.log('Injectable types generation completed successfully!');
		} catch (error) {
			console.error('Error generating injectable types:', error);
			process.exit(1);
		}
	})();
}

module.exports = { generateInjectableTypes };