/**
 * Memory Search Functions Unit Tests
 *
 * Tests full-text search functionality using SQLite FTS5.
 * Uses a temporary SQLite database for isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseLike } from '../db/index.ts';
import { rmSync } from 'node:fs';
import { MemoryRepository } from './repository.ts';
import { searchMemories, searchByType, getRecentMemories } from './search.ts';
import { createTestDatabase } from '../db/test-utils.ts';

describe('Memory Search Functions', () => {
  let db: DatabaseLike;
  let tempDir: string;
  let repo: MemoryRepository;

  beforeEach(() => {
    const result = createTestDatabase();
    db = result.db;
    tempDir = result.tempDir;
    repo = new MemoryRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // SEARCH MEMORIES TESTS
  // ===========================================================================

  describe('searchMemories()', () => {
    /**
     * Positive test: Verifies that searchMemories() finds memories by content.
     * Objective: searchMemories() should find memories by content
     */
    it('should find memories by content match', () => {
      // Arrange
      repo.create({ content: 'Always use TypeScript strict mode', type: 'preference' });
      repo.create({ content: 'Use ESLint for linting', type: 'preference' });
      repo.create({ content: 'TypeScript is great for type safety', type: 'fact' });

      // Act
      const results = searchMemories(db, 'TypeScript');

      // Assert
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.every((r) => r.memory.content.includes('TypeScript'))).toBe(true);
    });

    /**
     * Positive test: Verifies that searchMemories() ranks results by relevance.
     * Objective: searchMemories() should rank results by relevance
     */
    it('should rank results by relevance using BM25', () => {
      // Arrange
      repo.create({
        content: 'TypeScript TypeScript TypeScript is mentioned multiple times',
        type: 'fact',
      });
      repo.create({
        content: 'TypeScript is mentioned once here',
        type: 'fact',
      });

      // Act
      const results = searchMemories(db, 'TypeScript');

      // Assert
      expect(results.length).toBe(2);
      // BM25 returns negative scores, lower (more negative) is more relevant
      // The first result should have a lower (more negative) rank
      expect(results[0].rank).toBeLessThanOrEqual(results[1].rank);
    });

    /**
     * Positive test: Verifies that searchMemories() respects limit option.
     * Objective: searchMemories() should respect limit option
     */
    it('should respect limit option', () => {
      // Arrange
      repo.create({ content: 'TypeScript preference one', type: 'preference' });
      repo.create({ content: 'TypeScript preference two', type: 'preference' });
      repo.create({ content: 'TypeScript preference three', type: 'preference' });

      // Act
      const results = searchMemories(db, 'TypeScript', { limit: 2 });

      // Assert
      expect(results).toHaveLength(2);
    });

    /**
     * Positive test: Verifies that searchMemories() filters by type.
     * Objective: searchMemories() should filter by type
     */
    it('should filter by type', () => {
      // Arrange
      repo.create({ content: 'TypeScript preference', type: 'preference' });
      repo.create({ content: 'TypeScript fact', type: 'fact' });
      repo.create({ content: 'TypeScript pattern', type: 'pattern' });

      // Act
      const results = searchMemories(db, 'TypeScript', { type: 'preference' });

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].memory.type).toBe('preference');
    });

    /**
     * Negative test: Verifies that searchMemories() returns empty array for no matches.
     * Objective: searchMemories() should return empty array for no matches
     */
    it('should return empty array for no matches', () => {
      // Arrange
      repo.create({ content: 'Something completely different', type: 'fact' });

      // Act
      const results = searchMemories(db, 'nonexistent');

      // Assert
      expect(results).toEqual([]);
    });

    /**
     * Negative test: Verifies that searchMemories() handles special characters safely.
     * Objective: searchMemories() should handle special characters
     */
    it('should handle special characters safely', () => {
      // Arrange
      repo.create({ content: 'Use Result<T, E> for error handling', type: 'pattern' });

      // Act - these special chars should be escaped and not cause errors
      const results1 = searchMemories(db, 'Result<T, E>');
      const results2 = searchMemories(db, '"quoted"');
      const results3 = searchMemories(db, 'test*');
      const results4 = searchMemories(db, '(parentheses)');

      // Assert - should not throw and should return results or empty array
      expect(Array.isArray(results1)).toBe(true);
      expect(Array.isArray(results2)).toBe(true);
      expect(Array.isArray(results3)).toBe(true);
      expect(Array.isArray(results4)).toBe(true);
    });

    /**
     * Negative test: Verifies that searchMemories() returns empty array for empty query.
     * Objective: searchMemories() should return empty array for empty query
     */
    it('should return empty array for empty query', () => {
      // Arrange
      repo.create({ content: 'Some content', type: 'fact' });

      // Act
      const results1 = searchMemories(db, '');
      const results2 = searchMemories(db, '   ');

      // Assert
      expect(results1).toEqual([]);
      expect(results2).toEqual([]);
    });

    /**
     * Positive test: Verifies that searchMemories() finds multi-word queries.
     * Objective: searchMemories() should find memories matching multiple words
     */
    it('should find memories matching multiple words', () => {
      // Arrange
      repo.create({ content: 'Use strict TypeScript mode for safety', type: 'preference' });
      repo.create({ content: 'TypeScript is a language', type: 'fact' });

      // Act
      const results = searchMemories(db, 'strict TypeScript');

      // Assert
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].memory.content).toContain('strict');
      expect(results[0].memory.content).toContain('TypeScript');
    });
  });

  // ===========================================================================
  // SEARCH BY TYPE TESTS
  // ===========================================================================

  describe('searchByType()', () => {
    /**
     * Positive test: Verifies that searchByType() returns only memories of specified type.
     * Objective: searchByType() should return only memories of specified type
     */
    it('should return only memories of specified type', () => {
      // Arrange
      repo.create({ content: 'Preference 1', type: 'preference' });
      repo.create({ content: 'Fact 1', type: 'fact' });
      repo.create({ content: 'Preference 2', type: 'preference' });
      repo.create({ content: 'Pattern 1', type: 'pattern' });

      // Act
      const preferences = searchByType(db, 'preference');

      // Assert
      expect(preferences).toHaveLength(2);
      expect(preferences.every((m) => m.type === 'preference')).toBe(true);
    });

    /**
     * Positive test: Verifies that searchByType() respects limit option.
     * Objective: searchByType() should respect limit option
     */
    it('should respect limit option', () => {
      // Arrange
      repo.create({ content: 'Fact 1', type: 'fact' });
      repo.create({ content: 'Fact 2', type: 'fact' });
      repo.create({ content: 'Fact 3', type: 'fact' });

      // Act
      const facts = searchByType(db, 'fact', { limit: 2 });

      // Assert
      expect(facts).toHaveLength(2);
    });

    /**
     * Negative test: Verifies that searchByType() returns empty array for non-existent type.
     * Objective: searchByType() should return empty array when no memories of type exist
     */
    it('should return empty array when no memories of type exist', () => {
      // Arrange
      repo.create({ content: 'Fact 1', type: 'fact' });

      // Act
      const gotchas = searchByType(db, 'gotcha');

      // Assert
      expect(gotchas).toEqual([]);
    });

    /**
     * Positive test: Verifies that searchByType() returns memories in chronological order.
     * Objective: searchByType() should return memories ordered by createdAt DESC
     */
    it('should return memories ordered by createdAt DESC', () => {
      // Arrange
      const mem1 = repo.create({ content: 'First fact', type: 'fact' });
      const mem2 = repo.create({ content: 'Second fact', type: 'fact' });
      const mem3 = repo.create({ content: 'Third fact', type: 'fact' });

      // Act
      const facts = searchByType(db, 'fact');

      // Assert
      expect(facts[0].id).toBe(mem3.id);
      expect(facts[1].id).toBe(mem2.id);
      expect(facts[2].id).toBe(mem1.id);
    });
  });

  // ===========================================================================
  // GET RECENT MEMORIES TESTS
  // ===========================================================================

  describe('getRecentMemories()', () => {
    /**
     * Positive test: Verifies that getRecentMemories() returns memories in chronological order.
     * Objective: getRecentMemories() should return memories in chronological order
     */
    it('should return memories in chronological order newest first', () => {
      // Arrange
      const mem1 = repo.create({ content: 'First', type: 'fact' });
      const mem2 = repo.create({ content: 'Second', type: 'preference' });
      const mem3 = repo.create({ content: 'Third', type: 'pattern' });

      // Act
      const recent = getRecentMemories(db);

      // Assert
      expect(recent[0].id).toBe(mem3.id);
      expect(recent[1].id).toBe(mem2.id);
      expect(recent[2].id).toBe(mem1.id);
    });

    /**
     * Positive test: Verifies that getRecentMemories() respects limit.
     * Objective: getRecentMemories() should respect limit
     */
    it('should respect limit parameter', () => {
      // Arrange
      repo.create({ content: 'First', type: 'fact' });
      repo.create({ content: 'Second', type: 'fact' });
      repo.create({ content: 'Third', type: 'fact' });
      repo.create({ content: 'Fourth', type: 'fact' });
      repo.create({ content: 'Fifth', type: 'fact' });

      // Act
      const recent = getRecentMemories(db, 3);

      // Assert
      expect(recent).toHaveLength(3);
    });

    /**
     * Positive test: Verifies that getRecentMemories() uses default limit of 10.
     * Objective: getRecentMemories() should use default limit of 10
     */
    it('should use default limit of 10', () => {
      // Arrange - create 15 memories
      for (let i = 0; i < 15; i++) {
        repo.create({ content: `Memory ${i}`, type: 'fact' });
      }

      // Act
      const recent = getRecentMemories(db);

      // Assert
      expect(recent).toHaveLength(10);
    });

    /**
     * Negative test: Verifies that getRecentMemories() returns empty array when no memories exist.
     * Objective: getRecentMemories() should return empty array when no memories exist
     */
    it('should return empty array when no memories exist', () => {
      // Arrange - no memories created

      // Act
      const recent = getRecentMemories(db);

      // Assert
      expect(recent).toEqual([]);
    });

    /**
     * Positive test: Verifies that getRecentMemories() includes all memory types.
     * Objective: getRecentMemories() should include all memory types
     */
    it('should include all memory types', () => {
      // Arrange
      repo.create({ content: 'Preference', type: 'preference' });
      repo.create({ content: 'Pattern', type: 'pattern' });
      repo.create({ content: 'Gotcha', type: 'gotcha' });
      repo.create({ content: 'Fact', type: 'fact' });
      repo.create({ content: 'Learned', type: 'learned' });

      // Act
      const recent = getRecentMemories(db);

      // Assert
      expect(recent).toHaveLength(5);
      const types = recent.map((m) => m.type);
      expect(types).toContain('preference');
      expect(types).toContain('pattern');
      expect(types).toContain('gotcha');
      expect(types).toContain('fact');
      expect(types).toContain('learned');
    });
  });
});
