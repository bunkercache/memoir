/**
 * Expand Tool Tests
 *
 * Tests for the expandTool which:
 * - Expands a chunk to see its full content
 * - Formats chunk content as markdown
 * - Optionally includes child chunks
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
import { expandTool } from './expand.ts';
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
  chunk_id: string;
  include_children?: boolean;
  preview_only?: boolean;
}): Promise<string> {
  return await expandTool.execute(args, mockContext);
}

function parseJsonResponse(response: string): Record<string, unknown> {
  return JSON.parse(response) as Record<string, unknown>;
}

function createTestChunkContent(options: {
  userMessage?: string;
  assistantMessage?: string;
  tools?: string[];
  files?: string[];
}): ChunkContent {
  const messages: ChunkContent['messages'] = [];
  const timestamp = Math.floor(Date.now() / 1000);

  if (options.userMessage) {
    messages.push({
      id: `msg-user-${Date.now()}`,
      role: 'user',
      parts: [{ type: 'text', text: options.userMessage }],
      timestamp,
    });
  }

  if (options.assistantMessage) {
    messages.push({
      id: `msg-assistant-${Date.now()}`,
      role: 'assistant',
      parts: [{ type: 'text', text: options.assistantMessage }],
      timestamp: timestamp + 1,
    });
  }

  return {
    messages,
    metadata: {
      tools_used: options.tools,
      files_modified: options.files,
      outcome: 'success',
    },
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('expandTool', () => {
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

  describe('chunk expansion', () => {
    /**
     * Objective: Verify that expand returns chunk content by ID.
     * This test ensures chunks can be retrieved and displayed.
     */
    it('should expand chunk by ID', async () => {
      // Arrange
      const chunkService = getChunkService();
      const chunk = chunkService.create(
        'test-session',
        createTestChunkContent({
          userMessage: 'How do I fix this bug?',
          assistantMessage: 'Here is the solution...',
        })
      );

      // Act
      const response = await executeTool({ chunk_id: chunk.id });
      const result = parseJsonResponse(response);

      // Assert: Response should contain chunk content
      expect(result.success).toBe(true);
      expect(result.content).toContain(`## Chunk ${chunk.id}`);
      expect(result.content).toContain('test-session');
      expect(result.estimated_tokens).toBeGreaterThan(0);
    });

    /**
     * Objective: Verify that chunk content is formatted as markdown.
     * This test ensures proper formatting for readability.
     */
    it('should format chunk content as markdown', async () => {
      // Arrange
      const chunkService = getChunkService();
      const chunk = chunkService.create(
        'test-session',
        createTestChunkContent({
          userMessage: 'Test message',
        })
      );

      // Act
      const response = await executeTool({ chunk_id: chunk.id });
      const result = parseJsonResponse(response);

      // Assert: Should have markdown headers in content
      expect(result.content).toContain('## Chunk');
      expect(result.content).toContain('### Messages');
    });

    /**
     * Objective: Verify that messages include role information.
     * This test ensures user/assistant roles are displayed.
     */
    it('should include messages with roles', async () => {
      // Arrange
      const chunkService = getChunkService();
      const chunk = chunkService.create(
        'test-session',
        createTestChunkContent({
          userMessage: 'User question here',
          assistantMessage: 'Assistant response here',
        })
      );

      // Act
      const response = await executeTool({ chunk_id: chunk.id });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.content).toContain('**user**');
      expect(result.content).toContain('**assistant**');
      expect(result.content).toContain('User question here');
      expect(result.content).toContain('Assistant response here');
    });

    /**
     * Objective: Verify that metadata (files, tools) is included.
     * This test ensures context information is displayed.
     */
    it('should include metadata (files, tools)', async () => {
      // Arrange
      const chunkService = getChunkService();
      const chunk = chunkService.create(
        'test-session',
        createTestChunkContent({
          userMessage: 'Fix the bug',
          tools: ['read', 'edit', 'bash'],
          files: ['src/index.ts', 'src/utils.ts'],
        })
      );

      // Act
      const response = await executeTool({ chunk_id: chunk.id });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.content).toContain('### Files Modified');
      expect(result.content).toContain('src/index.ts');
      expect(result.content).toContain('src/utils.ts');
      expect(result.content).toContain('### Tools Used');
      expect(result.content).toContain('read');
      expect(result.content).toContain('edit');
      expect(result.content).toContain('bash');
    });

    /**
     * Objective: Verify that chunk status and depth are shown.
     * This test ensures chunk metadata is displayed.
     */
    it('should include chunk status and depth', async () => {
      // Arrange
      const chunkService = getChunkService();
      const chunk = chunkService.create(
        'test-session',
        createTestChunkContent({ userMessage: 'Test' })
      );

      // Act
      const response = await executeTool({ chunk_id: chunk.id });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.content).toContain('Status: active');
      expect(result.content).toContain('Depth: 0');
    });

    /**
     * Objective: Verify that summary is shown when available.
     * This test ensures compacted chunk summaries are displayed.
     */
    it('should include summary when available', async () => {
      // Arrange
      const chunkService = getChunkService();

      // Create chunks and compact them
      chunkService.create('test-session', createTestChunkContent({ userMessage: 'Task 1' }));
      chunkService.create('test-session', createTestChunkContent({ userMessage: 'Task 2' }));
      const compactResult = chunkService.compact(
        'test-session',
        'Completed authentication feature'
      );

      expect(compactResult).not.toBeNull();

      // Act
      const response = await executeTool({ chunk_id: compactResult!.summaryChunk.id });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.content).toContain('### Summary');
      expect(result.content).toContain('Completed authentication feature');
    });
  });

  describe('include children', () => {
    /**
     * Objective: Verify that children are included when requested.
     * This test ensures hierarchical expansion works.
     */
    it('should include children when requested', async () => {
      // Arrange
      const chunkService = getChunkService();

      // Create chunks and compact them to create parent-child relationship
      const child1 = chunkService.create(
        'test-session',
        createTestChunkContent({ userMessage: 'Child task 1' })
      );
      const child2 = chunkService.create(
        'test-session',
        createTestChunkContent({ userMessage: 'Child task 2' })
      );
      const compactResult = chunkService.compact('test-session', 'Parent summary');

      expect(compactResult).not.toBeNull();

      // Act
      const response = await executeTool({
        chunk_id: compactResult!.summaryChunk.id,
        include_children: true,
      });
      const result = parseJsonResponse(response);

      // Assert: Should contain both parent and children
      expect(result.content).toContain(compactResult!.summaryChunk.id);
      expect(result.content).toContain(child1.id);
      expect(result.content).toContain(child2.id);
      expect(result.content).toContain('Child task 1');
      expect(result.content).toContain('Child task 2');
      expect(result.chunk_count).toBe(3); // parent + 2 children
    });

    /**
     * Objective: Verify that children are separated in output.
     * This test ensures multiple chunks are clearly delineated.
     */
    it('should separate multiple chunks with dividers', async () => {
      // Arrange
      const chunkService = getChunkService();

      chunkService.create('test-session', createTestChunkContent({ userMessage: 'Task 1' }));
      chunkService.create('test-session', createTestChunkContent({ userMessage: 'Task 2' }));
      const compactResult = chunkService.compact('test-session', 'Summary');

      expect(compactResult).not.toBeNull();

      // Act
      const response = await executeTool({
        chunk_id: compactResult!.summaryChunk.id,
        include_children: true,
      });
      const result = parseJsonResponse(response);

      // Assert: Should have dividers between chunks
      expect(result.content).toContain('---');
    });

    /**
     * Objective: Verify that include_children=false only returns the chunk.
     * This test ensures default behavior is single chunk.
     */
    it('should only return single chunk when include_children is false', async () => {
      // Arrange
      const chunkService = getChunkService();

      chunkService.create('test-session', createTestChunkContent({ userMessage: 'Task 1' }));
      chunkService.create('test-session', createTestChunkContent({ userMessage: 'Task 2' }));
      const compactResult = chunkService.compact('test-session', 'Summary');

      expect(compactResult).not.toBeNull();

      // Act
      const response = await executeTool({
        chunk_id: compactResult!.summaryChunk.id,
        include_children: false,
      });
      const result = parseJsonResponse(response);

      // Assert: Should only contain parent chunk
      expect(result.content).toContain(compactResult!.summaryChunk.id);
      expect(result.content).not.toContain('Task 1');
      expect(result.content).not.toContain('Task 2');
      expect(result.chunk_count).toBe(1);
    });
  });

  describe('message part types', () => {
    /**
     * Objective: Verify that tool parts are formatted correctly.
     * This test ensures tool invocations are displayed.
     */
    it('should format tool parts correctly', async () => {
      // Arrange
      const chunkService = getChunkService();
      const content: ChunkContent = {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            parts: [
              { type: 'text', text: 'Let me check that file' },
              { type: 'tool', tool: 'read', input: { path: 'file.ts' }, output: 'content' },
            ],
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
        metadata: {},
      };
      const chunk = chunkService.create('test-session', content);

      // Act
      const response = await executeTool({ chunk_id: chunk.id });
      const result = parseJsonResponse(response);

      // Assert - tool parts now show input/output
      expect(result.content).toContain('**Tool: read**');
      expect(result.content).toContain('Input:');
      expect(result.content).toContain('"path": "file.ts"');
      expect(result.content).toContain('Output:');
      expect(result.content).toContain('content');
    });

    /**
     * Objective: Verify that reasoning parts are formatted correctly.
     * This test ensures thinking/reasoning is displayed.
     */
    it('should format reasoning parts correctly', async () => {
      // Arrange
      const chunkService = getChunkService();
      const content: ChunkContent = {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            parts: [{ type: 'reasoning', text: 'Thinking about the problem...' }],
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
        metadata: {},
      };
      const chunk = chunkService.create('test-session', content);

      // Act
      const response = await executeTool({ chunk_id: chunk.id });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.content).toContain('[Reasoning: Thinking about the problem...]');
    });

    /**
     * Objective: Verify that file parts are formatted correctly.
     * This test ensures file references are displayed.
     */
    it('should format file parts correctly', async () => {
      // Arrange
      const chunkService = getChunkService();
      const content: ChunkContent = {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            parts: [{ type: 'file', text: 'src/important.ts' }],
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
        metadata: {},
      };
      const chunk = chunkService.create('test-session', content);

      // Act
      const response = await executeTool({ chunk_id: chunk.id });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.content).toContain('[File: src/important.ts]');
    });
  });

  describe('preview mode', () => {
    /**
     * Objective: Verify that preview_only returns metadata without full content.
     * This test ensures preview mode is lightweight.
     */
    it('should return preview with metadata when preview_only is true', async () => {
      // Arrange
      const chunkService = getChunkService();
      const chunk = chunkService.create(
        'test-session',
        createTestChunkContent({
          userMessage: 'A very long message that should not appear in preview',
          assistantMessage: 'Another long response',
          tools: ['read', 'edit'],
          files: ['src/index.ts'],
        })
      );

      // Act
      const response = await executeTool({ chunk_id: chunk.id, preview_only: true });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(true);
      expect(result.mode).toBe('preview');
      expect(result.chunk_count).toBe(1);
      expect(result.estimated_full_tokens).toBeGreaterThan(0);
      expect(result.previews).toContain('### Stats');
      expect(result.previews).toContain('Messages: 2');
      expect(result.previews).toContain('Files modified: 1');
      // Should NOT contain full message content
      expect(result.previews).not.toContain('A very long message that should not appear');
    });

    /**
     * Objective: Verify that preview includes size estimates.
     * This test ensures token estimation is provided.
     */
    it('should include estimated full size in preview', async () => {
      // Arrange
      const chunkService = getChunkService();
      const chunk = chunkService.create(
        'test-session',
        createTestChunkContent({
          userMessage: 'Test message',
        })
      );

      // Act
      const response = await executeTool({ chunk_id: chunk.id, preview_only: true });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.estimated_full_tokens).toBeGreaterThan(0);
      expect(result.previews).toContain('Estimated full size:');
    });

    /**
     * Objective: Verify that preview includes child chunk IDs for summary chunks.
     * This test ensures navigation hints are provided.
     */
    it('should include child refs in preview for summary chunks', async () => {
      // Arrange
      const chunkService = getChunkService();

      const child1 = chunkService.create(
        'test-session',
        createTestChunkContent({ userMessage: 'Child 1' })
      );
      const child2 = chunkService.create(
        'test-session',
        createTestChunkContent({ userMessage: 'Child 2' })
      );
      const compactResult = chunkService.compact('test-session', 'Summary of work');

      expect(compactResult).not.toBeNull();

      // Act
      const response = await executeTool({
        chunk_id: compactResult!.summaryChunk.id,
        preview_only: true,
      });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.previews).toContain('### Child Chunks');
      expect(result.previews).toContain(child1.id);
      expect(result.previews).toContain(child2.id);
    });

    /**
     * Objective: Verify that preview provides hint for large expansions.
     * This test ensures subagent recommendation is given.
     */
    it('should include hint about full expansion', async () => {
      // Arrange
      const chunkService = getChunkService();
      const chunk = chunkService.create(
        'test-session',
        createTestChunkContent({ userMessage: 'Test' })
      );

      // Act
      const response = await executeTool({ chunk_id: chunk.id, preview_only: true });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.hint).toBeDefined();
    });
  });

  describe('size estimation', () => {
    /**
     * Objective: Verify that full expansion includes estimated tokens.
     * This test ensures context budget awareness.
     */
    it('should include estimated tokens in full expansion', async () => {
      // Arrange
      const chunkService = getChunkService();
      const chunk = chunkService.create(
        'test-session',
        createTestChunkContent({
          userMessage: 'Test message',
          assistantMessage: 'Test response',
        })
      );

      // Act
      const response = await executeTool({ chunk_id: chunk.id });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.estimated_tokens).toBeGreaterThan(0);
    });

    /**
     * Objective: Verify that large expansions include a warning.
     * This test ensures subagent delegation is suggested.
     */
    it('should include warning for large expansions', async () => {
      // Arrange: Create a chunk with lots of content
      const chunkService = getChunkService();
      const longMessage = 'x'.repeat(20000); // Large message
      const content: ChunkContent = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            parts: [{ type: 'text', text: longMessage }],
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
        metadata: {},
      };
      const chunk = chunkService.create('test-session', content);

      // Act
      const response = await executeTool({ chunk_id: chunk.id });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('subagent');
    });
  });

  // ===========================================================================
  // NEGATIVE TESTS
  // ===========================================================================

  describe('non-existent chunk', () => {
    /**
     * Objective: Verify that error is returned for non-existent chunk.
     * This test ensures graceful handling of missing chunks.
     */
    it('should return error for non-existent chunk', async () => {
      // Arrange
      const nonExistentId = 'ch_nonexistent123';

      // Act
      const response = await executeTool({ chunk_id: nonExistentId });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe(`Chunk ${nonExistentId} not found`);
    });

    /**
     * Objective: Verify that invalid chunk ID format is handled.
     * This test ensures malformed IDs don't cause crashes.
     */
    it('should handle invalid chunk ID format', async () => {
      // Arrange
      const invalidId = 'invalid-format';

      // Act
      const response = await executeTool({ chunk_id: invalidId });
      const result = parseJsonResponse(response);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('empty content', () => {
    /**
     * Objective: Verify that chunks with no messages are handled.
     * This test ensures empty chunks don't cause errors.
     */
    it('should handle chunk with no messages', async () => {
      // Arrange
      const chunkService = getChunkService();
      const content: ChunkContent = {
        messages: [],
        metadata: {},
      };
      const chunk = chunkService.create('test-session', content);

      // Act
      const response = await executeTool({ chunk_id: chunk.id });
      const result = parseJsonResponse(response);

      // Assert: Should still return valid output
      expect(result.content).toContain(`## Chunk ${chunk.id}`);
      expect(result.content).toContain('### Messages (0)');
    });

    /**
     * Objective: Verify that chunks with no metadata are handled.
     * This test ensures missing metadata doesn't cause errors.
     */
    it('should handle chunk with no metadata', async () => {
      // Arrange
      const chunkService = getChunkService();
      const content: ChunkContent = {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'Hello' }],
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
        metadata: {},
      };
      const chunk = chunkService.create('test-session', content);

      // Act
      const response = await executeTool({ chunk_id: chunk.id });
      const result = parseJsonResponse(response);

      // Assert: Should not contain metadata sections
      expect(result.content).not.toContain('### Files Modified');
      expect(result.content).not.toContain('### Tools Used');
    });
  });
});
