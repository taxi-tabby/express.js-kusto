const fs = require('fs');
const path = require('path');

/**
 * Analyze word characteristics to determine if it's likely an acronym
 */
function analyzeWordType(word) {
	const cleanWord = word.trim();
	if (!cleanWord) return 'normal';

	const lowerWord = cleanWord.toLowerCase();
	const length = cleanWord.length;

	// Calculate vowel/consonant ratio
	const vowels = lowerWord.match(/[aeiou]/g) || [];
	const vowelCount = vowels.length;
	const consonantCount = length - vowelCount;
	const vowelRatio = vowelCount / length;

	// Calculate letter frequency patterns
	const letterFreq = {};
	for (let char of lowerWord) {
		letterFreq[char] = (letterFreq[char] || 0) + 1;
	}
	const uniqueLetters = Object.keys(letterFreq).length;
	const repetitionRatio = uniqueLetters / length;

	// Scoring system for acronym likelihood
	let acronymScore = 0;

	// Length factor: shorter words more likely to be acronyms
	if (length <= 2) acronymScore += 3;
	else if (length <= 4) acronymScore += 2;
	else if (length <= 6) acronymScore += 1;

	// All uppercase pattern
	if (/^[A-Z]+$/.test(cleanWord)) acronymScore += 3;

	// Low vowel ratio (consonant heavy)
	if (vowelRatio < 0.2) acronymScore += 2;
	else if (vowelRatio < 0.3) acronymScore += 1;

	// High repetition (like "www", "ssl")
	if (repetitionRatio < 0.5) acronymScore += 2;

	// No vowels at all
	if (vowelCount === 0 && length > 1) acronymScore += 2;

	// Consecutive consonants pattern
	const consecutiveConsonants = lowerWord.match(/[bcdfghjklmnpqrstvwxyz]{2,}/g);
	if (consecutiveConsonants && consecutiveConsonants.length > 0) {
		acronymScore += 1;
	}

	// Mixed case indicating compound word (should be split)
	if (/^[A-Z][a-z]+[A-Z]/.test(cleanWord)) {
		return 'compound';
	}

	// Determine type based on score
	if (acronymScore >= 4) return 'acronym';
	if (acronymScore >= 2 && length <= 4) return 'acronym';

	return 'normal';
}

// /**
//  * Check if a word should be treated as an acronym based on its characteristics
//  */
// function isAcronym(word) {
//   const wordType = analyzeWordType(word);
//   return wordType === 'acronym';
// }

/**
 * Smart word splitting that handles camelCase and various delimiters
 */
function smartSplit(str) {
	return str
		// First split by explicit delimiters
		.split(/[-_\s/\.]+/)
		.flatMap(part => {
			// Handle compound words (like "WebToken" -> ["Web", "Token"])
			if (analyzeWordType(part) === 'compound') {
				return part.split(/(?=[A-Z])/).filter(word => word.length > 0);
			}
			// For other camelCase boundaries
			return part.split(/(?=[A-Z])/).filter(word => word.length > 0);
		})
		.filter(word => word.length > 0);
}

/**
 * Convert string to camelCase with intelligent word recognition
 */
function toCamelCase(str) {
	const words = smartSplit(str);

	return words
		.map((word, index) => {
			const cleanWord = word.trim();
			if (!cleanWord) return '';

			const wordType = analyzeWordType(cleanWord);

			if (index === 0) {
				// First word: always lowercase unless it's a very short acronym
				if (wordType === 'acronym' && cleanWord.length <= 3) {
					return cleanWord.toLowerCase();
				}
				return cleanWord.toLowerCase();
			} else {
				// Subsequent words: capitalize or keep as acronym
				if (wordType === 'acronym') {
					return cleanWord.toUpperCase();
				}
				return cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1).toLowerCase();
			}
		})
		.join('');
}

/**
 * Convert string to PascalCase with intelligent word recognition
 */
function toPascalCase(str) {
	const words = smartSplit(str);

	return words
		.map(word => {
			const cleanWord = word.trim();
			if (!cleanWord) return '';

			const wordType = analyzeWordType(cleanWord);

			if (wordType === 'acronym') {
				return cleanWord.toUpperCase();
			}
			return cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1).toLowerCase();
		})
		.join('');
}

/**
 * Recursively scan directory for TypeScript files
 */
function scanDirectory(dirPath, basePath = '', modules = []) {
	if (!fs.existsSync(dirPath)) {
		return modules;
	}

	const items = fs.readdirSync(dirPath, { withFileTypes: true });

	for (const item of items) {
		const itemPath = path.join(dirPath, item.name);
		const relativePath = basePath ? `${basePath}/${item.name}` : item.name;

		if (item.isDirectory()) {
			// Recursively scan subdirectories
			scanDirectory(itemPath, relativePath, modules);		} else if (item.isFile() && item.name.endsWith('.module.ts')) {
			// Only include *.module.ts files
			const fileName = path.basename(item.name, '.ts');
			const cleanFileName = fileName.replace('.module', ''); // Remove .module suffix
			const modulePath = basePath ? `${basePath}/${fileName}` : fileName;

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
				importPath: modulePath
			});
		}
	}

	return modules;
}

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

	// Recursively scan for all TypeScript modules
	const modules = scanDirectory(injectablePath);

	console.log('Found injectable modules:', modules.map(m => m.modulePath));

	if (modules.length === 0) {
		generateDefaultTypes();
		return;
	}

	// Generate import statements
	const imports = modules.map(module =>
		`import ${module.className} from '@app/injectable/${module.importPath}';`
	).join('\n');

	// Generate module type definitions
	const moduleTypes = modules.map(module => {
		return `type ${module.className}Type = InstanceType<typeof ${module.className}>;`;
	}).join('\n');

	// Generate Injectable interface
	const injectableProperties = modules.map(module =>
		`  ${module.propertyName}: ${module.className}Type;`
	).join('\n');

	// Generate module registry for runtime loading
	const moduleRegistry = modules.map(module =>
		`  '${module.propertyName}': () => import('@app/injectable/${module.importPath}'),`
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