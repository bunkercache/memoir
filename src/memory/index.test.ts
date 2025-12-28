/**
 * MemoryService Unit Tests
 *
 * Tests the high-level MemoryService class and singleton management.
 * Uses a temporary SQLite database for isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseLike } from '../db/index.ts';
import { rmSync } from 'node:fs';
import {
  MemoryService,
  initializeMemoryService,
  getMemoryService,
  resetMemoryService,
} from './index.ts';
import type { ResolvedMemoirConfig } from '../types.ts';
import { DEFAULT_CONFIG } from '../config/defaults.ts';
import { createTestDatabase } from '../db/test-utils.ts';

describe('MemoryService', () => {
  let db: DatabaseLike;
  let tempDir: string;
  let config: ResolvedMemoirConfig;
  let service: MemoryService;

  beforeEach(() => {
    const result = createTestDatabase();
    db = result.db;
    tempDir = result.tempDir;

    // Use default config for most tests
    config = { ...DEFAULT_CONFIG };
    service = new MemoryService(db, config);

    // Reset singleton before each test
    resetMemoryService();
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
    resetMemoryService();
  });

  // ===========================================================================
  // ADD TESTS
  // ===========================================================================

  describe('add()', () => {
    /**
     * Positive test: Verifies that add() creates a memory with correct type.
     * Objective: add() should create a memory
     */
    it('should create a memory with correct type', () => {
      // Arrange
      const content = 'Always use strict TypeScript mode';
      const type = 'preference' as const;

      // Act
      const memory = service.add(content, type);

      // Assert
      expect(memory.id).toMatch(/^mem_/);
      expect(memory.content).toBe(content);
      expect(memory.type).toBe(type);
    });

    /**
     * Positive test: Verifies that add() uses default source 'user'.
     * Objective: add() should use default source 'user'
     */
    it('should use default source user', () => {
      // Arrange
      const content = 'Test memory';
      const type = 'fact' as const;

      // Act
      const memory = service.add(content, type);

      // Assert
      expect(memory.source).toBe('user');
    });

    /**
     * Positive test: Verifies that add() accepts tags and source options.
     * Objective: add() should accept tags and source options
     */
    it('should accept tags and source options', () => {
      // Arrange
      const content = 'Pattern memory';
      const type = 'pattern' as const;
      const options = {
        tags: ['typescript', 'error-handling'],
        source: 'compaction' as const,
      };

      // Act
      const memory = service.add(content, type, options);

      // Assert
      expect(memory.tags).toEqual(['typescript', 'error-handling']);
      expect(memory.source).toBe('compaction');
    });
  });

  // ===========================================================================
  // SEARCH TESTS
  // ===========================================================================

  describe('search()', () => {
    /**
     * Positive test: Verifies that search() delegates to searchMemories.
     * Objective: search() should delegate to searchMemories
     */
    it('should delegate to searchMemories and return results', () => {
      // Arrange
      service.add('TypeScript strict mode is important', 'preference');
      service.add('Use ESLint for linting', 'preference');

      // Act
      const results = service.search('TypeScript');

      // Assert
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].memory.content).toContain('TypeScript');
      expect(typeof results[0].rank).toBe('number');
    });

    /**
     * Positive test: Verifies that search() uses config.memory.maxSearchResults as default limit.
     * Objective: search() should use config limit when not specified
     */
    it('should use config maxSearchResults as default limit', () => {
      // Arrange - create more memories than default limit
      for (let i = 0; i < 25; i++) {
        service.add(`TypeScript memory ${i}`, 'fact');
      }

      // Act - default limit is 20 from DEFAULT_CONFIG
      const results = service.search('TypeScript');

      // Assert
      expect(results.length).toBeLessThanOrEqual(config.memory.maxSearchResults);
    });

    /**
     * Positive test: Verifies that search() respects custom limit option.
     * Objective: search() should respect custom limit option
     */
    it('should respect custom limit option', () => {
      // Arrange
      for (let i = 0; i < 10; i++) {
        service.add(`TypeScript memory ${i}`, 'fact');
      }

      // Act
      const results = service.search('TypeScript', { limit: 3 });

      // Assert
      expect(results).toHaveLength(3);
    });
  });

  // ===========================================================================
  // SEARCH RELEVANT TESTS
  // ===========================================================================

  describe('searchRelevant()', () => {
    /**
     * Positive test: Verifies that searchRelevant() uses config.memory.maxInject.
     * Objective: searchRelevant() should use config.memory.maxInject
     */
    it('should use config maxInject as limit', () => {
      // Arrange - create more memories than maxInject
      for (let i = 0; i < 15; i++) {
        service.add(`TypeScript memory ${i}`, 'fact');
      }

      // Act - maxInject is 10 from DEFAULT_CONFIG
      const memories = service.searchRelevant('TypeScript');

      // Assert
      expect(memories.length).toBeLessThanOrEqual(config.memory.maxInject);
    });

    /**
     * Positive test: Verifies that searchRelevant() returns Memory objects (not SearchResult).
     * Objective: searchRelevant() should return Memory objects
     */
    it('should return Memory objects not SearchResult', () => {
      // Arrange
      service.add('TypeScript is great', 'fact');

      // Act
      const memories = service.searchRelevant('TypeScript');

      // Assert
      expect(memories.length).toBeGreaterThanOrEqual(1);
      expect(memories[0]).toHaveProperty('id');
      expect(memories[0]).toHaveProperty('content');
      expect(memories[0]).not.toHaveProperty('rank');
    });
  });

  // ===========================================================================
  // LIST TESTS
  // ===========================================================================

  describe('list()', () => {
    /**
     * Positive test: Verifies that list() delegates to repository.
     * Objective: list() should delegate to repository
     */
    it('should delegate to repository and return memories', () => {
      // Arrange
      service.add('Memory 1', 'fact');
      service.add('Memory 2', 'preference');

      // Act
      const memories = service.list();

      // Assert
      expect(memories).toHaveLength(2);
    });

    /**
     * Positive test: Verifies that list() respects options.
     * Objective: list() should respect options
     */
    it('should respect list options', () => {
      // Arrange
      service.add('Preference 1', 'preference');
      service.add('Fact 1', 'fact');
      service.add('Preference 2', 'preference');

      // Act
      const preferences = service.list({ type: 'preference' });

      // Assert
      expect(preferences).toHaveLength(2);
      expect(preferences.every((m) => m.type === 'preference')).toBe(true);
    });
  });

  // ===========================================================================
  // GET TESTS
  // ===========================================================================

  describe('get()', () => {
    /**
     * Positive test: Verifies that get() returns memory by ID.
     * Objective: get() should return memory by ID
     */
    it('should return memory by ID', () => {
      // Arrange
      const created = service.add('Test memory', 'fact');

      // Act
      const retrieved = service.get(created.id);

      // Assert
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.content).toBe(created.content);
    });

    /**
     * Negative test: Verifies that get() returns null for non-existent ID.
     * Objective: get() should return null for non-existent ID
     */
    it('should return null for non-existent ID', () => {
      // Arrange
      const nonExistentId = 'mem_nonexistent1';

      // Act
      const result = service.get(nonExistentId);

      // Assert
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // UPDATE TESTS
  // ===========================================================================

  describe('update()', () => {
    /**
     * Positive test: Verifies that update() updates memory.
     * Objective: update() should update memory
     */
    it('should update memory content', () => {
      // Arrange
      const created = service.add('Original content', 'fact');

      // Act
      const updated = service.update(created.id, { content: 'Updated content' });

      // Assert
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe('Updated content');
    });

    /**
     * Negative test: Verifies that update() returns null for non-existent ID.
     * Objective: update() should return null for non-existent ID
     */
    it('should return null for non-existent ID', () => {
      // Arrange
      const nonExistentId = 'mem_nonexistent1';

      // Act
      const result = service.update(nonExistentId, { content: 'New content' });

      // Assert
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // FORGET TESTS
  // ===========================================================================

  describe('forget()', () => {
    /**
     * Positive test: Verifies that forget() deletes memory.
     * Objective: forget() should delete memory
     */
    it('should delete memory and return true', () => {
      // Arrange
      const created = service.add('Memory to delete', 'fact');

      // Act
      const result = service.forget(created.id);

      // Assert
      expect(result).toBe(true);
      expect(service.get(created.id)).toBeNull();
    });

    /**
     * Negative test: Verifies that forget() returns false for non-existent ID.
     * Objective: forget() should return false for non-existent ID
     */
    it('should return false for non-existent ID', () => {
      // Arrange
      const nonExistentId = 'mem_nonexistent1';

      // Act
      const result = service.forget(nonExistentId);

      // Assert
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // DETECT KEYWORD TESTS
  // ===========================================================================

  describe('detectKeyword()', () => {
    /**
     * Positive test: Verifies that detectKeyword() detects keywords when enabled.
     * Objective: detectKeyword() should detect keywords when enabled
     */
    it('should detect keywords when keywordDetection is enabled', () => {
      // Arrange - keywordDetection is true by default
      const text = 'Please remember this preference.';

      // Act
      const result = service.detectKeyword(text);

      // Assert
      expect(result).toBe(true);
    });

    /**
     * Negative test: Verifies that detectKeyword() returns false when disabled.
     * Objective: detectKeyword() should return false when keywordDetection is disabled
     */
    it('should return false when keywordDetection is disabled', () => {
      // Arrange
      const disabledConfig: ResolvedMemoirConfig = {
        ...DEFAULT_CONFIG,
        memory: {
          ...DEFAULT_CONFIG.memory,
          keywordDetection: false,
        },
      };
      const disabledService = new MemoryService(db, disabledConfig);
      const text = 'Please remember this preference.';

      // Act
      const result = disabledService.detectKeyword(text);

      // Assert
      expect(result).toBe(false);
    });

    /**
     * Positive test: Verifies that detectKeyword() uses config.memory.customKeywords.
     * Objective: detectKeyword() should use config.memory.customKeywords
     */
    it('should use config customKeywords', () => {
      // Arrange
      const customConfig: ResolvedMemoirConfig = {
        ...DEFAULT_CONFIG,
        memory: {
          ...DEFAULT_CONFIG.memory,
          customKeywords: ['bookmark'],
        },
      };
      const customService = new MemoryService(db, customConfig);
      const text = 'Bookmark this for later.';

      // Act
      const result = customService.detectKeyword(text);

      // Assert
      expect(result).toBe(true);
    });

    /**
     * Negative test: Verifies that detectKeyword() returns false for text without keywords.
     * Objective: detectKeyword() should return false for text without keywords
     */
    it('should return false for text without keywords', () => {
      // Arrange
      const text = 'This is just a regular message.';

      // Act
      const result = service.detectKeyword(text);

      // Assert
      expect(result).toBe(false);
    });

    /**
     * Positive test: Verifies that detectKeyword() ignores keywords in code blocks.
     * Objective: detectKeyword() should ignore keywords in code blocks
     */
    it('should ignore keywords in code blocks', () => {
      // Arrange
      const text = 'Here is code: `remember` this variable.';

      // Act
      const result = service.detectKeyword(text);

      // Assert
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // SINGLETON MANAGEMENT TESTS
  // ===========================================================================

  describe('Singleton Management', () => {
    /**
     * Positive test: Verifies that initializeMemoryService() creates singleton.
     * Objective: initializeMemoryService() should create singleton
     */
    it('should initialize singleton with initializeMemoryService', () => {
      // Arrange & Act
      const initialized = initializeMemoryService(db, config);

      // Assert
      expect(initialized).toBeInstanceOf(MemoryService);
    });

    /**
     * Positive test: Verifies that getMemoryService() returns the singleton.
     * Objective: getMemoryService() should return the singleton
     */
    it('should return singleton with getMemoryService after initialization', () => {
      // Arrange
      const initialized = initializeMemoryService(db, config);

      // Act
      const retrieved = getMemoryService();

      // Assert
      expect(retrieved).toBe(initialized);
    });

    /**
     * Positive test: Verifies that initializeMemoryService() returns existing instance.
     * Objective: initializeMemoryService() should return existing instance if already initialized
     */
    it('should return existing instance if already initialized', () => {
      // Arrange
      const first = initializeMemoryService(db, config);

      // Act
      const second = initializeMemoryService(db, config);

      // Assert
      expect(second).toBe(first);
    });

    /**
     * Negative test: Verifies that getMemoryService() throws when not initialized.
     * Objective: getMemoryService() should throw when not initialized
     */
    it('should throw when getMemoryService called before initialization', () => {
      // Arrange - resetMemoryService() called in beforeEach

      // Act & Assert
      expect(() => getMemoryService()).toThrow(
        'MemoryService not initialized. Call initializeMemoryService() first.'
      );
    });

    /**
     * Positive test: Verifies that resetMemoryService() clears the singleton.
     * Objective: resetMemoryService() should clear the singleton
     */
    it('should clear singleton with resetMemoryService', () => {
      // Arrange
      initializeMemoryService(db, config);

      // Act
      resetMemoryService();

      // Assert
      expect(() => getMemoryService()).toThrow();
    });

    /**
     * Positive test: Verifies that singleton can be reinitialized after reset.
     * Objective: Singleton should be reinitializable after reset
     */
    it('should allow reinitialization after reset', () => {
      // Arrange
      const first = initializeMemoryService(db, config);
      resetMemoryService();

      // Act
      const second = initializeMemoryService(db, config);

      // Assert
      expect(second).toBeInstanceOf(MemoryService);
      // Use strict reference inequality check to avoid vitest iteration issues
      // with bun:sqlite Statement objects
      expect(first !== second).toBe(true);
    });
  });
});
