/**
 * Memoir Tool Tests
 *
 * Tests for the memoirTool which provides modes for:
 * - add: Save a new memory
 * - search: Search memories by query
 * - list: List recent memories
 * - forget: Delete a memory by ID
 * - help: Show usage information
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseLike } from '../db/index.ts';
import { rmSync } from 'node:fs';
import { initializeMemoryService, resetMemoryService, getMemoryService } from '../memory/index.ts';
import { initializeChunkService, resetChunkService, resetMessageTracker } from '../chunks/index.ts';
import { DEFAULT_CONFIG } from '../config/defaults.ts';
import type { ResolvedMemoirConfig } from '../types.ts';
import { memoirTool } from './memoir.ts';
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

// Helper to execute the tool and parse JSON response
async function executeTool(args: Record<string, unknown>): Promise<string> {
  return await memoirTool.execute(args as Parameters<typeof memoirTool.execute>[0], mockContext);
}

function parseJsonResponse(response: string): Record<string, unknown> {
  return JSON.parse(response) as Record<string, unknown>;
}

// =============================================================================
// TESTS
// =============================================================================

describe('memoirTool', () => {
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

  describe('add mode', () => {
    /**
     * Objective: Verify that add mode creates a memory with content and type.
     * This test ensures memories are properly saved to the database.
     */
    it('should create memory with content and type', async () => {
      // Arrange
      const args = {
        mode: 'add' as const,
        content: 'Always use strict TypeScript mode',
        type: 'preference' as const,
      };

      // Act
      const response = await executeTool(args);
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.memory).toBeDefined();
      const memory = result.memory as Record<string, unknown>;
      expect(memory.content).toBe('Always use strict TypeScript mode');
      expect(memory.type).toBe('preference');
      expect(memory.id).toMatch(/^mem_/);
    });

    /**
     * Objective: Verify that add mode works with all memory types.
     * This test ensures all valid types are accepted.
     */
    it('should accept all valid memory types', async () => {
      // Arrange
      const types = ['preference', 'pattern', 'gotcha', 'fact', 'learned'] as const;

      for (const type of types) {
        // Act
        const response = await executeTool({
          mode: 'add',
          content: `Test memory of type ${type}`,
          type,
        });
        const result = parseJsonResponse(response);

        // Assert
        expect(result.success).toBe(true);
        const memory = result.memory as Record<string, unknown>;
        expect(memory.type).toBe(type);
      }
    });
  });

  describe('search mode', () => {
    /**
     * Objective: Verify that search mode finds relevant memories.
     * This test ensures full-text search works correctly.
     */
    it('should search memories by query', async () => {
      // Arrange: Add some memories
      const memoryService = getMemoryService();
      memoryService.add('Use TypeScript strict mode', 'preference');
      memoryService.add('Prefer functional programming patterns', 'pattern');
      memoryService.add('Avoid using any type', 'gotcha');

      // Act
      const response = await executeTool({
        mode: 'search',
        query: 'TypeScript',
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThan(0);
      const memories = result.memories as Array<Record<string, unknown>>;
      expect(memories.some((m) => (m.content as string).includes('TypeScript'))).toBe(true);
    });

    /**
     * Objective: Verify that search mode respects limit parameter.
     * This test ensures pagination works correctly.
     */
    it('should respect limit parameter in search', async () => {
      // Arrange: Add multiple memories
      const memoryService = getMemoryService();
      for (let i = 0; i < 10; i++) {
        memoryService.add(`Test memory number ${i}`, 'fact');
      }

      // Act
      const response = await executeTool({
        mode: 'search',
        query: 'memory',
        limit: 3,
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      const memories = result.memories as Array<Record<string, unknown>>;
      expect(memories.length).toBeLessThanOrEqual(3);
    });

    /**
     * Objective: Verify that search results include rank information.
     * This test ensures relevance scoring is returned.
     */
    it('should include rank in search results', async () => {
      // Arrange
      const memoryService = getMemoryService();
      memoryService.add('TypeScript configuration guide', 'fact');

      // Act
      const response = await executeTool({
        mode: 'search',
        query: 'TypeScript',
      });
      const result = parseJsonResponse(response);

      // Assert
      const memories = result.memories as Array<Record<string, unknown>>;
      expect(memories[0].rank).toBeDefined();
      expect(typeof memories[0].rank).toBe('number');
    });
  });

  describe('list mode', () => {
    /**
     * Objective: Verify that list mode returns all memories.
     * This test ensures listing works without filters.
     */
    it('should list memories', async () => {
      // Arrange
      const memoryService = getMemoryService();
      memoryService.add('Memory 1', 'fact');
      memoryService.add('Memory 2', 'preference');
      memoryService.add('Memory 3', 'pattern');

      // Act
      const response = await executeTool({ mode: 'list' });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
      const memories = result.memories as Array<Record<string, unknown>>;
      expect(memories.length).toBe(3);
    });

    /**
     * Objective: Verify that list mode filters by type.
     * This test ensures type filtering works correctly.
     */
    it('should filter by type', async () => {
      // Arrange
      const memoryService = getMemoryService();
      memoryService.add('Preference 1', 'preference');
      memoryService.add('Preference 2', 'preference');
      memoryService.add('Fact 1', 'fact');

      // Act
      const response = await executeTool({
        mode: 'list',
        type: 'preference',
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      const memories = result.memories as Array<Record<string, unknown>>;
      expect(memories.every((m) => m.type === 'preference')).toBe(true);
    });

    /**
     * Objective: Verify that list mode respects limit parameter.
     * This test ensures pagination works correctly.
     */
    it('should respect limit parameter in list', async () => {
      // Arrange
      const memoryService = getMemoryService();
      for (let i = 0; i < 10; i++) {
        memoryService.add(`Memory ${i}`, 'fact');
      }

      // Act
      const response = await executeTool({
        mode: 'list',
        limit: 5,
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      const memories = result.memories as Array<Record<string, unknown>>;
      expect(memories.length).toBe(5);
    });
  });

  describe('forget mode', () => {
    /**
     * Objective: Verify that forget mode deletes a memory.
     * This test ensures memories can be removed.
     */
    it('should delete memory by ID', async () => {
      // Arrange
      const memoryService = getMemoryService();
      const memory = memoryService.add('Memory to delete', 'fact');

      // Verify memory exists
      expect(memoryService.get(memory.id)).not.toBeNull();

      // Act
      const response = await executeTool({
        mode: 'forget',
        memoryId: memory.id,
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe('Memory deleted');
      expect(memoryService.get(memory.id)).toBeNull();
    });

    /**
     * Objective: Verify that forget mode handles non-existent memory.
     * This test ensures graceful handling of missing memories.
     */
    it('should handle non-existent memory gracefully', async () => {
      // Arrange
      const nonExistentId = 'mem_nonexistent123';

      // Act
      const response = await executeTool({
        mode: 'forget',
        memoryId: nonExistentId,
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toBe('Memory not found');
    });
  });

  describe('help mode', () => {
    /**
     * Objective: Verify that help mode returns usage information.
     * This test ensures help text is displayed.
     */
    it('should return help text', async () => {
      // Act
      const response = await executeTool({ mode: 'help' });

      // Assert: Help text is not JSON, it's plain text
      expect(response).toContain('Memoir Tool');
      expect(response).toContain('add');
      expect(response).toContain('search');
      expect(response).toContain('list');
      expect(response).toContain('forget');
    });
  });

  describe('default mode', () => {
    /**
     * Objective: Verify that default mode (no mode specified) returns help.
     * This test ensures help is shown when mode is omitted.
     */
    it('should return help when mode is not specified', async () => {
      // Act
      const response = await executeTool({});

      // Assert
      expect(response).toContain('Memoir Tool');
      expect(response).toContain('Modes:');
    });
  });

  // ===========================================================================
  // NEGATIVE TESTS
  // ===========================================================================

  describe('add mode validation', () => {
    /**
     * Objective: Verify that add mode fails without content.
     * This test ensures content is required for adding memories.
     */
    it('should fail without content', async () => {
      // Arrange
      const args = {
        mode: 'add' as const,
        type: 'preference' as const,
        // content is missing
      };

      // Act
      const response = await executeTool(args);
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('content is required for add mode');
    });

    /**
     * Objective: Verify that add mode fails without type.
     * This test ensures type is required for adding memories.
     */
    it('should fail without type', async () => {
      // Arrange
      const args = {
        mode: 'add' as const,
        content: 'Some content',
        // type is missing
      };

      // Act
      const response = await executeTool(args);
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('type is required for add mode');
    });

    /**
     * Objective: Verify that add mode fails with empty content.
     * This test ensures empty strings are not accepted.
     */
    it('should fail with empty content', async () => {
      // Arrange
      const args = {
        mode: 'add' as const,
        content: '',
        type: 'preference' as const,
      };

      // Act
      const response = await executeTool(args);
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('content is required for add mode');
    });
  });

  describe('search mode validation', () => {
    /**
     * Objective: Verify that search mode fails without query.
     * This test ensures query is required for searching.
     */
    it('should fail without query', async () => {
      // Arrange
      const args = {
        mode: 'search' as const,
        // query is missing
      };

      // Act
      const response = await executeTool(args);
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('query is required for search mode');
    });

    /**
     * Objective: Verify that search mode handles empty results.
     * This test ensures no matches returns empty array.
     */
    it('should return empty results for no matches', async () => {
      // Arrange: No memories added

      // Act
      const response = await executeTool({
        mode: 'search',
        query: 'nonexistent query',
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      const memories = result.memories as Array<Record<string, unknown>>;
      expect(memories.length).toBe(0);
    });
  });

  describe('forget mode validation', () => {
    /**
     * Objective: Verify that forget mode fails without memoryId.
     * This test ensures memoryId is required for deletion.
     */
    it('should fail without memoryId', async () => {
      // Arrange
      const args = {
        mode: 'forget' as const,
        // memoryId is missing
      };

      // Act
      const response = await executeTool(args);
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('memoryId is required for forget mode');
    });
  });

  describe('list mode edge cases', () => {
    /**
     * Objective: Verify that list mode handles empty database.
     * This test ensures no memories returns empty array.
     */
    it('should return empty list when no memories exist', async () => {
      // Arrange: No memories added

      // Act
      const response = await executeTool({ mode: 'list' });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      const memories = result.memories as Array<Record<string, unknown>>;
      expect(memories.length).toBe(0);
    });
  });
});
