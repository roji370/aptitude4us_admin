/**
 * Utility functions for generating and validating safe IDs
 * that avoid confusing characters like 'l' vs 'I', '0' vs 'O'
 */

/**
 * Generates a random ID using only unambiguous characters
 * Avoids: 0/O, 1/l/I, etc.
 * 
 * @param length The length of the ID to generate (default: 20)
 * @returns A random, safe ID string
 */
export function generateSafeId(length: number = 20): string {
  // Use only unambiguous characters
  const safeChars = 'abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let result = '';
  
  // Create a Uint32Array of the required length
  const randomValues = new Uint32Array(length);
  
  // Fill with random values
  window.crypto.getRandomValues(randomValues);
  
  // Convert random values to characters from our safe set
  for (let i = 0; i < length; i++) {
    result += safeChars[randomValues[i] % safeChars.length];
  }
  
  return result;
}

/**
 * Validate if an ID contains any ambiguous characters
 * 
 * @param id The ID to validate
 * @returns Object with validation result
 */
export function validateId(id: string): { valid: boolean; message?: string } {
  // Check for ambiguous characters
  const ambiguousChars = /[0O1lI]/g;
  
  if (ambiguousChars.test(id)) {
    // Find which ambiguous characters are present
    const matches = id.match(ambiguousChars) || [];
    const uniqueMatches = [...new Set(matches)];
    
    return {
      valid: false,
      message: `ID contains ambiguous characters: ${uniqueMatches.join(', ')}. Consider using different characters to avoid confusion.`
    };
  }
  
  return { valid: true };
}

/**
 * Generates a courseId prefix based on the category
 * 
 * @param category The course category
 * @returns A short prefix for course IDs
 */
export function generateCoursePrefix(category: string): string {
  // Map common categories to short prefixes
  const categoryPrefixes: {[key: string]: string} = {
    'Mathematics': 'MATH',
    'Science': 'SCI',
    'English': 'ENG',
    'History': 'HIST',
    'Programming': 'PROG',
    'Art': 'ART',
    'Music': 'MUS',
    'General': 'GEN'
  };
  
  // Use the mapping or create an abbreviation from the first 3-4 letters
  const prefix = categoryPrefixes[category] || 
    category.substring(0, Math.min(4, category.length)).toUpperCase();
  
  return prefix;
}

/**
 * Generates a structured, human-readable course ID
 * Format: PREFIX-TIMESTAMP-RANDOMCHARS
 * Example: MATH-2506-X4Kq
 * 
 * @param category The course category
 * @returns A structured course ID
 */
export function generateStructuredCourseId(category: string): string {
  const prefix = generateCoursePrefix(category);
  
  // Get date code (MMDD format)
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateCode = month + day;
  
  // Generate 4 random characters
  const randomPart = generateSafeId(4);
  
  // Combine into structured ID
  return `${prefix}-${dateCode}-${randomPart}`;
} 