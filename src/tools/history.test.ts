/**
 * History Tool Tests
 *
 * Tests for the historyTool which:
 * - Searches session history for past work
 * - Returns chunk summaries with IDs for expansion
 * - Supports filtering by session, depth, and limit
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
import { historyTool } from './history.ts';
import { createTestDatabase } from '../db/test-utils.ts';

// =============================================================================
// TEST HELPERS
// =============================================================================

/** Mock ToolContext for testing */
const mockContext = {
  sessionID: 'test-session',
  messageID: 'test-message',
  agent: 'test-agent',
  abort: new AbortController().signal,
};

function createTestConfig(): ResolvedMemoirConfig {
  return { ...DEFAULT_CONFIG };
}

async function executeTool(args: {
  query: string;
  session_id?: string;
  depth?: number;
  limit?: number;
}): Promise<string> {
  return await historyTool.execute(args, mockContext);
}

function parseJsonResponse(response: string): Record<string, unknown> {
  return JSON.parse(response) as Record<string, unknown>;
}

function createTestChunkContent(messageText: string): ChunkContent {
  return {
    messages: [
      {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        role: 'user',
        parts: [{ type: 'text', text: messageText }],
        timestamp: Math.floor(Date.now() / 1000),
      },
    ],
    metadata: {
      outcome: 'success',
    },
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('historyTool', () => {
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

  describe('search functionality', () => {
    /**
     * Objective: Verify that history search finds chunks by query.
     * This test ensures full-text search works on chunk content.
     */
    it('should search chunks by query', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create(
        'session-1',
        createTestChunkContent('Implementing authentication feature')
      );
      chunkService.create('session-1', createTestChunkContent('Fixing database connection bug'));
      chunkService.create('session-1', createTestChunkContent('Adding unit tests'));

      // Act
      const response = await executeTool({ query: 'authentication' });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThan(0);
      const chunks = result.chunks as Array<Record<string, unknown>>;
      expect(chunks.length).toBeGreaterThan(0);
    });

    /**
     * Objective: Verify that search results include chunk IDs.
     * This test ensures IDs are available for expansion.
     */
    it('should return formatted results with IDs', async () => {
      // Arrange
      const chunkService = getChunkService();
      const chunk = chunkService.create(
        'session-1',
        createTestChunkContent('TypeScript configuration update')
      );

      // Act
      const response = await executeTool({ query: 'TypeScript' });
      const result = parseJsonResponse(response);

      // Assert
      const chunks = result.chunks as Array<Record<string, unknown>>;
      expect(chunks[0].id).toBe(chunk.id);
      expect(chunks[0].sessionId).toBe('session-1');
      expect(chunks[0].depth).toBeDefined();
      expect(chunks[0].status).toBeDefined();
    });

    /**
     * Objective: Verify that search results include rank information.
     * This test ensures relevance scoring is returned.
     */
    it('should include rank in search results', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('session-1', createTestChunkContent('React component development'));

      // Act
      const response = await executeTool({ query: 'React' });
      const result = parseJsonResponse(response);

      // Assert
      const chunks = result.chunks as Array<Record<string, unknown>>;
      expect(chunks[0].rank).toBeDefined();
      expect(typeof chunks[0].rank).toBe('number');
    });

    /**
     * Objective: Verify that search results include hint for expansion.
     * This test ensures users know how to get more details.
     */
    it('should include hint for expansion', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('session-1', createTestChunkContent('API endpoint implementation'));

      // Act
      const response = await executeTool({ query: 'API' });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.hint).toBeDefined();
      expect(result.hint).toContain('memoir_expand');
    });

    /**
     * Objective: Verify that summary is included in results.
     * This test ensures chunk summaries are shown.
     */
    it('should include summary in results', async () => {
      // Arrange
      const chunkService = getChunkService();

      // Create and compact chunks to get a summary
      chunkService.create('session-1', createTestChunkContent('Task 1'));
      chunkService.create('session-1', createTestChunkContent('Task 2'));
      chunkService.compact('session-1', 'Completed user authentication feature');

      // Act
      const response = await executeTool({ query: 'authentication' });
      const result = parseJsonResponse(response);

      // Assert
      const chunks = result.chunks as Array<Record<string, unknown>>;
      const summaryChunk = chunks.find(
        (c) => c.summary === 'Completed user authentication feature'
      );
      expect(summaryChunk).toBeDefined();
    });
  });

  describe('filtering', () => {
    /**
     * Objective: Verify that search can filter by session_id.
     * This test ensures session isolation works.
     */
    it('should filter by session_id', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('session-a', createTestChunkContent('Work in session A'));
      chunkService.create('session-b', createTestChunkContent('Work in session B'));

      // Act
      const response = await executeTool({
        query: 'Work',
        session_id: 'session-a',
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      const chunks = result.chunks as Array<Record<string, unknown>>;
      expect(chunks.every((c) => c.sessionId === 'session-a')).toBe(true);
    });

    /**
     * Objective: Verify that search can filter by depth.
     * This test ensures hierarchical filtering works.
     */
    it('should filter by depth', async () => {
      // Arrange
      const chunkService = getChunkService();

      // Create depth 0 chunks
      chunkService.create('session-1', createTestChunkContent('Depth 0 task'));
      chunkService.create('session-1', createTestChunkContent('Another depth 0 task'));

      // Compact to create depth 1 chunk
      chunkService.compact('session-1', 'Summary at depth 1');

      // Act: Search for depth >= 1 (summary chunks only)
      const response = await executeTool({
        query: 'Summary',
        depth: 1,
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      const chunks = result.chunks as Array<Record<string, unknown>>;
      expect(chunks.every((c) => (c.depth as number) >= 1)).toBe(true);
    });

    /**
     * Objective: Verify that search respects limit parameter.
     * This test ensures pagination works correctly.
     */
    it('should respect limit', async () => {
      // Arrange
      const chunkService = getChunkService();
      for (let i = 0; i < 10; i++) {
        chunkService.create('session-1', createTestChunkContent(`Task number ${i}`));
      }

      // Act
      const response = await executeTool({
        query: 'Task',
        limit: 3,
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      const chunks = result.chunks as Array<Record<string, unknown>>;
      expect(chunks.length).toBeLessThanOrEqual(3);
    });

    /**
     * Objective: Verify that multiple filters can be combined.
     * This test ensures filter composition works.
     */
    it('should combine multiple filters', async () => {
      // Arrange
      const chunkService = getChunkService();

      // Session A chunks
      chunkService.create('session-a', createTestChunkContent('Session A task 1'));
      chunkService.create('session-a', createTestChunkContent('Session A task 2'));
      chunkService.compact('session-a', 'Session A summary');

      // Session B chunks
      chunkService.create('session-b', createTestChunkContent('Session B task'));

      // Act: Filter by session and depth
      const response = await executeTool({
        query: 'Session',
        session_id: 'session-a',
        depth: 1,
        limit: 5,
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      const chunks = result.chunks as Array<Record<string, unknown>>;
      expect(chunks.every((c) => c.sessionId === 'session-a')).toBe(true);
      expect(chunks.every((c) => (c.depth as number) >= 1)).toBe(true);
    });
  });

  // ===========================================================================
  // NEGATIVE TESTS
  // ===========================================================================

  describe('no matches', () => {
    /**
     * Objective: Verify that empty results return appropriate message.
     * This test ensures graceful handling of no matches.
     */
    it('should return empty results message when no matches', async () => {
      // Arrange: No chunks created

      // Act
      const response = await executeTool({ query: 'nonexistent query' });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.message).toBe('No matching chunks found');
    });

    /**
     * Objective: Verify that no hint is included when no results.
     * This test ensures clean output for empty results.
     */
    it('should not include hint when no results', async () => {
      // Arrange: No chunks created

      // Act
      const response = await executeTool({ query: 'nothing here' });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.hint).toBeUndefined();
      expect(result.chunks).toBeUndefined();
    });
  });

  describe('session filtering edge cases', () => {
    /**
     * Objective: Verify that non-existent session returns empty results.
     * This test ensures graceful handling of missing sessions.
     */
    it('should return empty for non-existent session', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('existing-session', createTestChunkContent('Some work'));

      // Act
      const response = await executeTool({
        query: 'work',
        session_id: 'non-existent-session',
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
    });
  });

  describe('depth filtering edge cases', () => {
    /**
     * Objective: Verify that high depth filter returns empty when no deep chunks.
     * This test ensures depth filtering works correctly.
     */
    it('should return empty for depth higher than available', async () => {
      // Arrange: Only depth 0 chunks
      const chunkService = getChunkService();
      chunkService.create('session-1', createTestChunkContent('Shallow task'));

      // Act
      const response = await executeTool({
        query: 'task',
        depth: 5,
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
    });
  });

  describe('message count fallback', () => {
    /**
     * Objective: Verify that chunks without summary show message count.
     * This test ensures fallback summary is generated.
     */
    it('should show message count when no summary available', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('session-1', createTestChunkContent('Task without summary'));

      // Act
      const response = await executeTool({ query: 'Task' });
      const result = parseJsonResponse(response);

      // Assert
      const chunks = result.chunks as Array<Record<string, unknown>>;
      expect(chunks[0].summary).toContain('1 messages');
    });
  });

  describe('size estimation', () => {
    /**
     * Objective: Verify that search results include token estimates.
     * This test ensures context budget awareness.
     */
    it('should include estimated tokens in response', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('session-1', createTestChunkContent('Test task for estimation'));

      // Act
      const response = await executeTool({ query: 'Test' });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.estimated_tokens).toBeDefined();
      expect(typeof result.estimated_tokens).toBe('number');
      expect(result.estimated_tokens).toBeGreaterThan(0);
    });

    /**
     * Objective: Verify that search results include estimated expanded tokens.
     * This test ensures users know the cost of expanding all results.
     */
    it('should include estimated expanded tokens', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('session-1', createTestChunkContent('Task for expansion estimation'));

      // Act
      const response = await executeTool({ query: 'Task' });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.estimated_expanded_tokens).toBeDefined();
      expect(typeof result.estimated_expanded_tokens).toBe('number');
      expect(result.estimated_expanded_tokens).toBeGreaterThan(0);
    });

    /**
     * Objective: Verify that results include hint about preview mode.
     * This test ensures users know about preview_only option.
     */
    it('should include hint about preview mode', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('session-1', createTestChunkContent('Hint test task'));

      // Act
      const response = await executeTool({ query: 'Hint' });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.hint).toContain('preview_only');
    });

    /**
     * Objective: Verify that warning is included for large result sets.
     * This test ensures subagent delegation is suggested.
     */
    it('should include warning for many results', async () => {
      // Arrange: Create many chunks
      const chunkService = getChunkService();
      for (let i = 0; i < 10; i++) {
        chunkService.create(
          'session-1',
          createTestChunkContent(`Task ${i} with searchable content`)
        );
      }

      // Act
      const response = await executeTool({ query: 'searchable' });
      const result = parseJsonResponse(response);

      // Assert: Should have warning about expanding many results
      if ((result.count as number) > 3) {
        expect(result.warning).toBeDefined();
        expect(result.warning).toContain('subagent');
      }
    });

    /**
     * Objective: Verify that chunk stats are included in results.
     * This test ensures users can see file/message counts.
     */
    it('should include stats in chunk results', async () => {
      // Arrange
      const chunkService = getChunkService();
      const content: ChunkContent = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'Stats test message' }],
            timestamp: Math.floor(Date.now() / 1000),
          },
          {
            id: 'msg-2',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Response' }],
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
        metadata: {
          files_modified: ['file1.ts', 'file2.ts'],
          tools_used: ['read', 'edit'],
        },
      };
      chunkService.create('session-1', content);

      // Act
      const response = await executeTool({ query: 'Stats' });
      const result = parseJsonResponse(response);

      // Assert
      const chunks = result.chunks as Array<Record<string, unknown>>;
      expect(chunks[0].stats).toBeDefined();
      const stats = chunks[0].stats as Record<string, unknown>;
      expect(stats.messages).toBe(2);
      expect(stats.files_modified).toBe(2);
    });
  });
});
