/**
 * ChunkRepository Unit Tests
 *
 * Tests CRUD operations for chunk entities in the database.
 * Uses a temporary database for isolation between tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseLike } from '../db/index.ts';
import { rmSync } from 'node:fs';
import { ChunkRepository } from './repository.ts';
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

describe('ChunkRepository', () => {
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
  // create() Tests
  // ==========================================================================

  describe('create()', () => {
    /**
     * Positive test: Verifies that create() generates a unique chunk ID
     * with the correct prefix format (ch_*).
     * Objective: Ensure chunks are created with proper identifiers.
     */
    it('should insert a new chunk with generated ID', () => {
      // Arrange
      const content = createTestContent();
      const sessionId = 'session_123';

      // Act
      const chunk = repository.create({ sessionId, content });

      // Assert
      expect(chunk.id).toMatch(/^ch_[A-Za-z0-9]{12}$/);
      expect(chunk.sessionId).toBe(sessionId);
    });

    /**
     * Positive test: Verifies that content is serialized as JSON in the database.
     * Objective: Ensure complex content structures are properly stored.
     */
    it('should serialize content as JSON', () => {
      // Arrange
      const content = createTestContent({
        metadata: { tools_used: ['bash', 'read'], files_modified: ['test.ts'] },
      });

      // Act
      const chunk = repository.create({ sessionId: 'session_123', content });

      // Assert - Verify content is stored and retrievable
      const retrieved = repository.getById(chunk.id);
      expect(retrieved?.content).toEqual(content);
      expect(retrieved?.content.metadata.tools_used).toEqual(['bash', 'read']);
    });

    /**
     * Positive test: Verifies default values are set correctly.
     * Objective: Ensure new chunks have proper default status and depth.
     */
    it('should set default status "active" and depth 0', () => {
      // Arrange
      const content = createTestContent();

      // Act
      const chunk = repository.create({ sessionId: 'session_123', content });

      // Assert
      expect(chunk.status).toBe('active');
      expect(chunk.depth).toBe(0);
      expect(chunk.parentId).toBeNull();
      expect(chunk.childRefs).toBeNull();
      expect(chunk.finalizedAt).toBeNull();
      expect(chunk.compactedAt).toBeNull();
    });

    /**
     * Positive test: Verifies custom depth and parentId are stored.
     * Objective: Ensure optional parameters are properly stored.
     */
    it('should accept custom depth and parentId', () => {
      // Arrange - first create a parent chunk
      const parentContent = createTestContent();
      const parent = repository.create({
        sessionId: 'session_123',
        content: parentContent,
      });

      const content = createTestContent();

      // Act - create child chunk with parent reference
      const chunk = repository.create({
        sessionId: 'session_123',
        content,
        parentId: parent.id,
        depth: 2,
      });

      // Assert
      expect(chunk.depth).toBe(2);
      expect(chunk.parentId).toBe(parent.id);
    });

    /**
     * Positive test: Verifies summary is stored when provided.
     * Objective: Ensure summary text is properly saved for compacted chunks.
     */
    it('should store summary when provided', () => {
      // Arrange
      const content = createTestContent();
      const summary = 'This is a summary of the work done';

      // Act
      const chunk = repository.create({
        sessionId: 'session_123',
        content,
        summary,
      });

      // Assert
      expect(chunk.summary).toBe(summary);
    });
  });

  // ==========================================================================
  // getById() Tests
  // ==========================================================================

  describe('getById()', () => {
    /**
     * Positive test: Verifies chunk retrieval by ID with proper deserialization.
     * Objective: Ensure chunks can be retrieved with all fields intact.
     */
    it('should return chunk by ID with deserialized content', () => {
      // Arrange
      const content = createTestContent({
        messages: [
          { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }], timestamp: 1000 },
          {
            id: 'msg-2',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Hi there!' }],
            timestamp: 2000,
          },
        ],
      });
      const created = repository.create({ sessionId: 'session_123', content });

      // Act
      const retrieved = repository.getById(created.id);

      // Assert
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.content.messages).toHaveLength(2);
      expect(retrieved?.content.messages[0].parts[0].text).toBe('Hello');
    });

    /**
     * Negative test: Verifies null is returned for non-existent chunk.
     * Objective: Ensure graceful handling of missing chunks.
     */
    it('should return null for non-existent ID', () => {
      // Arrange - no chunk created

      // Act
      const result = repository.getById('ch_nonexistent1');

      // Assert
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // update() Tests
  // ==========================================================================

  describe('update()', () => {
    /**
     * Positive test: Verifies content can be updated.
     * Objective: Ensure chunk content modifications are persisted.
     */
    it('should update chunk content', () => {
      // Arrange
      const original = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });
      const newContent = createTestContent({
        messages: [
          { id: 'msg-new', role: 'user', parts: [{ type: 'text', text: 'Updated' }], timestamp: 0 },
        ],
      });

      // Act
      const updated = repository.update(original.id, { content: newContent });

      // Assert
      expect(updated?.content.messages[0].parts[0].text).toBe('Updated');
    });

    /**
     * Positive test: Verifies status can be updated.
     * Objective: Ensure chunk status transitions are persisted.
     */
    it('should update chunk status', () => {
      // Arrange
      const chunk = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act
      const updated = repository.update(chunk.id, { status: 'compacted' });

      // Assert
      expect(updated?.status).toBe('compacted');
    });

    /**
     * Positive test: Verifies childRefs can be updated.
     * Objective: Ensure child references are properly stored as JSON array.
     */
    it('should update childRefs', () => {
      // Arrange
      const chunk = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });
      const childRefs = ['ch_child1234567', 'ch_child2345678'];

      // Act
      const updated = repository.update(chunk.id, { childRefs });

      // Assert
      expect(updated?.childRefs).toEqual(childRefs);
    });

    /**
     * Positive test: Verifies finalizedAt timestamp can be set.
     * Objective: Ensure finalization timestamp is properly stored.
     */
    it('should set finalizedAt', () => {
      // Arrange
      const chunk = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });
      const now = Math.floor(Date.now() / 1000);

      // Act
      const updated = repository.update(chunk.id, { finalizedAt: now });

      // Assert
      expect(updated?.finalizedAt).toBe(now);
    });

    /**
     * Positive test: Verifies compactedAt timestamp can be set.
     * Objective: Ensure compaction timestamp is properly stored.
     */
    it('should set compactedAt', () => {
      // Arrange
      const chunk = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });
      const now = Math.floor(Date.now() / 1000);

      // Act
      const updated = repository.update(chunk.id, { compactedAt: now });

      // Assert
      expect(updated?.compactedAt).toBe(now);
    });

    /**
     * Positive test: Verifies summary can be updated.
     * Objective: Ensure summary text modifications are persisted.
     */
    it('should update summary', () => {
      // Arrange
      const chunk = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act
      const updated = repository.update(chunk.id, { summary: 'New summary text' });

      // Assert
      expect(updated?.summary).toBe('New summary text');
    });

    /**
     * Positive test: Verifies multiple fields can be updated at once.
     * Objective: Ensure batch updates work correctly.
     */
    it('should update multiple fields at once', () => {
      // Arrange
      const chunk = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });
      const now = Math.floor(Date.now() / 1000);

      // Act
      const updated = repository.update(chunk.id, {
        status: 'compacted',
        compactedAt: now,
        summary: 'Compacted summary',
      });

      // Assert
      expect(updated?.status).toBe('compacted');
      expect(updated?.compactedAt).toBe(now);
      expect(updated?.summary).toBe('Compacted summary');
    });

    /**
     * Negative test: Verifies null is returned for non-existent chunk.
     * Objective: Ensure graceful handling of update on missing chunk.
     */
    it('should return null for non-existent ID', () => {
      // Arrange - no chunk created

      // Act
      const result = repository.update('ch_nonexistent1', { status: 'archived' });

      // Assert
      expect(result).toBeNull();
    });

    /**
     * Positive test: Verifies no-op update returns existing chunk.
     * Objective: Ensure empty updates don't cause errors.
     */
    it('should return existing chunk when no updates provided', () => {
      // Arrange
      const chunk = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act
      const updated = repository.update(chunk.id, {});

      // Assert
      expect(updated?.id).toBe(chunk.id);
      expect(updated?.status).toBe('active');
    });
  });

  // ==========================================================================
  // delete() Tests
  // ==========================================================================

  describe('delete()', () => {
    /**
     * Positive test: Verifies chunk deletion.
     * Objective: Ensure chunks can be removed from the database.
     */
    it('should remove chunk and return true', () => {
      // Arrange
      const chunk = repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act
      const result = repository.delete(chunk.id);

      // Assert
      expect(result).toBe(true);
      expect(repository.getById(chunk.id)).toBeNull();
    });

    /**
     * Negative test: Verifies false is returned for non-existent chunk.
     * Objective: Ensure graceful handling of delete on missing chunk.
     */
    it('should return false for non-existent ID', () => {
      // Arrange - no chunk created

      // Act
      const result = repository.delete('ch_nonexistent1');

      // Assert
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // getBySession() Tests
  // ==========================================================================

  describe('getBySession()', () => {
    /**
     * Positive test: Verifies chunks are returned for a session.
     * Objective: Ensure session-based retrieval works correctly.
     */
    it('should return chunks for session ordered by createdAt', () => {
      // Arrange
      const sessionId = 'session_123';
      const chunk1 = repository.create({ sessionId, content: createTestContent() });
      const chunk2 = repository.create({ sessionId, content: createTestContent() });
      repository.create({ sessionId: 'other_session', content: createTestContent() });

      // Act
      const chunks = repository.getBySession(sessionId);

      // Assert
      expect(chunks).toHaveLength(2);
      expect(chunks[0].id).toBe(chunk1.id);
      expect(chunks[1].id).toBe(chunk2.id);
    });

    /**
     * Positive test: Verifies status filtering works.
     * Objective: Ensure chunks can be filtered by status.
     */
    it('should filter by status when provided', () => {
      // Arrange
      const sessionId = 'session_123';
      const activeChunk = repository.create({ sessionId, content: createTestContent() });
      const compactedChunk = repository.create({ sessionId, content: createTestContent() });
      repository.update(compactedChunk.id, { status: 'compacted' });

      // Act
      const activeChunks = repository.getBySession(sessionId, { status: 'active' });
      const compactedChunks = repository.getBySession(sessionId, { status: 'compacted' });

      // Assert
      expect(activeChunks).toHaveLength(1);
      expect(activeChunks[0].id).toBe(activeChunk.id);
      expect(compactedChunks).toHaveLength(1);
      expect(compactedChunks[0].id).toBe(compactedChunk.id);
    });

    /**
     * Negative test: Verifies empty array for unknown session.
     * Objective: Ensure graceful handling of non-existent session.
     */
    it('should return empty array for unknown session', () => {
      // Arrange - no chunks for this session

      // Act
      const chunks = repository.getBySession('unknown_session');

      // Assert
      expect(chunks).toEqual([]);
    });
  });

  // ==========================================================================
  // getActiveChunks() Tests
  // ==========================================================================

  describe('getActiveChunks()', () => {
    /**
     * Positive test: Verifies only active chunks are returned.
     * Objective: Ensure active chunk filtering works correctly.
     */
    it('should return only active chunks', () => {
      // Arrange
      const sessionId = 'session_123';
      const active1 = repository.create({ sessionId, content: createTestContent() });
      const active2 = repository.create({ sessionId, content: createTestContent() });
      const compacted = repository.create({ sessionId, content: createTestContent() });
      repository.update(compacted.id, { status: 'compacted' });

      // Act
      const activeChunks = repository.getActiveChunks(sessionId);

      // Assert
      expect(activeChunks).toHaveLength(2);
      expect(activeChunks.map((c) => c.id)).toContain(active1.id);
      expect(activeChunks.map((c) => c.id)).toContain(active2.id);
      expect(activeChunks.map((c) => c.id)).not.toContain(compacted.id);
    });
  });

  // ==========================================================================
  // getChildren() Tests
  // ==========================================================================

  describe('getChildren()', () => {
    /**
     * Positive test: Verifies child chunks are returned.
     * Objective: Ensure parent-child relationship queries work.
     */
    it('should return child chunks', () => {
      // Arrange
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
      // Create an unrelated chunk
      repository.create({
        sessionId: 'session_123',
        content: createTestContent(),
      });

      // Act
      const children = repository.getChildren(parent.id);

      // Assert
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id)).toContain(child1.id);
      expect(children.map((c) => c.id)).toContain(child2.id);
    });

    /**
     * Negative test: Verifies empty array for non-existent parent.
     * Objective: Ensure graceful handling of missing parent.
     */
    it('should return empty array for non-existent parent', () => {
      // Arrange - no chunks with this parent

      // Act
      const children = repository.getChildren('ch_nonexistent1');

      // Assert
      expect(children).toEqual([]);
    });
  });

  // ==========================================================================
  // count() Tests
  // ==========================================================================

  describe('count()', () => {
    /**
     * Positive test: Verifies total count is returned.
     * Objective: Ensure chunk counting works correctly.
     */
    it('should return total count', () => {
      // Arrange
      repository.create({ sessionId: 'session_1', content: createTestContent() });
      repository.create({ sessionId: 'session_1', content: createTestContent() });
      repository.create({ sessionId: 'session_2', content: createTestContent() });

      // Act
      const count = repository.count();

      // Assert
      expect(count).toBe(3);
    });

    /**
     * Positive test: Verifies count filters by sessionId.
     * Objective: Ensure session-specific counting works.
     */
    it('should filter count by sessionId', () => {
      // Arrange
      repository.create({ sessionId: 'session_1', content: createTestContent() });
      repository.create({ sessionId: 'session_1', content: createTestContent() });
      repository.create({ sessionId: 'session_2', content: createTestContent() });

      // Act
      const count1 = repository.count('session_1');
      const count2 = repository.count('session_2');

      // Assert
      expect(count1).toBe(2);
      expect(count2).toBe(1);
    });

    /**
     * Positive test: Verifies zero count for empty database.
     * Objective: Ensure count handles empty state correctly.
     */
    it('should return 0 for empty database', () => {
      // Arrange - no chunks created

      // Act
      const count = repository.count();

      // Assert
      expect(count).toBe(0);
    });

    /**
     * Positive test: Verifies zero count for unknown session.
     * Objective: Ensure count handles non-existent session correctly.
     */
    it('should return 0 for unknown session', () => {
      // Arrange
      repository.create({ sessionId: 'session_1', content: createTestContent() });

      // Act
      const count = repository.count('unknown_session');

      // Assert
      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // getRecentSummaryChunks() Tests
  // ==========================================================================

  describe('getRecentSummaryChunks()', () => {
    /**
     * Positive test: Verifies summary chunks are returned.
     * Objective: Ensure chunks with depth > 0 and summary are returned.
     */
    it('should return chunks with depth > 0 and summary', () => {
      // Arrange: Create leaf chunks (depth 0) and summary chunks (depth > 0)
      const leafChunk = repository.create({
        sessionId: 'session_1',
        content: createTestContent(),
      });

      const summaryChunk = repository.create({
        sessionId: 'session_1',
        content: createTestContent(),
        depth: 1,
        summary: 'Summary of session 1 work',
      });

      // Also create a chunk with depth but no summary (shouldn't be returned)
      repository.create({
        sessionId: 'session_2',
        content: createTestContent(),
        depth: 1,
      });

      // Act
      const recentSummaries = repository.getRecentSummaryChunks();

      // Assert
      expect(recentSummaries).toHaveLength(1);
      expect(recentSummaries[0].id).toBe(summaryChunk.id);
      expect(recentSummaries[0].summary).toBe('Summary of session 1 work');
      expect(recentSummaries.map((c) => c.id)).not.toContain(leafChunk.id);
    });

    /**
     * Positive test: Verifies chunks are ordered by created_at descending.
     * Objective: Ensure most recent summaries come first.
     */
    it('should return summaries ordered by created_at descending', () => {
      // Arrange: Create summary chunks and verify they're returned in descending order
      // Note: Since created_at is in seconds, chunks created in the same second
      // may have the same timestamp, so we verify descending order (>= for ties)
      repository.create({
        sessionId: 'session_1',
        content: createTestContent(),
        depth: 1,
        summary: 'First summary',
      });

      repository.create({
        sessionId: 'session_2',
        content: createTestContent(),
        depth: 2,
        summary: 'Second summary',
      });

      repository.create({
        sessionId: 'session_3',
        content: createTestContent(),
        depth: 1,
        summary: 'Third summary',
      });

      // Act
      const recentSummaries = repository.getRecentSummaryChunks();

      // Assert: Should be in descending order by created_at
      expect(recentSummaries).toHaveLength(3);
      // Verify descending order (each createdAt >= next)
      for (let i = 0; i < recentSummaries.length - 1; i++) {
        expect(recentSummaries[i].createdAt).toBeGreaterThanOrEqual(
          recentSummaries[i + 1].createdAt
        );
      }
      // All should have summaries
      expect(recentSummaries.every((c) => c.summary !== null)).toBe(true);
    });

    /**
     * Positive test: Verifies limit parameter is respected.
     * Objective: Ensure only the specified number of chunks are returned.
     */
    it('should respect the limit parameter', () => {
      // Arrange: Create 5 summary chunks
      for (let i = 0; i < 5; i++) {
        repository.create({
          sessionId: `session_${i}`,
          content: createTestContent(),
          depth: 1,
          summary: `Summary ${i}`,
        });
      }

      // Act
      const limited = repository.getRecentSummaryChunks(2);

      // Assert
      expect(limited).toHaveLength(2);
    });

    /**
     * Negative test: Verifies empty array when no summary chunks exist.
     * Objective: Ensure graceful handling of no summaries.
     */
    it('should return empty array when no summary chunks exist', () => {
      // Arrange: Create only leaf chunks (depth 0)
      repository.create({
        sessionId: 'session_1',
        content: createTestContent(),
      });

      // Act
      const recentSummaries = repository.getRecentSummaryChunks();

      // Assert
      expect(recentSummaries).toEqual([]);
    });

    /**
     * Positive test: Verifies default limit of 5.
     * Objective: Ensure default limit is applied when not specified.
     */
    it('should use default limit of 5', () => {
      // Arrange: Create 10 summary chunks
      for (let i = 0; i < 10; i++) {
        repository.create({
          sessionId: `session_${i}`,
          content: createTestContent(),
          depth: 1,
          summary: `Summary ${i}`,
        });
      }

      // Act
      const recentSummaries = repository.getRecentSummaryChunks();

      // Assert
      expect(recentSummaries).toHaveLength(5);
    });
  });
});
