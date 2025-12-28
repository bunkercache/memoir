/**
 * Compaction Hook Tests
 *
 * Tests for the handleCompaction hook which:
 * - Injects chunk summaries into compaction context
 * - Provides chunk references for later expansion
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseLike } from '../db/index.ts';
import { rmSync } from 'node:fs';
import { initializeMemoryService, resetMemoryService } from '../memory/index.ts';
import {
  initializeChunkService,
  resetChunkService,
  resetMessageTracker,
  getChunkService,
} from '../chunks/index.ts';
import { DEFAULT_CONFIG } from '../config/defaults.ts';
import type { ResolvedMemoirConfig, ChunkContent } from '../types.ts';
import { handleCompaction, type CompactionInput, type CompactionOutput } from './compaction.ts';
import { createTestDatabase } from '../db/test-utils.ts';

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestConfig(): ResolvedMemoirConfig {
  return { ...DEFAULT_CONFIG };
}

function createMockInput(sessionID: string): CompactionInput {
  return { sessionID };
}

function createMockOutput(): CompactionOutput {
  return {
    context: [],
    prompt: undefined,
  };
}

function createTestChunkContent(messageText: string): ChunkContent {
  return {
    messages: [
      {
        id: `msg-${Date.now()}`,
        role: 'user',
        parts: [{ type: 'text', text: messageText }],
        timestamp: Math.floor(Date.now() / 1000),
      },
    ],
    metadata: {
      tools_used: ['read', 'write'],
      files_modified: ['src/index.ts'],
      outcome: 'success',
    },
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('handleCompaction', () => {
  let db: DatabaseLike;
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory and database
    const result = createTestDatabase();
    db = result.db;
    tempDir = result.tempDir;

    // Initialize services
    const config = createTestConfig();
    initializeMemoryService(db, config);
    initializeChunkService(db, config);
  });

  afterEach(() => {
    resetMemoryService();
    resetChunkService();
    resetMessageTracker();
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // POSITIVE TESTS
  // ===========================================================================

  describe('chunk context injection', () => {
    /**
     * Objective: Verify that chunk context is injected when active chunks exist.
     * This test ensures the hook adds context with chunk summaries.
     */
    it('should inject chunk context when active chunks exist', async () => {
      // Arrange: Create active chunks for the session
      const chunkService = getChunkService();
      const sessionID = 'session-with-chunks';

      chunkService.create(sessionID, createTestChunkContent('First task'));
      chunkService.create(sessionID, createTestChunkContent('Second task'));

      const input = createMockInput(sessionID);
      const output = createMockOutput();

      // Act
      await handleCompaction(input, output);

      // Assert: Context should be added
      expect(output.context.length).toBe(1);
      expect(output.context[0]).toContain('Session History');
    });

    /**
     * Objective: Verify that chunk summaries are formatted with IDs.
     * This test ensures each chunk is listed with its ID for reference.
     */
    it('should format chunk summaries with IDs', async () => {
      // Arrange
      const chunkService = getChunkService();
      const sessionID = 'session-format';

      const chunk = chunkService.create(sessionID, createTestChunkContent('Test task'));

      const input = createMockInput(sessionID);
      const output = createMockOutput();

      // Act
      await handleCompaction(input, output);

      // Assert: Context should contain chunk ID
      expect(output.context[0]).toContain(`[${chunk.id}]`);
    });

    /**
     * Objective: Verify that instructions for referencing chunks are included.
     * This test ensures the context includes guidance for the LLM.
     */
    it('should include instructions for referencing chunks', async () => {
      // Arrange
      const chunkService = getChunkService();
      const sessionID = 'session-instructions';

      chunkService.create(sessionID, createTestChunkContent('Some work'));

      const input = createMockInput(sessionID);
      const output = createMockOutput();

      // Act
      await handleCompaction(input, output);

      // Assert: Context should include instructions
      expect(output.context[0]).toContain('IMPORTANT');
      expect(output.context[0]).toContain('[chunk_id]');
      expect(output.context[0]).toContain('memoir_expand');
    });

    /**
     * Objective: Verify that chunk metadata is included in summaries.
     * This test ensures tools used and files modified are shown.
     */
    it('should include chunk metadata in summaries', async () => {
      // Arrange
      const chunkService = getChunkService();
      const sessionID = 'session-metadata';

      const content: ChunkContent = {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Working on task' }],
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
        metadata: {
          tools_used: ['bash', 'edit'],
          files_modified: ['src/app.ts', 'src/utils.ts'],
          outcome: 'success',
        },
      };

      chunkService.create(sessionID, content);

      const input = createMockInput(sessionID);
      const output = createMockOutput();

      // Act
      await handleCompaction(input, output);

      // Assert: Context should include metadata
      expect(output.context[0]).toContain('tools:');
      expect(output.context[0]).toContain('files modified');
    });

    /**
     * Objective: Verify that chunks with summaries use the summary text.
     * This test ensures existing summaries are preferred over generated ones.
     */
    it('should use existing summary when available', async () => {
      // Arrange
      const chunkService = getChunkService();
      const sessionID = 'session-summary';

      // Create chunks and compact them to get a summary
      chunkService.create(sessionID, createTestChunkContent('Task 1'));
      chunkService.create(sessionID, createTestChunkContent('Task 2'));

      // Compact to create a summary chunk
      const result = chunkService.compact(sessionID, 'Completed authentication feature');

      // Verify we have a summary chunk
      expect(result).not.toBeNull();
      expect(result!.summaryChunk.summary).toBe('Completed authentication feature');

      const input = createMockInput(sessionID);
      const output = createMockOutput();

      // Act
      await handleCompaction(input, output);

      // Assert: Context should use the summary text
      expect(output.context[0]).toContain('Completed authentication feature');
    });
  });

  // ===========================================================================
  // NEGATIVE TESTS
  // ===========================================================================

  describe('no active chunks', () => {
    /**
     * Objective: Verify that output is NOT modified when no active chunks exist.
     * This test ensures the hook exits early without adding context.
     */
    it('should NOT modify output when no active chunks exist', async () => {
      // Arrange: No chunks created for this session
      const input = createMockInput('session-empty');
      const output = createMockOutput();

      // Act
      await handleCompaction(input, output);

      // Assert: Context should remain empty
      expect(output.context.length).toBe(0);
    });

    /**
     * Objective: Verify that output is NOT modified for a different session.
     * This test ensures chunks from other sessions are not included.
     */
    it('should NOT include chunks from other sessions', async () => {
      // Arrange: Create chunks for a different session
      const chunkService = getChunkService();
      chunkService.create('other-session', createTestChunkContent('Other session work'));

      const input = createMockInput('target-session');
      const output = createMockOutput();

      // Act
      await handleCompaction(input, output);

      // Assert: Context should remain empty
      expect(output.context.length).toBe(0);
    });
  });

  describe('compacted chunks', () => {
    /**
     * Objective: Verify that compacted chunks are not included in context.
     * This test ensures only active chunks are shown.
     */
    it('should only include active chunks, not compacted ones', async () => {
      // Arrange
      const chunkService = getChunkService();
      const sessionID = 'session-compacted';

      // Create and compact chunks
      chunkService.create(sessionID, createTestChunkContent('Task 1'));
      chunkService.create(sessionID, createTestChunkContent('Task 2'));
      const result = chunkService.compact(sessionID, 'Summary of tasks');

      // Verify compaction worked
      expect(result).not.toBeNull();
      expect(result!.compactedChunks.length).toBe(2);

      const input = createMockInput(sessionID);
      const output = createMockOutput();

      // Act
      await handleCompaction(input, output);

      // Assert: Only the summary chunk should be in context
      expect(output.context.length).toBe(1);
      // Should contain the summary chunk ID, not the compacted chunk IDs
      expect(output.context[0]).toContain(result!.summaryChunk.id);
    });
  });
});
