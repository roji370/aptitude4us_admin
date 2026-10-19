# ID Naming Conventions for Admin Platform

This document outlines the standard naming conventions for IDs used throughout the platform. Following these guidelines will improve readability, avoid confusion, and prevent bugs like the case-sensitive path issues.

## Course IDs

Course IDs now follow a structured format: `PREFIX-MMDD-XXXX`

- **PREFIX**: A category identifier (e.g., MATH, SCI, ENG)
- **MMDD**: Month and day of creation (e.g., 0615)
- **XXXX**: Random safe characters

Example: `MATH-0615-Xy3j`

### Safe Characters

To avoid confusion between characters that look similar, we avoid:
- Lowercase 'l' vs. uppercase 'I'
- Number '0' vs. uppercase 'O'
- Number '1' vs. lowercase 'l'

The system automatically generates IDs using a limited safe character set.

## Module IDs 

Module IDs follow a similar format: `MOD-PREFIX-XXXXXXXX`

- **MOD**: Static prefix indicating a module
- **PREFIX**: Inherited from the parent course (e.g., MATH)
- **XXXXXXXX**: Random safe characters

Example: `MOD-MATH-aB45cD7e`

## Content File IDs and Paths

Content files (PDFs, videos, etc.) use a standardized format for both storage paths and IDs:

### File Names in Storage
Format: `{type}_{timestamp}_{safeId}_{sanitized_title}.{extension}`

- **type**: The content type (video, pdf, note)
- **timestamp**: Unix timestamp for ordering
- **safeId**: Random safe characters (6 characters)
- **sanitized_title**: The title with only alphanumerics and underscores
- **extension**: Original file extension

Example: `pdf_1623789456_Xy3jQm_introduction_to_calculus.pdf`

### Content IDs in Database
Format: `{type}-{safeId}-{timestamp}`

- **type**: The content type (video, pdf, note)
- **safeId**: Random safe characters
- **timestamp**: Unix timestamp for uniqueness

Example: `pdf-Xy3jQm-1623789456`

### Thumbnail Files
Format: `thumbnail_{courseId}_{safeId}_{timestamp}.{extension}`

Example: `thumbnail_MATH-0615-Xy3j_aB45cD_1623789456.jpg`

## ID Generation

For all new entities, we use the ID generation utilities in `src/utils/idGenerator.ts`:

```typescript
// Generate a course ID
const courseId = generateStructuredCourseId('Mathematics');
// Result: MATH-0615-Xy3j

// Generate a safe random ID
const safeId = generateSafeId(10);
// Result: j4pA7mQh3T
```

## Validation

When displaying IDs to users, consider showing validation warnings if they contain potentially confusing characters:

```typescript
const validation = validateId(id);
if (!validation.valid) {
  // Show warning
  console.warn(validation.message);
}
```

## Best Practices

1. **Never hardcode IDs** in the application code
2. **Always use the ID generation utilities** for new entities
3. **Present IDs in a readable format** in the UI, possibly with appropriate spacing or formatting
4. **For existing IDs with confusing characters**, consider updating them through a migration process
5. **When displaying IDs**, use a font that clearly distinguishes between similar-looking characters
6. **For content files**, avoid special characters in file paths to prevent URL encoding issues

## Cross-platform Considerations

Both the admin app and student app should use exact ID matching. If case insensitivity is needed:

1. Use the Firebase security rules for storage paths as a fallback (already implemented)
2. Consider using lowercase IDs for path generation and comparisons
3. Add validation in the admin app to prevent creating IDs with ambiguous characters

## Exceptions

For user-generated IDs or imported content, use the validation utilities to alert users about potentially confusing IDs. 