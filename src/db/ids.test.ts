/**
 * ID Generation Tests
 *
 * Tests for generateId, generateMemoryId, and generateChunkId functions.
 */

import { describe, it, expect } from 'vitest';
import { generateId, generateMemoryId, generateChunkId } from './ids.ts';

describe('ID Generation', () => {
  // Base62 character set for validation
  const BASE62_REGEX = /^[0-9A-Za-z]+$/;

  describe('generateId', () => {
    /**
     * Positive test: generateId should create IDs with the correct prefix.
     * Objective: Verify that generated IDs start with the specified prefix followed by underscore.
     */
    it('should create IDs with correct prefix', () => {
      // Arrange
      const prefix = 'test';

      // Act
      const id = generateId(prefix);

      // Assert
      expect(id.startsWith('test_')).toBe(true);
    });

    /**
     * Positive test: generateId should create IDs of correct default length.
     * Objective: Verify that IDs have prefix + underscore + 12 random characters by default.
     */
    it('should create IDs of correct default length (prefix + 12 chars)', () => {
      // Arrange
      const prefix = 'mem';

      // Act
      const id = generateId(prefix);

      // Assert
      // Format: prefix_xxxxxxxxxxxx (prefix + underscore + 12 chars)
      expect(id.length).toBe(prefix.length + 1 + 12);
    });

    /**
     * Positive test: generateId should respect custom length parameter.
     * Objective: Verify that the length parameter controls the random portion length.
     */
    it('should respect custom length parameter', () => {
      // Arrange
      const prefix = 'custom';
      const length = 16;

      // Act
      const id = generateId(prefix, length);

      // Assert
      expect(id.length).toBe(prefix.length + 1 + length);
    });

    /**
     * Positive test: generateId should create unique IDs.
     * Objective: Verify that multiple calls produce different IDs.
     */
    it('should create unique IDs', () => {
      // Arrange
      const prefix = 'uniq';
      const ids = new Set<string>();

      // Act - Generate 100 IDs
      for (let i = 0; i < 100; i++) {
        ids.add(generateId(prefix));
      }

      // Assert - All IDs should be unique
      expect(ids.size).toBe(100);
    });

    /**
     * Positive test: generateId should only contain URL-safe base62 characters.
     * Objective: Verify that the random portion only contains alphanumeric characters.
     */
    it('should only contain URL-safe base62 characters', () => {
      // Arrange
      const prefix = 'safe';

      // Act
      const id = generateId(prefix);
      const randomPart = id.slice(prefix.length + 1);

      // Assert
      expect(BASE62_REGEX.test(randomPart)).toBe(true);
    });

    /**
     * Positive test: generateId should work with empty prefix.
     * Objective: Verify that an empty prefix still produces valid IDs.
     */
    it('should work with empty prefix', () => {
      // Arrange
      const prefix = '';

      // Act
      const id = generateId(prefix);

      // Assert
      expect(id.startsWith('_')).toBe(true);
      expect(id.length).toBe(1 + 12); // underscore + 12 chars
    });

    /**
     * Positive test: generateId should work with length of 1.
     * Objective: Verify that minimum length produces valid IDs.
     */
    it('should work with length of 1', () => {
      // Arrange
      const prefix = 'min';
      const length = 1;

      // Act
      const id = generateId(prefix, length);

      // Assert
      expect(id.length).toBe(prefix.length + 1 + 1);
      const randomPart = id.slice(prefix.length + 1);
      expect(BASE62_REGEX.test(randomPart)).toBe(true);
    });

    /**
     * Positive test: generateId should handle long prefixes.
     * Objective: Verify that long prefixes work correctly.
     */
    it('should handle long prefixes', () => {
      // Arrange
      const prefix = 'this_is_a_very_long_prefix';

      // Act
      const id = generateId(prefix);

      // Assert
      expect(id.startsWith(prefix + '_')).toBe(true);
      expect(id.length).toBe(prefix.length + 1 + 12);
    });
  });

  describe('generateMemoryId', () => {
    /**
     * Positive test: generateMemoryId should create IDs with 'mem' prefix.
     * Objective: Verify that memory IDs follow the mem_* format.
     */
    it('should create IDs with mem_ prefix', () => {
      // Act
      const id = generateMemoryId();

      // Assert
      expect(id.startsWith('mem_')).toBe(true);
    });

    /**
     * Positive test: generateMemoryId should create IDs of correct length.
     * Objective: Verify that memory IDs have the expected total length.
     */
    it('should create IDs of correct length', () => {
      // Act
      const id = generateMemoryId();

      // Assert
      // Format: mem_xxxxxxxxxxxx (3 + 1 + 12 = 16)
      expect(id.length).toBe(16);
    });

    /**
     * Positive test: generateMemoryId should create unique IDs.
     * Objective: Verify that multiple memory IDs are unique.
     */
    it('should create unique IDs', () => {
      // Arrange
      const ids = new Set<string>();

      // Act
      for (let i = 0; i < 50; i++) {
        ids.add(generateMemoryId());
      }

      // Assert
      expect(ids.size).toBe(50);
    });

    /**
     * Positive test: generateMemoryId should only contain URL-safe characters.
     * Objective: Verify that memory IDs are URL-safe.
     */
    it('should only contain URL-safe characters', () => {
      // Act
      const id = generateMemoryId();
      const randomPart = id.slice(4); // Skip 'mem_'

      // Assert
      expect(BASE62_REGEX.test(randomPart)).toBe(true);
    });
  });

  describe('generateChunkId', () => {
    /**
     * Positive test: generateChunkId should create IDs with 'ch' prefix.
     * Objective: Verify that chunk IDs follow the ch_* format.
     */
    it('should create IDs with ch_ prefix', () => {
      // Act
      const id = generateChunkId();

      // Assert
      expect(id.startsWith('ch_')).toBe(true);
    });

    /**
     * Positive test: generateChunkId should create IDs of correct length.
     * Objective: Verify that chunk IDs have the expected total length.
     */
    it('should create IDs of correct length', () => {
      // Act
      const id = generateChunkId();

      // Assert
      // Format: ch_xxxxxxxxxxxx (2 + 1 + 12 = 15)
      expect(id.length).toBe(15);
    });

    /**
     * Positive test: generateChunkId should create unique IDs.
     * Objective: Verify that multiple chunk IDs are unique.
     */
    it('should create unique IDs', () => {
      // Arrange
      const ids = new Set<string>();

      // Act
      for (let i = 0; i < 50; i++) {
        ids.add(generateChunkId());
      }

      // Assert
      expect(ids.size).toBe(50);
    });

    /**
     * Positive test: generateChunkId should only contain URL-safe characters.
     * Objective: Verify that chunk IDs are URL-safe.
     */
    it('should only contain URL-safe characters', () => {
      // Act
      const id = generateChunkId();
      const randomPart = id.slice(3); // Skip 'ch_'

      // Assert
      expect(BASE62_REGEX.test(randomPart)).toBe(true);
    });
  });

  describe('ID format consistency', () => {
    /**
     * Positive test: All ID types should follow consistent format.
     * Objective: Verify that all ID generators produce consistent prefix_random format.
     */
    it('should follow consistent prefix_random format', () => {
      // Act
      const memId = generateMemoryId();
      const chunkId = generateChunkId();
      const customId = generateId('custom');

      // Assert - All should have exactly one underscore separating prefix from random
      expect(memId.split('_').length).toBe(2);
      expect(chunkId.split('_').length).toBe(2);
      expect(customId.split('_').length).toBe(2);
    });

    /**
     * Positive test: IDs should be distinguishable by prefix.
     * Objective: Verify that different entity types have different prefixes.
     */
    it('should have distinguishable prefixes for different entity types', () => {
      // Act
      const memId = generateMemoryId();
      const chunkId = generateChunkId();

      // Assert
      expect(memId.startsWith('mem_')).toBe(true);
      expect(chunkId.startsWith('ch_')).toBe(true);
      expect(memId.slice(0, 4)).not.toBe(chunkId.slice(0, 3));
    });
  });
});
