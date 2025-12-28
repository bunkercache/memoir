/**
 * Chunk Tree Operations Unit Tests
 *
 * Tests tree traversal and compaction operations for chunks.
 * Uses a temporary database for isolation between tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseLike } from '../db/index.ts';
import { rmSync } from 'node:fs';
import { ChunkRepository } from './repository.ts';
import { getAncestors, getDescendants, getFullContext, compactChunks } from './tree.ts';
import type { ChunkContent } from '../types.ts';
import { createTestDatabase } from '../db/test-utils.ts';

/**
 * Creates test chunk content with default values.
 */
function createTestContent(overrides?: Partial<ChunkContent>): ChunkContent {
  return {
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
        timestamp: Date.now(),
      },
    ],
    metadata: {},
    ...overrides,
  };
}

describe('Tree Operations', () => {
  let db: DatabaseLike;
  let tempDir: string;
  let repository: ChunkRepository;

  beforeEach(() => {
    // Arrange: Create a fresh database for each test
    const result = createTestDatabase();
    db = result.db;
    tempDir = result.tempDir;
    repository = new ChunkRepository(db);
  });

  afterEach(() => {
    // Cleanup: Close database and remove temp directory
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // getAncestors() Tests
  // ==========================================================================

  describe('getAncestors()', () => {
    /**
     * Positive test: Verifies ancestors are returned with level information.
     * Objective: Ensure tree traversal up the hierarchy works correctly.
     */
    it('should return chunk with all parents including level information', () => {
      // Arrange - Create a 3-level hierarchy: grandparent -> parent -> child
      const grandparent = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });
      const parent = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
        parentId: grandparent.id,
      });
      const child = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
        parentId: parent.id,
      });

      // Act
      const ancestors = getAncestors(db, child.id);

      // Assert - Should be ordered from root (highest level) to child (level 0)
      expect(ancestors).toHaveLength(3);
      expect(ancestors[0].id).toBe(grandparent.id);
      expect(ancestors[0].level).toBe(2);
      expect(ancestors[1].id).toBe(parent.id);
      expect(ancestors[1].level).toBe(1);
      expect(ancestors[2].id).toBe(child.id);
      expect(ancestors[2].level).toBe(0);
    });

    /**
     * Positive test: Verifies single chunk returns itself with level 0.
     * Objective: Ensure root chunks are handled correctly.
     */
    it('should return single chunk with level 0 for root chunk', () => {
      // Arrange
      const root = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act
      const ancestors = getAncestors(db, root.id);

      // Assert
      expect(ancestors).toHaveLength(1);
      expect(ancestors[0].id).toBe(root.id);
      expect(ancestors[0].level).toBe(0);
    });

    /**
     * Negative test: Verifies empty array for non-existent chunk.
     * Objective: Ensure graceful handling of missing chunks.
     */
    it('should return empty array for non-existent chunk', () => {
      // Arrange - no chunk created

      // Act
      const ancestors = getAncestors(db, 'ch_nonexistent1');

      // Assert
      expect(ancestors).toEqual([]);
    });
  });

  // ==========================================================================
  // getDescendants() Tests
  // ==========================================================================

  describe('getDescendants()', () => {
    /**
     * Positive test: Verifies descendants are returned with level information.
     * Objective: Ensure tree traversal down the hierarchy works correctly.
     */
    it('should return chunk with all children including level information', () => {
      // Arrange - Create a tree: parent -> [child1, child2] -> grandchild
      const parent = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });
      const child1 = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
        parentId: parent.id,
      });
      const child2 = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
        parentId: parent.id,
      });
      const grandchild = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
        parentId: child1.id,
      });

      // Act
      const descendants = getDescendants(db, parent.id);

      // Assert - Should be ordered by level ascending
      expect(descendants).toHaveLength(4);
      expect(descendants[0].id).toBe(parent.id);
      expect(descendants[0].level).toBe(0);

      // Level 1 children (order may vary)
      const level1 = descendants.filter((d) => d.level === 1);
      expect(level1).toHaveLength(2);
      expect(level1.map((d) => d.id)).toContain(child1.id);
      expect(level1.map((d) => d.id)).toContain(child2.id);

      // Level 2 grandchild
      const level2 = descendants.filter((d) => d.level === 2);
      expect(level2).toHaveLength(1);
      expect(level2[0].id).toBe(grandchild.id);
    });

    /**
     * Positive test: Verifies leaf chunk returns only itself.
     * Objective: Ensure leaf nodes are handled correctly.
     */
    it('should return single chunk with level 0 for leaf chunk', () => {
      // Arrange
      const leaf = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act
      const descendants = getDescendants(db, leaf.id);

      // Assert
      expect(descendants).toHaveLength(1);
      expect(descendants[0].id).toBe(leaf.id);
      expect(descendants[0].level).toBe(0);
    });

    /**
     * Negative test: Verifies empty array for non-existent chunk.
     * Objective: Ensure graceful handling of missing chunks.
     */
    it('should return empty array for non-existent chunk', () => {
      // Arrange - no chunk created

      // Act
      const descendants = getDescendants(db, 'ch_nonexistent1');

      // Assert
      expect(descendants).toEqual([]);
    });
  });

  // ==========================================================================
  // getFullContext() Tests
  // ==========================================================================

  describe('getFullContext()', () => {
    /**
     * Positive test: Verifies full context returns ancestors as plain Chunks.
     * Objective: Ensure context retrieval strips level information.
     */
    it('should return chunk + ancestors as plain Chunks without level', () => {
      // Arrange
      const grandparent = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });
      const parent = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
        parentId: grandparent.id,
      });
      const child = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
        parentId: parent.id,
      });

      // Act
      const context = getFullContext(db, child.id);

      // Assert - Should be ordered from root to child, without level property
      expect(context).toHaveLength(3);
      expect(context[0].id).toBe(grandparent.id);
      expect(context[1].id).toBe(parent.id);
      expect(context[2].id).toBe(child.id);

      // Verify level property is not present
      expect('level' in context[0]).toBe(false);
      expect('level' in context[1]).toBe(false);
      expect('level' in context[2]).toBe(false);
    });

    /**
     * Positive test: Verifies root chunk returns only itself.
     * Objective: Ensure root chunks work correctly.
     */
    it('should return single chunk for root chunk', () => {
      // Arrange
      const root = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act
      const context = getFullContext(db, root.id);

      // Assert
      expect(context).toHaveLength(1);
      expect(context[0].id).toBe(root.id);
    });

    /**
     * Negative test: Verifies empty array for non-existent chunk.
     * Objective: Ensure graceful handling of missing chunks.
     */
    it('should return empty array for non-existent chunk', () => {
      // Arrange - no chunk created

      // Act
      const context = getFullContext(db, 'ch_nonexistent1');

      // Assert
      expect(context).toEqual([]);
    });
  });

  // ==========================================================================
  // compactChunks() Tests
  // ==========================================================================

  describe('compactChunks()', () => {
    /**
     * Positive test: Verifies summary chunk is created with correct depth.
     * Objective: Ensure compaction creates proper summary chunk.
     */
    it('should create summary chunk with depth = max(children depths) + 1', () => {
      // Arrange - Create chunks with different depths
      const chunk1 = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
        depth: 0,
      });
      const chunk2 = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
        depth: 1,
      });
      const chunk3 = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
        depth: 2,
      });

      // Act
      const result = compactChunks(
        db,
        'session_123',
        [chunk1.id, chunk2.id, chunk3.id],
        'Summary of work'
      );

      // Assert
      expect(result.summaryChunk.depth).toBe(3); // max(0, 1, 2) + 1
      expect(result.summaryChunk.summary).toBe('Summary of work');
      expect(result.summaryChunk.status).toBe('active');
    });

    /**
     * Positive test: Verifies children are updated correctly.
     * Objective: Ensure compacted chunks have proper parent and status.
     */
    it('should update children parent_id, status, and compacted_at', () => {
      // Arrange
      const chunk1 = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });
      const chunk2 = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act
      const result = compactChunks(db, 'session_123', [chunk1.id, chunk2.id], 'Summary');

      // Assert
      expect(result.compactedChunks).toHaveLength(2);
      for (const compacted of result.compactedChunks) {
        expect(compacted.parentId).toBe(result.summaryChunk.id);
        expect(compacted.status).toBe('compacted');
        expect(compacted.compactedAt).not.toBeNull();
      }
    });

    /**
     * Positive test: Verifies child_refs is set on summary chunk.
     * Objective: Ensure summary chunk references its children.
     */
    it('should set child_refs on summary chunk', () => {
      // Arrange
      const chunk1 = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });
      const chunk2 = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act
      const result = compactChunks(db, 'session_123', [chunk1.id, chunk2.id], 'Summary');

      // Assert
      expect(result.summaryChunk.childRefs).toEqual([chunk1.id, chunk2.id]);
    });

    /**
     * Positive test: Verifies summary chunk has empty messages.
     * Objective: Ensure summary chunks don't duplicate message content.
     */
    it('should create summary chunk with empty messages', () => {
      // Arrange
      const chunk = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act
      const result = compactChunks(db, 'session_123', [chunk.id], 'Summary');

      // Assert
      expect(result.summaryChunk.content.messages).toEqual([]);
      expect(result.summaryChunk.content.metadata).toEqual({});
    });

    /**
     * Positive test: Verifies operation is atomic (transaction).
     * Objective: Ensure all-or-nothing behavior for compaction.
     */
    it('should be atomic - all changes applied together', () => {
      // Arrange
      const chunk1 = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });
      const chunk2 = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act
      const result = compactChunks(db, 'session_123', [chunk1.id, chunk2.id], 'Summary');

      // Assert - Verify all changes were applied
      const summaryFromDb = repository.getById(result.summaryChunk.id);
      expect(summaryFromDb).not.toBeNull();
      expect(summaryFromDb?.childRefs).toEqual([chunk1.id, chunk2.id]);

      const chunk1FromDb = repository.getById(chunk1.id);
      expect(chunk1FromDb?.status).toBe('compacted');
      expect(chunk1FromDb?.parentId).toBe(result.summaryChunk.id);

      const chunk2FromDb = repository.getById(chunk2.id);
      expect(chunk2FromDb?.status).toBe('compacted');
      expect(chunk2FromDb?.parentId).toBe(result.summaryChunk.id);
    });

    /**
     * Negative test: Verifies error is thrown for empty chunk list.
     * Objective: Ensure invalid input is rejected.
     */
    it('should throw error for empty chunk list', () => {
      // Arrange - empty list

      // Act & Assert
      expect(() => compactChunks(db, 'session_123', [], 'Summary')).toThrow(
        'Cannot compact empty chunk list'
      );
    });

    /**
     * Negative test: Verifies error is thrown for non-existent chunk IDs.
     * Objective: Ensure missing chunks are detected.
     */
    it('should throw error for non-existent chunk IDs', () => {
      // Arrange
      const validChunk = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act & Assert
      expect(() =>
        compactChunks(db, 'session_123', [validChunk.id, 'ch_nonexistent1'], 'Summary')
      ).toThrow('Chunks not found: ch_nonexistent1');
    });

    /**
     * Negative test: Verifies error lists all missing chunk IDs.
     * Objective: Ensure all missing chunks are reported.
     */
    it('should list all missing chunk IDs in error', () => {
      // Arrange - no chunks created

      // Act & Assert
      expect(() =>
        compactChunks(db, 'session_123', ['ch_missing00001', 'ch_missing00002'], 'Summary')
      ).toThrow('Chunks not found: ch_missing00001, ch_missing00002');
    });
  });
});
