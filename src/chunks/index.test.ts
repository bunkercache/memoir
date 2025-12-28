/**
 * ChunkService Unit Tests
 *
 * Tests high-level chunk operations including creation, finalization,
 * compaction, and search functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseLike } from '../db/index.ts';
import { rmSync } from 'node:fs';
import {
  ChunkService,
  initializeChunkService,
  getChunkService,
  resetChunkService,
  getMessageTracker,
  resetMessageTracker,
} from './index.ts';
import type { ChunkContent, ResolvedMemoirConfig } from '../types.ts';
import type { TrackedMessage } from './tracker.ts';
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

/**
 * Creates a test message for tracking.
 */
function createTestMessage(overrides?: Partial<TrackedMessage>): TrackedMessage {
  return {
    id: `msg-${Date.now()}`,
    role: 'user',
    parts: [{ type: 'text', text: 'Test message' }],
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Creates a test configuration.
 */
function createTestConfig(): ResolvedMemoirConfig {
  return {
    memory: {
      maxInject: 10,
      maxSearchResults: 20,
      keywordDetection: true,
      customKeywords: [],
    },
    chunks: {
      maxContentSize: 50000,
      maxCompactionContext: 10,
      autoArchiveDays: 0,
    },
    search: {
      mode: 'fts',
    },
    storage: {
      directory: 'auto',
      filename: 'memory.db',
      gitignore: true,
    },
    logging: {
      debug: false,
      file: null,
    },
  };
}

describe('ChunkService', () => {
  let db: DatabaseLike;
  let tempDir: string;
  let service: ChunkService;
  let config: ResolvedMemoirConfig;

  beforeEach(() => {
    // Arrange: Create a fresh database and service for each test
    const result = createTestDatabase();
    db = result.db;
    tempDir = result.tempDir;

    config = createTestConfig();
    resetChunkService();
    resetMessageTracker();
    service = new ChunkService(db, config);
  });

  afterEach(() => {
    // Cleanup: Close database, remove temp directory, reset singletons
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
    resetChunkService();
    resetMessageTracker();
  });

  // ==========================================================================
  // create() Tests
  // ==========================================================================

  describe('create()', () => {
    /**
     * Positive test: Verifies chunk creation with content.
     * Objective: Ensure chunks can be created with proper content.
     */
    it('should create a chunk with content', () => {
      // Arrange
      const sessionId = 'session_123';
      const content = createTestContent();

      // Act
      const chunk = service.create(sessionId, content);

      // Assert
      expect(chunk.id).toMatch(/^ch_[A-Za-z0-9]{12}$/);
      expect(chunk.sessionId).toBe(sessionId);
      expect(chunk.content).toEqual(content);
      expect(chunk.status).toBe('active');
    });
  });

  // ==========================================================================
  // finalize() Tests
  // ==========================================================================

  describe('finalize()', () => {
    /**
     * Positive test: Verifies chunk creation from tracked messages.
     * Objective: Ensure finalization creates chunk from tracker messages.
     */
    it('should create chunk from tracked messages', () => {
      // Arrange
      const sessionId = 'session_123';
      const tracker = getMessageTracker();
      tracker.trackMessage(
        sessionId,
        createTestMessage({
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        })
      );
      tracker.trackMessage(
        sessionId,
        createTestMessage({
          id: 'msg-2',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Hi there!' }],
        })
      );

      // Act
      const chunk = service.finalize(sessionId);

      // Assert
      expect(chunk).not.toBeNull();
      expect(chunk?.content.messages).toHaveLength(2);
      expect(chunk?.content.messages[0].id).toBe('msg-1');
      expect(chunk?.content.messages[1].id).toBe('msg-2');
    });

    /**
     * Positive test: Verifies metadata extraction from messages.
     * Objective: Ensure tools and files are extracted from message parts.
     */
    it('should extract metadata (tools, files) from messages', () => {
      // Arrange
      const sessionId = 'session_123';
      const tracker = getMessageTracker();
      tracker.trackMessage(
        sessionId,
        createTestMessage({
          id: 'msg-1',
          role: 'assistant',
          parts: [
            { type: 'tool', tool: 'bash', input: { command: 'ls' }, output: 'file.ts' },
            { type: 'tool', tool: 'read', input: { path: 'file.ts' } },
            { type: 'file', text: 'src/index.ts' },
          ],
        })
      );

      // Act
      const chunk = service.finalize(sessionId);

      // Assert
      expect(chunk?.content.metadata.tools_used).toContain('bash');
      expect(chunk?.content.metadata.tools_used).toContain('read');
      expect(chunk?.content.metadata.files_modified).toContain('src/index.ts');
    });

    /**
     * Positive test: Verifies finalizedAt is set.
     * Objective: Ensure finalization timestamp is recorded.
     */
    it('should set finalizedAt timestamp', () => {
      // Arrange
      const sessionId = 'session_123';
      const tracker = getMessageTracker();
      tracker.trackMessage(sessionId, createTestMessage());
      const beforeFinalize = Math.floor(Date.now() / 1000);

      // Act
      const chunk = service.finalize(sessionId);

      // Assert
      expect(chunk?.finalizedAt).not.toBeNull();
      expect(chunk?.finalizedAt).toBeGreaterThanOrEqual(beforeFinalize);
    });

    /**
     * Positive test: Verifies tracked messages are cleared.
     * Objective: Ensure tracker is cleaned up after finalization.
     */
    it('should clear tracked messages after finalization', () => {
      // Arrange
      const sessionId = 'session_123';
      const tracker = getMessageTracker();
      tracker.trackMessage(sessionId, createTestMessage());

      // Act
      service.finalize(sessionId);

      // Assert
      expect(tracker.getMessages(sessionId)).toEqual([]);
    });

    /**
     * Positive test: Verifies current chunk ID is updated.
     * Objective: Ensure tracker's current chunk ID is set.
     */
    it('should update current chunk ID in tracker', () => {
      // Arrange
      const sessionId = 'session_123';
      const tracker = getMessageTracker();
      tracker.trackMessage(sessionId, createTestMessage());

      // Act
      const chunk = service.finalize(sessionId);

      // Assert
      expect(tracker.getCurrentChunkId(sessionId)).toBe(chunk?.id);
    });

    /**
     * Negative test: Verifies null is returned when no messages.
     * Objective: Ensure graceful handling of empty tracker.
     */
    it('should return null if no messages to finalize', () => {
      // Arrange - no messages tracked

      // Act
      const chunk = service.finalize('session_123');

      // Assert
      expect(chunk).toBeNull();
    });
  });

  // ==========================================================================
  // compact() Tests
  // ==========================================================================

  describe('compact()', () => {
    /**
     * Positive test: Verifies compaction of active chunks.
     * Objective: Ensure active chunks are compacted into summary.
     */
    it('should compact active chunks and return result', () => {
      // Arrange
      const sessionId = 'session_123';
      service.create(sessionId, createTestContent());
      service.create(sessionId, createTestContent());

      // Act
      const result = service.compact(sessionId, 'Summary of work');

      // Assert
      expect(result).not.toBeNull();
      expect(result?.summaryChunk.summary).toBe('Summary of work');
      expect(result?.compactedChunks).toHaveLength(2);
    });

    /**
     * Positive test: Verifies compacted chunks have correct status.
     * Objective: Ensure children are marked as compacted.
     */
    it('should mark compacted chunks with status "compacted"', () => {
      // Arrange
      const sessionId = 'session_123';
      service.create(sessionId, createTestContent());

      // Act
      const result = service.compact(sessionId, 'Summary');

      // Assert
      for (const chunk of result?.compactedChunks ?? []) {
        expect(chunk.status).toBe('compacted');
      }
    });

    /**
     * Negative test: Verifies null is returned when no active chunks.
     * Objective: Ensure graceful handling of empty session.
     */
    it('should return null if no active chunks', () => {
      // Arrange - no chunks created

      // Act
      const result = service.compact('session_123', 'Summary');

      // Assert
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // expand() Tests
  // ==========================================================================

  describe('expand()', () => {
    /**
     * Positive test: Verifies chunk retrieval by ID.
     * Objective: Ensure expand returns the requested chunk.
     */
    it('should return chunk by ID', () => {
      // Arrange
      const chunk = service.create('session_123', createTestContent());

      // Act
      const expanded = service.expand(chunk.id);

      // Assert
      expect(expanded).toHaveLength(1);
      expect(expanded[0].id).toBe(chunk.id);
    });

    /**
     * Positive test: Verifies descendants are included when requested.
     * Objective: Ensure expand can return full tree.
     */
    it('should include descendants when requested', () => {
      // Arrange - Create parent with children via compaction
      const sessionId = 'session_123';
      service.create(sessionId, createTestContent());
      service.create(sessionId, createTestContent());
      const result = service.compact(sessionId, 'Summary');

      // Act
      const expanded = service.expand(result!.summaryChunk.id, true);

      // Assert - Should include summary + 2 compacted children
      expect(expanded).toHaveLength(3);
    });

    /**
     * Negative test: Verifies empty array for non-existent chunk.
     * Objective: Ensure graceful handling of missing chunk.
     */
    it('should return empty array for non-existent chunk', () => {
      // Arrange - no chunk created

      // Act
      const expanded = service.expand('ch_nonexistent1');

      // Assert
      expect(expanded).toEqual([]);
    });
  });

  // ==========================================================================
  // search() Tests
  // ==========================================================================

  describe('search()', () => {
    /**
     * Positive test: Verifies FTS search finds chunks by content.
     * Objective: Ensure full-text search works correctly.
     */
    it('should find chunks by content using FTS', () => {
      // Arrange
      service.create(
        'session_123',
        createTestContent({
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              parts: [{ type: 'text', text: 'implement authentication feature' }],
              timestamp: 0,
            },
          ],
        })
      );
      service.create(
        'session_123',
        createTestContent({
          messages: [
            {
              id: 'msg-2',
              role: 'user',
              parts: [{ type: 'text', text: 'fix database connection' }],
              timestamp: 0,
            },
          ],
        })
      );

      // Act
      const results = service.search('authentication');

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].chunk.content.messages[0].parts[0].text).toContain('authentication');
    });

    /**
     * Positive test: Verifies search filters by sessionId.
     * Objective: Ensure session filtering works.
     */
    it('should filter by sessionId', () => {
      // Arrange
      service.create(
        'session_1',
        createTestContent({
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              parts: [{ type: 'text', text: 'test query' }],
              timestamp: 0,
            },
          ],
        })
      );
      service.create(
        'session_2',
        createTestContent({
          messages: [
            {
              id: 'msg-2',
              role: 'user',
              parts: [{ type: 'text', text: 'test query' }],
              timestamp: 0,
            },
          ],
        })
      );

      // Act
      const results = service.search('test', { sessionId: 'session_1' });

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].chunk.sessionId).toBe('session_1');
    });

    /**
     * Positive test: Verifies search filters by depth.
     * Objective: Ensure depth filtering works.
     */
    it('should filter by depth', () => {
      // Arrange - Create chunks with different depths
      service.create(
        'session_123',
        createTestContent({
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              parts: [{ type: 'text', text: 'searchable content' }],
              timestamp: 0,
            },
          ],
        })
      );
      // Create a compacted chunk (depth 1)
      service.create('session_123', createTestContent());
      const result = service.compact('session_123', 'searchable summary');

      // Act
      const resultsDepth0 = service.search('searchable', { depth: 0 });
      const resultsDepth1 = service.search('searchable', { depth: 1 });

      // Assert
      expect(resultsDepth0.length).toBeGreaterThanOrEqual(1);
      expect(resultsDepth1).toHaveLength(1);
      expect(resultsDepth1[0].chunk.id).toBe(result?.summaryChunk.id);
    });

    /**
     * Positive test: Verifies search respects limit.
     * Objective: Ensure result limiting works.
     */
    it('should respect limit option', () => {
      // Arrange
      for (let i = 0; i < 5; i++) {
        service.create(
          'session_123',
          createTestContent({
            messages: [
              {
                id: `msg-${i}`,
                role: 'user',
                parts: [{ type: 'text', text: 'common search term' }],
                timestamp: 0,
              },
            ],
          })
        );
      }

      // Act
      const results = service.search('common', { limit: 2 });

      // Assert
      expect(results).toHaveLength(2);
    });
  });

  // ==========================================================================
  // getActiveChunks() Tests
  // ==========================================================================

  describe('getActiveChunks()', () => {
    /**
     * Positive test: Verifies active chunks are returned.
     * Objective: Ensure active chunk retrieval works.
     */
    it('should return active chunks for session', () => {
      // Arrange
      const sessionId = 'session_123';
      const chunk1 = service.create(sessionId, createTestContent());
      const chunk2 = service.create(sessionId, createTestContent());

      // Act
      const activeChunks = service.getActiveChunks(sessionId);

      // Assert
      expect(activeChunks).toHaveLength(2);
      expect(activeChunks.map((c) => c.id)).toContain(chunk1.id);
      expect(activeChunks.map((c) => c.id)).toContain(chunk2.id);
    });

    /**
     * Positive test: Verifies compacted chunks are excluded.
     * Objective: Ensure only active status chunks are returned.
     */
    it('should exclude compacted chunks', () => {
      // Arrange
      const sessionId = 'session_123';
      service.create(sessionId, createTestContent());
      service.create(sessionId, createTestContent());
      service.compact(sessionId, 'Summary');

      // Act
      const activeChunks = service.getActiveChunks(sessionId);

      // Assert - Only the summary chunk should be active
      expect(activeChunks).toHaveLength(1);
      expect(activeChunks[0].summary).toBe('Summary');
    });
  });

  // ==========================================================================
  // get() Tests
  // ==========================================================================

  describe('get()', () => {
    /**
     * Positive test: Verifies chunk retrieval by ID.
     * Objective: Ensure get returns the correct chunk.
     */
    it('should return chunk by ID', () => {
      // Arrange
      const created = service.create('session_123', createTestContent());

      // Act
      const chunk = service.get(created.id);

      // Assert
      expect(chunk).not.toBeNull();
      expect(chunk?.id).toBe(created.id);
    });

    /**
     * Negative test: Verifies null for non-existent ID.
     * Objective: Ensure graceful handling of missing chunk.
     */
    it('should return null for non-existent ID', () => {
      // Arrange - no chunk created

      // Act
      const chunk = service.get('ch_nonexistent1');

      // Assert
      expect(chunk).toBeNull();
    });
  });

  // ==========================================================================
  // delete() Tests
  // ==========================================================================

  describe('delete()', () => {
    /**
     * Positive test: Verifies chunk deletion.
     * Objective: Ensure chunks can be removed.
     */
    it('should remove chunk and return true', () => {
      // Arrange
      const chunk = service.create('session_123', createTestContent());

      // Act
      const result = service.delete(chunk.id);

      // Assert
      expect(result).toBe(true);
      expect(service.get(chunk.id)).toBeNull();
    });

    /**
     * Negative test: Verifies false for non-existent chunk.
     * Objective: Ensure graceful handling of missing chunk.
     */
    it('should return false for non-existent ID', () => {
      // Arrange - no chunk created

      // Act
      const result = service.delete('ch_nonexistent1');

      // Assert
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // deleteSession() Tests
  // ==========================================================================

  describe('deleteSession()', () => {
    /**
     * Positive test: Verifies all session chunks are removed.
     * Objective: Ensure session cleanup works correctly.
     */
    it('should remove all chunks for session', () => {
      // Arrange
      const sessionId = 'session_123';
      service.create(sessionId, createTestContent());
      service.create(sessionId, createTestContent());
      service.create(sessionId, createTestContent());

      // Act
      const deleted = service.deleteSession(sessionId);

      // Assert
      expect(deleted).toBe(3);
      expect(service.getActiveChunks(sessionId)).toEqual([]);
    });

    /**
     * Positive test: Verifies tracker is cleared.
     * Objective: Ensure tracker cleanup during session deletion.
     */
    it('should clear tracked messages for session', () => {
      // Arrange
      const sessionId = 'session_123';
      const tracker = getMessageTracker();
      tracker.trackMessage(sessionId, createTestMessage());
      service.create(sessionId, createTestContent());

      // Act
      service.deleteSession(sessionId);

      // Assert
      expect(tracker.getMessages(sessionId)).toEqual([]);
    });

    /**
     * Positive test: Verifies other sessions are not affected.
     * Objective: Ensure session isolation during deletion.
     */
    it('should not affect other sessions', () => {
      // Arrange
      service.create('session_1', createTestContent());
      service.create('session_2', createTestContent());

      // Act
      service.deleteSession('session_1');

      // Assert
      expect(service.getActiveChunks('session_2')).toHaveLength(1);
    });

    /**
     * Positive test: Verifies 0 is returned for empty session.
     * Objective: Ensure graceful handling of non-existent session.
     */
    it('should return 0 for non-existent session', () => {
      // Arrange - no chunks for this session

      // Act
      const deleted = service.deleteSession('unknown_session');

      // Assert
      expect(deleted).toBe(0);
    });
  });
});

// =============================================================================
// Singleton Tests
// =============================================================================

describe('ChunkService Singleton', () => {
  let db: DatabaseLike;
  let tempDir: string;

  beforeEach(() => {
    const result = createTestDatabase();
    db = result.db;
    tempDir = result.tempDir;
    resetChunkService();
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
    resetChunkService();
  });

  /**
   * Positive test: Verifies singleton initialization.
   * Objective: Ensure initializeChunkService creates instance.
   */
  it('should initialize singleton with initializeChunkService()', () => {
    // Arrange
    const config = createTestConfig();

    // Act
    const service = initializeChunkService(db, config);

    // Assert
    expect(service).toBeInstanceOf(ChunkService);
  });

  /**
   * Positive test: Verifies singleton returns same instance.
   * Objective: Ensure singleton pattern works correctly.
   */
  it('should return same instance from getChunkService()', () => {
    // Arrange
    const config = createTestConfig();
    const service1 = initializeChunkService(db, config);

    // Act
    const service2 = getChunkService();

    // Assert
    expect(service1).toBe(service2);
  });

  /**
   * Negative test: Verifies error when not initialized.
   * Objective: Ensure proper error for uninitialized access.
   */
  it('should throw error if getChunkService() called before initialization', () => {
    // Arrange - not initialized

    // Act & Assert
    expect(() => getChunkService()).toThrow(
      'ChunkService not initialized. Call initializeChunkService() first.'
    );
  });

  /**
   * Positive test: Verifies reset clears singleton.
   * Objective: Ensure reset allows reinitialization.
   */
  it('should allow reinitialization after resetChunkService()', () => {
    // Arrange
    const config = createTestConfig();
    initializeChunkService(db, config);
    resetChunkService();

    // Act & Assert - Should throw because singleton was reset
    expect(() => getChunkService()).toThrow();
  });
});
