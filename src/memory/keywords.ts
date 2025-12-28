/**
 * Keyword Detection for Memory Auto-Save
 *
 * Provides utilities for detecting memory-related keywords in text
 * to trigger automatic memory saving.
 */

/**
 * Default keywords that trigger memory saving.
 * These phrases indicate the user wants something remembered.
 */
export const DEFAULT_KEYWORDS: readonly string[] = [
  'remember',
  'memorize',
  'save this',
  'note this',
  'keep in mind',
  "don't forget",
  'learn this',
  'store this',
  'record this',
  'make a note',
  'take note',
  'jot down',
  'commit to memory',
  'never forget',
  'always remember',
];

/**
 * Pattern to match fenced code blocks (```...```).
 */
export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;

/**
 * Pattern to match inline code (`...`).
 */
export const INLINE_CODE_PATTERN = /`[^`]+`/g;

/**
 * Removes code blocks from text to avoid false keyword matches.
 *
 * Removes both fenced code blocks (```...```) and inline code (`...`)
 * to prevent keywords appearing in code from triggering memory saves.
 *
 * @param text - The text to process
 * @returns The text with code blocks removed
 *
 * @example
 * ```typescript
 * const text = 'Remember to use `remember` in your code';
 * const cleaned = removeCodeBlocks(text);
 * // Result: 'Remember to use  in your code'
 * ```
 */
export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, '').replace(INLINE_CODE_PATTERN, '');
}

/**
 * Builds a regex pattern from an array of keywords.
 *
 * Creates a case-insensitive pattern that matches any of the keywords
 * as whole words (with word boundaries).
 *
 * @param keywords - Array of keywords to match
 * @returns A RegExp that matches any of the keywords
 *
 * @example
 * ```typescript
 * const pattern = buildKeywordPattern(['remember', 'save this']);
 * pattern.test('Please remember this'); // true
 * pattern.test('I remembered it'); // false (word boundary)
 * ```
 */
export function buildKeywordPattern(keywords: string[]): RegExp {
  if (keywords.length === 0) {
    // Return a pattern that never matches
    return /(?!)/;
  }

  // Escape special regex characters in keywords
  const escapedKeywords = keywords.map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  // Build pattern with word boundaries for each keyword
  const pattern = escapedKeywords.map((k) => `\\b${k}\\b`).join('|');

  return new RegExp(pattern, 'i');
}

/**
 * Detects if text contains memory-related keywords.
 *
 * Checks if the text (excluding code blocks) contains any of the
 * default or custom keywords that indicate the user wants something remembered.
 *
 * @param text - The text to check for keywords
 * @param customKeywords - Additional keywords to check (optional)
 * @returns True if any keyword is detected, false otherwise
 *
 * @example
 * ```typescript
 * // Using default keywords
 * detectMemoryKeyword('Please remember this preference'); // true
 * detectMemoryKeyword('This is just a comment'); // false
 *
 * // With custom keywords
 * detectMemoryKeyword('Bookmark this for later', ['bookmark']); // true
 * ```
 */
export function detectMemoryKeyword(text: string, customKeywords?: string[]): boolean {
  // Remove code blocks to avoid false positives
  const cleanedText = removeCodeBlocks(text);

  // Combine default and custom keywords
  const allKeywords = customKeywords
    ? [...DEFAULT_KEYWORDS, ...customKeywords]
    : [...DEFAULT_KEYWORDS];

  // Build and test the pattern
  const pattern = buildKeywordPattern(allKeywords);
  return pattern.test(cleanedText);
}
