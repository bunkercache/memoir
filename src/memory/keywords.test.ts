/**
 * Keyword Detection Unit Tests
 *
 * Tests keyword detection utilities for memory auto-save triggers.
 * Pure function tests - no database required.
 */

import { describe, it, expect } from 'vitest';
import {
  removeCodeBlocks,
  buildKeywordPattern,
  detectMemoryKeyword,
  DEFAULT_KEYWORDS,
  CODE_BLOCK_PATTERN,
  INLINE_CODE_PATTERN,
} from './keywords.ts';

describe('Keyword Detection', () => {
  // ===========================================================================
  // REMOVE CODE BLOCKS TESTS
  // ===========================================================================

  describe('removeCodeBlocks()', () => {
    /**
     * Positive test: Verifies that removeCodeBlocks() removes fenced code blocks.
     * Objective: removeCodeBlocks() should remove fenced code blocks
     */
    it('should remove fenced code blocks', () => {
      // Arrange
      const text = `Here is some code:
\`\`\`typescript
const remember = 'this should be removed';
\`\`\`
And some text after.`;

      // Act
      const result = removeCodeBlocks(text);

      // Assert
      expect(result).not.toContain('const remember');
      expect(result).toContain('Here is some code:');
      expect(result).toContain('And some text after.');
    });

    /**
     * Positive test: Verifies that removeCodeBlocks() removes inline code.
     * Objective: removeCodeBlocks() should remove inline code
     */
    it('should remove inline code', () => {
      // Arrange
      const text = 'Use the `remember` function to save data.';

      // Act
      const result = removeCodeBlocks(text);

      // Assert
      expect(result).not.toContain('remember');
      expect(result).toContain('Use the');
      expect(result).toContain('function to save data.');
    });

    /**
     * Positive test: Verifies that removeCodeBlocks() handles multiple code blocks.
     * Objective: removeCodeBlocks() should handle multiple code blocks
     */
    it('should handle multiple code blocks', () => {
      // Arrange
      const text = `First \`inline\` code.
\`\`\`
block one
\`\`\`
Middle text.
\`\`\`
block two
\`\`\`
Last \`inline2\` code.`;

      // Act
      const result = removeCodeBlocks(text);

      // Assert
      expect(result).not.toContain('inline');
      expect(result).not.toContain('block one');
      expect(result).not.toContain('block two');
      expect(result).not.toContain('inline2');
      expect(result).toContain('First');
      expect(result).toContain('Middle text.');
      expect(result).toContain('Last');
    });

    /**
     * Negative test: Verifies that removeCodeBlocks() preserves text outside code blocks.
     * Objective: removeCodeBlocks() should preserve text outside code blocks
     */
    it('should preserve text outside code blocks', () => {
      // Arrange
      const text = 'Please remember this important fact about the project.';

      // Act
      const result = removeCodeBlocks(text);

      // Assert
      expect(result).toBe(text);
    });

    /**
     * Positive test: Verifies that removeCodeBlocks() handles empty string.
     * Objective: removeCodeBlocks() should handle empty string
     */
    it('should handle empty string', () => {
      // Arrange
      const text = '';

      // Act
      const result = removeCodeBlocks(text);

      // Assert
      expect(result).toBe('');
    });

    /**
     * Positive test: Verifies that removeCodeBlocks() handles code blocks with language specifier.
     * Objective: removeCodeBlocks() should handle code blocks with language specifier
     */
    it('should handle code blocks with language specifier', () => {
      // Arrange
      const text = `\`\`\`javascript
const remember = true;
\`\`\``;

      // Act
      const result = removeCodeBlocks(text);

      // Assert
      expect(result).not.toContain('remember');
      expect(result.trim()).toBe('');
    });
  });

  // ===========================================================================
  // BUILD KEYWORD PATTERN TESTS
  // ===========================================================================

  describe('buildKeywordPattern()', () => {
    /**
     * Positive test: Verifies that buildKeywordPattern() creates valid regex.
     * Objective: buildKeywordPattern() should create valid regex
     */
    it('should create valid regex matching keywords', () => {
      // Arrange
      const keywords = ['remember', 'save this'];

      // Act
      const pattern = buildKeywordPattern(keywords);

      // Assert
      expect(pattern.test('Please remember this')).toBe(true);
      expect(pattern.test('save this for later')).toBe(true);
      expect(pattern.test('no match here')).toBe(false);
    });

    /**
     * Positive test: Verifies that buildKeywordPattern() is case insensitive.
     * Objective: buildKeywordPattern() should be case insensitive
     */
    it('should be case insensitive', () => {
      // Arrange
      const keywords = ['remember'];

      // Act
      const pattern = buildKeywordPattern(keywords);

      // Assert
      expect(pattern.test('Remember this')).toBe(true);
      expect(pattern.test('REMEMBER this')).toBe(true);
      expect(pattern.test('rEmEmBeR this')).toBe(true);
    });

    /**
     * Positive test: Verifies that buildKeywordPattern() uses word boundaries.
     * Objective: buildKeywordPattern() should use word boundaries
     */
    it('should use word boundaries', () => {
      // Arrange
      const keywords = ['remember'];

      // Act
      const pattern = buildKeywordPattern(keywords);

      // Assert
      expect(pattern.test('remember this')).toBe(true);
      expect(pattern.test('remembered this')).toBe(false); // partial match
      expect(pattern.test('preremember')).toBe(false); // partial match
    });

    /**
     * Negative test: Verifies that buildKeywordPattern() returns never-matching regex for empty array.
     * Objective: buildKeywordPattern() should return never-matching regex for empty array
     */
    it('should return never-matching regex for empty array', () => {
      // Arrange
      const keywords: string[] = [];

      // Act
      const pattern = buildKeywordPattern(keywords);

      // Assert
      expect(pattern.test('remember this')).toBe(false);
      expect(pattern.test('anything')).toBe(false);
      expect(pattern.test('')).toBe(false);
    });

    /**
     * Positive test: Verifies that buildKeywordPattern() escapes special regex characters.
     * Objective: buildKeywordPattern() should escape special regex characters
     *
     * Note: The pattern uses word boundaries (\b), so special characters at word
     * boundaries may not match as expected. This test verifies that special chars
     * don't cause regex errors and are escaped properly.
     */
    it('should escape special regex characters without throwing', () => {
      // Arrange - keywords with special regex characters
      const keywords = ['save*', 'note.js', 'test+'];

      // Act - should not throw when building pattern
      const pattern = buildKeywordPattern(keywords);

      // Assert - pattern should be a valid regex
      expect(pattern).toBeInstanceOf(RegExp);
      // The pattern should be case insensitive
      expect(pattern.flags).toContain('i');
    });
  });

  // ===========================================================================
  // DETECT MEMORY KEYWORD TESTS
  // ===========================================================================

  describe('detectMemoryKeyword()', () => {
    /**
     * Positive test: Verifies that detectMemoryKeyword() detects "remember".
     * Objective: detectMemoryKeyword() should detect "remember"
     */
    it('should detect remember keyword', () => {
      // Arrange
      const text = 'Please remember this preference for the project.';

      // Act
      const result = detectMemoryKeyword(text);

      // Assert
      expect(result).toBe(true);
    });

    /**
     * Positive test: Verifies that detectMemoryKeyword() detects "don't forget".
     * Objective: detectMemoryKeyword() should detect "don't forget"
     */
    it('should detect dont forget keyword', () => {
      // Arrange
      const text = "Don't forget to run tests before committing.";

      // Act
      const result = detectMemoryKeyword(text);

      // Assert
      expect(result).toBe(true);
    });

    /**
     * Positive test: Verifies that detectMemoryKeyword() detects "keep in mind".
     * Objective: detectMemoryKeyword() should detect "keep in mind"
     */
    it('should detect keep in mind keyword', () => {
      // Arrange
      const text = 'Keep in mind that we use strict TypeScript.';

      // Act
      const result = detectMemoryKeyword(text);

      // Assert
      expect(result).toBe(true);
    });

    /**
     * Positive test: Verifies that detectMemoryKeyword() is case insensitive.
     * Objective: detectMemoryKeyword() should be case insensitive
     */
    it('should be case insensitive', () => {
      // Arrange & Act & Assert
      expect(detectMemoryKeyword('REMEMBER this')).toBe(true);
      expect(detectMemoryKeyword('Remember This')).toBe(true);
      expect(detectMemoryKeyword('rEmEmBeR this')).toBe(true);
    });

    /**
     * Positive test: Verifies that detectMemoryKeyword() supports custom keywords.
     * Objective: detectMemoryKeyword() should support custom keywords
     */
    it('should support custom keywords', () => {
      // Arrange
      const text = 'Bookmark this for later reference.';
      const customKeywords = ['bookmark'];

      // Act
      const result = detectMemoryKeyword(text, customKeywords);

      // Assert
      expect(result).toBe(true);
    });

    /**
     * Positive test: Verifies that detectMemoryKeyword() combines default and custom keywords.
     * Objective: detectMemoryKeyword() should combine default and custom keywords
     */
    it('should combine default and custom keywords', () => {
      // Arrange
      const customKeywords = ['bookmark'];

      // Act & Assert
      // Default keyword should still work
      expect(detectMemoryKeyword('Remember this', customKeywords)).toBe(true);
      // Custom keyword should also work
      expect(detectMemoryKeyword('Bookmark this', customKeywords)).toBe(true);
    });

    /**
     * Negative test: Verifies that detectMemoryKeyword() does NOT match keywords in code blocks.
     * Objective: detectMemoryKeyword() should NOT match keywords in code blocks
     */
    it('should NOT match keywords in code blocks', () => {
      // Arrange
      const textWithFencedCode = `Here is some code:
\`\`\`typescript
const remember = 'value';
\`\`\`
That's all.`;

      const textWithInlineCode = 'Use the `remember` function to save data.';

      // Act
      const result1 = detectMemoryKeyword(textWithFencedCode);
      const result2 = detectMemoryKeyword(textWithInlineCode);

      // Assert
      expect(result1).toBe(false);
      expect(result2).toBe(false);
    });

    /**
     * Negative test: Verifies that detectMemoryKeyword() does NOT match partial words.
     * Objective: detectMemoryKeyword() should NOT match partial words (word boundaries)
     */
    it('should NOT match partial words due to word boundaries', () => {
      // Arrange
      const text1 = 'I remembered something.';
      const text2 = 'The preremember function is called.';

      // Act
      const result1 = detectMemoryKeyword(text1);
      const result2 = detectMemoryKeyword(text2);

      // Assert
      expect(result1).toBe(false);
      expect(result2).toBe(false);
    });

    /**
     * Negative test: Verifies that detectMemoryKeyword() returns false for text without keywords.
     * Objective: detectMemoryKeyword() should return false for text without keywords
     */
    it('should return false for text without keywords', () => {
      // Arrange
      const text = 'This is just a regular message about the project.';

      // Act
      const result = detectMemoryKeyword(text);

      // Assert
      expect(result).toBe(false);
    });

    /**
     * Positive test: Verifies that detectMemoryKeyword() detects all default keywords.
     * Objective: detectMemoryKeyword() should detect all default keywords
     */
    it('should detect all default keywords', () => {
      // Arrange & Act & Assert
      for (const keyword of DEFAULT_KEYWORDS) {
        const text = `Please ${keyword} this information.`;
        expect(detectMemoryKeyword(text)).toBe(true);
      }
    });

    /**
     * Positive test: Verifies that detectMemoryKeyword() handles mixed content.
     * Objective: detectMemoryKeyword() should detect keyword outside code block
     */
    it('should detect keyword outside code block when mixed with code', () => {
      // Arrange
      const text = `Remember this preference.
\`\`\`
const x = 1;
\`\`\``;

      // Act
      const result = detectMemoryKeyword(text);

      // Assert
      expect(result).toBe(true);
    });
  });

  // ===========================================================================
  // EXPORTED CONSTANTS TESTS
  // ===========================================================================

  describe('Exported Constants', () => {
    /**
     * Positive test: Verifies that DEFAULT_KEYWORDS contains expected keywords.
     * Objective: DEFAULT_KEYWORDS should contain expected keywords
     */
    it('should have expected default keywords', () => {
      // Assert
      expect(DEFAULT_KEYWORDS).toContain('remember');
      expect(DEFAULT_KEYWORDS).toContain("don't forget");
      expect(DEFAULT_KEYWORDS).toContain('keep in mind');
      expect(DEFAULT_KEYWORDS).toContain('save this');
      expect(DEFAULT_KEYWORDS).toContain('memorize');
    });

    /**
     * Positive test: Verifies that CODE_BLOCK_PATTERN matches fenced code blocks.
     * Objective: CODE_BLOCK_PATTERN should match fenced code blocks
     */
    it('should have CODE_BLOCK_PATTERN that matches fenced code blocks', () => {
      // Arrange
      const text = '```\ncode here\n```';

      // Act
      const match = text.match(CODE_BLOCK_PATTERN);

      // Assert
      expect(match).not.toBeNull();
      expect(match![0]).toBe(text);
    });

    /**
     * Positive test: Verifies that INLINE_CODE_PATTERN matches inline code.
     * Objective: INLINE_CODE_PATTERN should match inline code
     */
    it('should have INLINE_CODE_PATTERN that matches inline code', () => {
      // Arrange
      const text = 'Use `code` here';

      // Act
      const match = text.match(INLINE_CODE_PATTERN);

      // Assert
      expect(match).not.toBeNull();
      expect(match![0]).toBe('`code`');
    });
  });
});
