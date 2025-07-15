/**
 * Camel case conversion utilities with intelligent word recognition
 */

/**
 * Analyze word characteristics to determine if it's likely an acronym
 */
function analyzeWordType(word) {
	const cleanWord = word.trim();
	if (!cleanWord) return 'normal';

	// Mixed case indicating compound word (should be split)
	if (/^[A-Z][a-z]+[A-Z]/.test(cleanWord)) {
		return 'compound';
	}

	// All uppercase and more than 1 character is likely an acronym
	if (/^[A-Z]{2,}$/.test(cleanWord)) {
		return 'acronym';
	}

	// Dynamic acronym detection based on linguistic characteristics
	const lowerWord = cleanWord.toLowerCase();
	const length = cleanWord.length;

	// Calculate vowel ratio and patterns
	const vowels = lowerWord.match(/[aeiou]/g) || [];
	const vowelRatio = vowels.length / length;
	const consonants = lowerWord.match(/[bcdfghjklmnpqrstvwxyz]/g) || [];
	
	// Find consecutive consonant clusters
	const consecutiveConsonants = lowerWord.match(/[bcdfghjklmnpqrstvwxyz]{2,}/g) || [];
	const maxConsonantCluster = consecutiveConsonants.length > 0 
		? Math.max(...consecutiveConsonants.map(c => c.length)) 
		: 0;

	// Analyze letter patterns
	const hasRepeatedLetters = /(.)\1/.test(lowerWord);
	const hasUncommonEnding = /[bcdfghjklmnpqrstvwxyz]$/.test(lowerWord);
	
	// Calculate pronounceability score (higher = more pronounceable = less likely acronym)
	let pronounceabilityScore = 0;
	
	// Vowel distribution scoring
	if (vowelRatio >= 0.3) pronounceabilityScore += 3; // Good vowel ratio
	else if (vowelRatio >= 0.2) pronounceabilityScore += 1; // Acceptable vowel ratio
	
	// Consonant cluster penalty
	if (maxConsonantCluster >= 4) pronounceabilityScore -= 3; // Very hard to pronounce
	else if (maxConsonantCluster >= 3) pronounceabilityScore -= 2; // Hard to pronounce
	else if (maxConsonantCluster >= 2) pronounceabilityScore -= 1; // Slightly hard
	
	// Length-based adjustments
	if (length <= 3) {
		// Very short words - need stronger signals for acronym
		if (vowelRatio === 0) pronounceabilityScore -= 4; // No vowels = likely acronym
		if (hasRepeatedLetters) pronounceabilityScore -= 2; // "css", "www" pattern
	} else if (length === 4) {
		// 4-letter words - moderate threshold
		if (vowelRatio === 0) pronounceabilityScore -= 3;
		if (vowelRatio <= 0.15) pronounceabilityScore -= 2;
	} else {
		// Longer words - require very strong signals
		if (vowelRatio === 0) pronounceabilityScore -= 2;
		if (vowelRatio <= 0.1) pronounceabilityScore -= 1;
	}
	
	// Common letter patterns that suggest real words
	if (/^(.*[aeiou].*[aeiou].*)$/.test(lowerWord)) pronounceabilityScore += 1; // Multiple vowels spread out
	if (/^[aeiou]/.test(lowerWord)) pronounceabilityScore += 1; // Starts with vowel
	if (/[aeiou]$/.test(lowerWord)) pronounceabilityScore += 1; // Ends with vowel
	if (!/[bcdfghjklmnpqrstvwxyz]{3,}/.test(lowerWord)) pronounceabilityScore += 1; // No 3+ consonant clusters
	
	// Letter frequency analysis (common English letter patterns)
	const commonInitials = /^[a-z]/; // Any letter can start a word
	const uncommonCombos = /[qx][^u]|[cg][^h]z|[pbk][gb]|[jw][jw]/;
	if (uncommonCombos.test(lowerWord)) pronounceabilityScore -= 1;
	
	// Final decision: if pronounceability score is very low, it's likely an acronym
	if (pronounceabilityScore <= -2) {
		return 'acronym';
	}

	// Everything else is normal
	return 'normal';
}

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

			if (index === 0) {
				// First word: always lowercase
				return cleanWord.toLowerCase();
			} else {
				// Subsequent words: capitalize first letter, lowercase rest
				// This ensures consistent camelCase formatting regardless of acronym detection
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

module.exports = {
	analyzeWordType,
	smartSplit,
	toCamelCase,
	toPascalCase
};
