/**
 * Memoir Tool
 *
 * Main tool for managing project memories. Provides modes for:
 * - add: Save a new memory
 * - search: Search memories by query
 * - list: List recent memories
 * - forget: Delete a memory by ID
 * - help: Show usage information
 */

import { tool } from '@opencode-ai/plugin';
import { getMemoryService } from '../memory/index.ts';
import type { MemoryType } from '../types.ts';

/** Help text displayed when mode is 'help' or not provided */
const HELP_TEXT = `Memoir Tool - Manage project memories

Modes:
- add: Save a new memory
  memoir({ mode: "add", content: "...", type: "preference|pattern|gotcha|fact|learned" })
  
- search: Search memories by query
  memoir({ mode: "search", query: "..." })
  
- list: List recent memories
  memoir({ mode: "list", limit: 10, type: "preference" })
  
- forget: Delete a memory by ID
  memoir({ mode: "forget", memoryId: "mem_xxx" })
  
- help: Show this help message
  memoir({ mode: "help" })`;

/** Valid memory types for the type argument */
const MEMORY_TYPES = ['preference', 'pattern', 'gotcha', 'fact', 'learned'] as const;

/**
 * Main memoir tool for managing project memories.
 *
 * Provides a unified interface for all memory operations including
 * adding, searching, listing, and deleting memories.
 *
 * @example
 * ```typescript
 * // Add a memory
 * memoir({ mode: 'add', content: 'Always use strict mode', type: 'preference' })
 *
 * // Search memories
 * memoir({ mode: 'search', query: 'typescript config' })
 *
 * // List all preferences
 * memoir({ mode: 'list', type: 'preference', limit: 10 })
 *
 * // Delete a memory
 * memoir({ mode: 'forget', memoryId: 'mem_abc123' })
 * ```
 */
export const memoirTool = tool({
  description:
    'Manage project memories. Use to save preferences, patterns, gotchas, and facts about the codebase.',
  args: {
    mode: tool.schema
      .enum(['add', 'search', 'list', 'forget', 'help'])
      .optional()
      .describe('Operation mode'),
    content: tool.schema.string().optional().describe('Content to save (for add mode)'),
    type: tool.schema.enum(MEMORY_TYPES).optional().describe('Memory type (for add mode)'),
    query: tool.schema.string().optional().describe('Search query (for search mode)'),
    memoryId: tool.schema.string().optional().describe('Memory ID (for forget mode)'),
    limit: tool.schema.number().optional().describe('Max results (for list/search)'),
  },
  async execute(args) {
    const mode = args.mode || 'help';

    // Handle help mode early - no service needed
    if (mode === 'help') {
      return HELP_TEXT;
    }

    const memoryService = getMemoryService();

    switch (mode) {
      case 'add': {
        if (!args.content) {
          return JSON.stringify({ success: false, error: 'content is required for add mode' });
        }
        if (!args.type) {
          return JSON.stringify({ success: false, error: 'type is required for add mode' });
        }

        const memory = memoryService.add(args.content, args.type as MemoryType, { source: 'user' });
        return JSON.stringify({
          success: true,
          memory: {
            id: memory.id,
            content: memory.content,
            type: memory.type,
          },
        });
      }

      case 'search': {
        if (!args.query) {
          return JSON.stringify({ success: false, error: 'query is required for search mode' });
        }

        const results = memoryService.search(args.query, { limit: args.limit });
        return JSON.stringify({
          success: true,
          count: results.length,
          memories: results.map((r) => ({
            id: r.memory.id,
            content: r.memory.content,
            type: r.memory.type,
            rank: r.rank,
          })),
        });
      }

      case 'list': {
        const memories = memoryService.list({
          limit: args.limit,
          type: args.type as MemoryType | undefined,
        });
        return JSON.stringify({
          success: true,
          count: memories.length,
          memories: memories.map((m) => ({
            id: m.id,
            content: m.content,
            type: m.type,
          })),
        });
      }

      case 'forget': {
        if (!args.memoryId) {
          return JSON.stringify({ success: false, error: 'memoryId is required for forget mode' });
        }

        const deleted = memoryService.forget(args.memoryId);
        return JSON.stringify({
          success: deleted,
          message: deleted ? 'Memory deleted' : 'Memory not found',
        });
      }

      default:
        return HELP_TEXT;
    }
  },
});
