/**
 * MemoryRepository Unit Tests
 *
 * Tests CRUD operations for the memory repository.
 * Uses a temporary SQLite database for isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseLike } from '../db/index.ts';
import { rmSync } from 'node:fs';
import { MemoryRepository } from './repository.ts';
import { createTestDatabase } from '../db/test-utils.ts';

describe('MemoryRepository', () => {
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
  // CREATE TESTS
  // ===========================================================================

  describe('create()', () => {
    /**
     * Positive test: Verifies that create() generates a unique ID with 'mem_' prefix.
     * Objective: create() should insert a new memory with generated ID
     */
    it('should insert a new memory with generated ID starting with mem_', () => {
      // Arrange
      const input = {
        content: 'Always use strict TypeScript mode',
        type: 'preference' as const,
      };

      // Act
      const memory = repo.create(input);

      // Assert
      expect(memory.id).toMatch(/^mem_[A-Za-z0-9]{12}$/);
      expect(memory.content).toBe(input.content);
      expect(memory.type).toBe(input.type);
    });

    /**
     * Positive test: Verifies that create() sets createdAt as Unix timestamp.
     * Objective: create() should set createdAt timestamp
     */
    it('should set createdAt timestamp as Unix epoch seconds', () => {
      // Arrange
      const beforeCreate = Math.floor(Date.now() / 1000);
      const input = {
        content: 'Test memory',
        type: 'fact' as const,
      };

      // Act
      const memory = repo.create(input);
      const afterCreate = Math.floor(Date.now() / 1000);

      // Assert
      expect(memory.createdAt).toBeGreaterThanOrEqual(beforeCreate);
      expect(memory.createdAt).toBeLessThanOrEqual(afterCreate);
      expect(memory.updatedAt).toBeNull();
    });

    /**
     * Positive test: Verifies that create() uses 'user' as default source.
     * Objective: create() should use default source 'user' when not provided
     */
    it('should use default source user when not provided', () => {
      // Arrange
      const input = {
        content: 'Test memory',
        type: 'pattern' as const,
      };

      // Act
      const memory = repo.create(input);

      // Assert
      expect(memory.source).toBe('user');
    });

    /**
     * Positive test: Verifies that create() stores tags correctly.
     * Objective: create() should store tags as JSON array
     */
    it('should store tags correctly', () => {
      // Arrange
      const input = {
        content: 'Use Result<T, E> for error handling',
        type: 'pattern' as const,
        tags: ['typescript', 'error-handling'],
      };

      // Act
      const memory = repo.create(input);

      // Assert
      expect(memory.tags).toEqual(['typescript', 'error-handling']);
    });

    /**
     * Positive test: Verifies that create() accepts custom source.
     * Objective: create() should accept custom source value
     */
    it('should accept custom source value', () => {
      // Arrange
      const input = {
        content: 'Auto-detected pattern',
        type: 'learned' as const,
        source: 'compaction' as const,
      };

      // Act
      const memory = repo.create(input);

      // Assert
      expect(memory.source).toBe('compaction');
    });
  });

  // ===========================================================================
  // GET BY ID TESTS
  // ===========================================================================

  describe('getById()', () => {
    /**
     * Positive test: Verifies that getById() returns the correct memory.
     * Objective: getById() should return memory by ID
     */
    it('should return memory by ID with all fields correctly mapped', () => {
      // Arrange
      const created = repo.create({
        content: 'Test memory content',
        type: 'gotcha',
        tags: ['test'],
        source: 'user',
      });

      // Act
      const retrieved = repo.getById(created.id);

      // Assert
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.content).toBe(created.content);
      expect(retrieved!.type).toBe(created.type);
      expect(retrieved!.tags).toEqual(created.tags);
      expect(retrieved!.source).toBe(created.source);
      expect(retrieved!.createdAt).toBe(created.createdAt);
    });

    /**
     * Negative test: Verifies that getById() returns null for non-existent ID.
     * Objective: getById() should return null for non-existent ID
     */
    it('should return null for non-existent ID', () => {
      // Arrange
      const nonExistentId = 'mem_nonexistent1';

      // Act
      const result = repo.getById(nonExistentId);

      // Assert
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // UPDATE TESTS
  // ===========================================================================

  describe('update()', () => {
    /**
     * Positive test: Verifies that update() modifies content.
     * Objective: update() should update memory content
     */
    it('should update memory content', () => {
      // Arrange
      const created = repo.create({
        content: 'Original content',
        type: 'fact',
      });

      // Act
      const updated = repo.update(created.id, {
        content: 'Updated content',
      });

      // Assert
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe('Updated content');
    });

    /**
     * Positive test: Verifies that update() modifies type.
     * Objective: update() should update memory type
     */
    it('should update memory type', () => {
      // Arrange
      const created = repo.create({
        content: 'Test memory',
        type: 'fact',
      });

      // Act
      const updated = repo.update(created.id, {
        type: 'preference',
      });

      // Assert
      expect(updated).not.toBeNull();
      expect(updated!.type).toBe('preference');
    });

    /**
     * Positive test: Verifies that update() sets updatedAt timestamp.
     * Objective: update() should set updatedAt timestamp
     */
    it('should set updatedAt timestamp', () => {
      // Arrange
      const created = repo.create({
        content: 'Test memory',
        type: 'fact',
      });
      expect(created.updatedAt).toBeNull();
      const beforeUpdate = Math.floor(Date.now() / 1000);

      // Act
      const updated = repo.update(created.id, {
        content: 'Updated content',
      });
      const afterUpdate = Math.floor(Date.now() / 1000);

      // Assert
      expect(updated).not.toBeNull();
      expect(updated!.updatedAt).not.toBeNull();
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(beforeUpdate);
      expect(updated!.updatedAt).toBeLessThanOrEqual(afterUpdate);
    });

    /**
     * Positive test: Verifies that update() modifies tags.
     * Objective: update() should update memory tags
     */
    it('should update memory tags', () => {
      // Arrange
      const created = repo.create({
        content: 'Test memory',
        type: 'pattern',
        tags: ['old-tag'],
      });

      // Act
      const updated = repo.update(created.id, {
        tags: ['new-tag-1', 'new-tag-2'],
      });

      // Assert
      expect(updated).not.toBeNull();
      expect(updated!.tags).toEqual(['new-tag-1', 'new-tag-2']);
    });

    /**
     * Negative test: Verifies that update() returns null for non-existent ID.
     * Objective: update() should return null for non-existent ID
     */
    it('should return null for non-existent ID', () => {
      // Arrange
      const nonExistentId = 'mem_nonexistent1';

      // Act
      const result = repo.update(nonExistentId, {
        content: 'New content',
      });

      // Assert
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // DELETE TESTS
  // ===========================================================================

  describe('delete()', () => {
    /**
     * Positive test: Verifies that delete() removes the memory.
     * Objective: delete() should remove memory
     */
    it('should remove memory and return true', () => {
      // Arrange
      const created = repo.create({
        content: 'Memory to delete',
        type: 'fact',
      });

      // Act
      const result = repo.delete(created.id);

      // Assert
      expect(result).toBe(true);
      expect(repo.getById(created.id)).toBeNull();
    });

    /**
     * Negative test: Verifies that delete() returns false for non-existent ID.
     * Objective: delete() should return false for non-existent ID
     */
    it('should return false for non-existent ID', () => {
      // Arrange
      const nonExistentId = 'mem_nonexistent1';

      // Act
      const result = repo.delete(nonExistentId);

      // Assert
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // LIST TESTS
  // ===========================================================================

  describe('list()', () => {
    /**
     * Positive test: Verifies that list() returns all memories.
     * Objective: list() should return all memories
     */
    it('should return all memories ordered by createdAt DESC', () => {
      // Arrange
      const mem1 = repo.create({ content: 'First', type: 'fact' });
      const mem2 = repo.create({ content: 'Second', type: 'fact' });
      const mem3 = repo.create({ content: 'Third', type: 'fact' });

      // Act
      const memories = repo.list();

      // Assert
      expect(memories).toHaveLength(3);
      // Newest first (DESC order)
      expect(memories[0].id).toBe(mem3.id);
      expect(memories[1].id).toBe(mem2.id);
      expect(memories[2].id).toBe(mem1.id);
    });

    /**
     * Positive test: Verifies that list() respects limit option.
     * Objective: list() should respect limit option
     */
    it('should respect limit option', () => {
      // Arrange
      repo.create({ content: 'First', type: 'fact' });
      repo.create({ content: 'Second', type: 'fact' });
      repo.create({ content: 'Third', type: 'fact' });

      // Act
      const memories = repo.list({ limit: 2 });

      // Assert
      expect(memories).toHaveLength(2);
    });

    /**
     * Positive test: Verifies that list() respects offset option.
     * Objective: list() should respect offset option
     */
    it('should respect offset option', () => {
      // Arrange
      const mem1 = repo.create({ content: 'First', type: 'fact' });
      repo.create({ content: 'Second', type: 'fact' });
      repo.create({ content: 'Third', type: 'fact' });

      // Act
      const memories = repo.list({ offset: 2 });

      // Assert
      expect(memories).toHaveLength(1);
      expect(memories[0].id).toBe(mem1.id);
    });

    /**
     * Positive test: Verifies that list() filters by type.
     * Objective: list() should filter by type
     */
    it('should filter by type', () => {
      // Arrange
      repo.create({ content: 'Preference 1', type: 'preference' });
      repo.create({ content: 'Fact 1', type: 'fact' });
      repo.create({ content: 'Preference 2', type: 'preference' });

      // Act
      const preferences = repo.list({ type: 'preference' });

      // Assert
      expect(preferences).toHaveLength(2);
      expect(preferences.every((m) => m.type === 'preference')).toBe(true);
    });

    /**
     * Negative test: Verifies that list() returns empty array when no memories exist.
     * Objective: list() should return empty array when no memories exist
     */
    it('should return empty array when no memories exist', () => {
      // Arrange - no memories created

      // Act
      const memories = repo.list();

      // Assert
      expect(memories).toEqual([]);
    });
  });

  // ===========================================================================
  // COUNT TESTS
  // ===========================================================================

  describe('count()', () => {
    /**
     * Positive test: Verifies that count() returns total count.
     * Objective: count() should return total count
     */
    it('should return total count', () => {
      // Arrange
      repo.create({ content: 'First', type: 'fact' });
      repo.create({ content: 'Second', type: 'preference' });
      repo.create({ content: 'Third', type: 'pattern' });

      // Act
      const count = repo.count();

      // Assert
      expect(count).toBe(3);
    });

    /**
     * Positive test: Verifies that count() filters by type.
     * Objective: count() should filter by type
     */
    it('should filter by type', () => {
      // Arrange
      repo.create({ content: 'Preference 1', type: 'preference' });
      repo.create({ content: 'Fact 1', type: 'fact' });
      repo.create({ content: 'Preference 2', type: 'preference' });

      // Act
      const preferenceCount = repo.count('preference');
      const factCount = repo.count('fact');

      // Assert
      expect(preferenceCount).toBe(2);
      expect(factCount).toBe(1);
    });

    /**
     * Negative test: Verifies that count() returns 0 when no memories exist.
     * Objective: count() should return 0 when no memories exist
     */
    it('should return 0 when no memories exist', () => {
      // Arrange - no memories created

      // Act
      const count = repo.count();

      // Assert
      expect(count).toBe(0);
    });
  });
});
