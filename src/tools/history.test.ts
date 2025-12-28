/**
 * History Tool Tests
 *
 * Tests for the historyTool which:
 * - Searches session history for past work
 * - Returns chunk summaries with IDs for expansion
 * - Supports filtering by session, depth, and limit
 * - Defaults to current session, with options for all sessions or specific ones
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

/** Create a mock ToolContext for testing */
function createMockContext(sessionID: string = 'test-session') {
  return {
    sessionID,
    messageID: 'test-message',
    agent: 'test-agent',
    abort: new AbortController().signal,
  };
}

function createTestConfig(): ResolvedMemoirConfig {
  return { ...DEFAULT_CONFIG };
}

async function executeTool(
  args: {
    query?: string;
    all_sessions?: boolean;
    session_ids?: string[];
    depth?: number;
    limit?: number;
  } = {},
  sessionID: string = 'test-session'
): Promise<string> {
  return await historyTool.execute(args, createMockContext(sessionID));
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

      // Act - use all_sessions since chunks are in 'session-1', not the mock context session
      const response = await executeTool({ query: 'authentication', all_sessions: true });
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
      const response = await executeTool({ query: 'TypeScript', all_sessions: true });
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
      const response = await executeTool({ query: 'React', all_sessions: true });
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
      const response = await executeTool({ query: 'API', all_sessions: true });
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
      const response = await executeTool({ query: 'authentication', all_sessions: true });
      const result = parseJsonResponse(response);

      // Assert
      const chunks = result.chunks as Array<Record<string, unknown>>;
      const summaryChunk = chunks.find(
        (c) => c.summary === 'Completed user authentication feature'
      );
      expect(summaryChunk).toBeDefined();
    });
  });

  describe('browsing without query', () => {
    /**
     * Objective: Verify that omitting query returns recent chunks.
     */
    it('should return recent chunks when no query provided', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('session-1', createTestChunkContent('First task'));
      chunkService.create('session-1', createTestChunkContent('Second task'));

      // Act - no query, should return recent chunks
      const response = await executeTool({}, 'session-1');
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.mode).toBe('recent');
      expect(result.count).toBe(2);
      const chunks = result.chunks as Array<Record<string, unknown>>;
      expect(chunks.length).toBe(2);
    });

    /**
     * Objective: Verify that empty string query also returns recent chunks.
     */
    it('should treat empty string as no query', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('session-1', createTestChunkContent('Some work'));

      // Act
      const response = await executeTool({ query: '   ' }, 'session-1');
      const result = parseJsonResponse(response);

      // Assert
      expect(result.mode).toBe('recent');
    });
  });

  describe('session scoping', () => {
    /**
     * Objective: Verify that search defaults to current session only.
     * This is the new default behavior.
     */
    it('should default to current session only', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('current-session', createTestChunkContent('Work in current session'));
      chunkService.create('other-session', createTestChunkContent('Work in other session'));

      // Act - search from 'current-session' context, should only find current session chunks
      const response = await executeTool({ query: 'Work' }, 'current-session');
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.scope).toBe('current session');
      const chunks = result.chunks as Array<Record<string, unknown>>;
      expect(chunks.every((c) => c.sessionId === 'current-session')).toBe(true);
    });

    /**
     * Objective: Verify that all_sessions: true searches all sessions.
     */
    it('should search all sessions when all_sessions is true', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('session-a', createTestChunkContent('Work in session A'));
      chunkService.create('session-b', createTestChunkContent('Work in session B'));

      // Act
      const response = await executeTool({ query: 'Work', all_sessions: true });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.scope).toBe('all sessions');
      expect(result.count).toBeGreaterThanOrEqual(2);
    });

    /**
     * Objective: Verify that session_ids filters to specific sessions.
     */
    it('should filter by session_ids', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('session-a', createTestChunkContent('Work in session A'));
      chunkService.create('session-b', createTestChunkContent('Work in session B'));
      chunkService.create('session-c', createTestChunkContent('Work in session C'));

      // Act - only search session-a
      const response = await executeTool({
        query: 'Work',
        session_ids: ['session-a'],
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      const chunks = result.chunks as Array<Record<string, unknown>>;
      expect(chunks.every((c) => c.sessionId === 'session-a')).toBe(true);
    });
  });

  describe('filtering', () => {
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
        all_sessions: true,
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
        all_sessions: true,
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
        session_ids: ['session-a'],
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
      expect(result.message).toContain('No matches');
    });

    /**
     * Objective: Verify that hint is included when no results in current session.
     * This test ensures users know to try all_sessions.
     */
    it('should include hint about all_sessions when no results in current session', async () => {
      // Arrange: Create chunks in a different session
      const chunkService = getChunkService();
      chunkService.create('other-session', createTestChunkContent('Some work'));

      // Act - search from a different session
      const response = await executeTool({ query: 'work' }, 'test-session');
      const result = parseJsonResponse(response);

      // Assert
      expect(result.count).toBe(0);
      expect(result.hint).toContain('all_sessions');
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
        session_ids: ['non-existent-session'],
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
        all_sessions: true,
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
      const response = await executeTool({ query: 'Task', all_sessions: true });
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
      const response = await executeTool({ query: 'Test', all_sessions: true });
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
      const response = await executeTool({ query: 'Task', all_sessions: true });
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
    it('should include hint about memoir_expand', async () => {
      // Arrange
      const chunkService = getChunkService();
      chunkService.create('session-1', createTestChunkContent('Hint test task'));

      // Act
      const response = await executeTool({ query: 'Hint', all_sessions: true });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.hint).toContain('memoir_expand');
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
      const response = await executeTool({ query: 'searchable', all_sessions: true });
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
      const response = await executeTool({ query: 'Stats', all_sessions: true });
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
