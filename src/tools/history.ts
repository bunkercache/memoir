/**
 * Memoir History Tool
 *
 * Searches session history for past work. Returns chunk summaries
 * with IDs that can be expanded using the memoir_expand tool.
 *
 * By default, searches only the current session. Use `all_sessions: true`
 * to search across all sessions, or provide specific `session_ids` to search.
 */

import { tool } from '@opencode-ai/plugin';
import { getChunkService } from '../chunks/index.ts';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Approximate characters per token for size estimation.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Token threshold for suggesting subagent delegation.
 */
const LARGE_RESULT_TOKEN_THRESHOLD = 2000;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Estimates the token count for a given text.
 *
 * @param text - The text to estimate
 * @returns Estimated token count
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Tool context provided by OpenCode.
 */
interface ToolContext {
  /** The current session ID */
  sessionID: string;
}

/**
 * Memoir history tool for searching session history.
 *
 * Searches through past session chunks to find relevant work history.
 * Results include chunk summaries and IDs that can be expanded with
 * the memoir_expand tool for full details.
 *
 * By default, searches only the current session. Use `all_sessions: true`
 * to search across all sessions, or provide specific `session_ids` to search.
 *
 * CONTEXT BUDGET NOTE: Search results are compact summaries. However,
 * if you plan to expand multiple results, consider delegating to a
 * subagent to avoid context window pressure.
 *
 * @example
 * ```typescript
 * // Search current session (default)
 * memoir_history({ query: 'authentication implementation' })
 *
 * // Search all sessions
 * memoir_history({ query: 'bug fix', all_sessions: true })
 *
 * // Search specific sessions
 * memoir_history({ query: 'refactoring', session_ids: ['ses_abc123', 'ses_def456'] })
 *
 * // Search only summary chunks (higher depth)
 * memoir_history({ query: 'refactoring', depth: 1, limit: 5 })
 * ```
 */
export const historyTool = tool({
  description: `Browse or search session history. Returns chunk summaries with IDs for memoir_expand.

DEFAULTS: Searches current session only. Returns recent chunks if no query provided.

OPTIONS:
- query: Search text (omit to list recent chunks)
- all_sessions: true to include past sessions  
- limit: Max results (default 10)

Use memoir_expand({ chunk_id }) to see full content of any chunk.`,
  args: {
    query: tool.schema
      .string()
      .optional()
      .describe('Search query (omit to list recent chunks without searching)'),
    all_sessions: tool.schema
      .boolean()
      .optional()
      .describe('Include past sessions (default: current session only)'),
    session_ids: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe('Search specific session IDs'),
    depth: tool.schema
      .number()
      .optional()
      .describe('Minimum chunk depth (0=original, 1+=summaries)'),
    limit: tool.schema.number().optional().describe('Max results (default: 10)'),
  },
  async execute(args, context: ToolContext) {
    const chunkService = getChunkService();

    // Determine which session(s) to search
    let sessionId: string | undefined;
    let searchScope: string;

    if (args.session_ids && args.session_ids.length > 0) {
      // Specific sessions requested - search the first one
      sessionId = args.session_ids[0];
      searchScope = `sessions: ${args.session_ids.join(', ')}`;
    } else if (args.all_sessions) {
      // Search all sessions
      sessionId = undefined;
      searchScope = 'all sessions';
    } else {
      // Default: current session only
      sessionId = context.sessionID;
      searchScope = 'current session';
    }

    const limit = args.limit ?? 10;
    const query = args.query?.trim();

    // If no query, return recent chunks instead of searching
    if (!query) {
      const recentChunks = chunkService.getRecentChunks({
        sessionId,
        limit,
      });

      if (recentChunks.length === 0) {
        return JSON.stringify({
          success: true,
          count: 0,
          scope: searchScope,
          mode: 'recent',
          message: `No chunks found in ${searchScope}`,
          hint: args.all_sessions ? undefined : 'Try with all_sessions: true to see past sessions',
        });
      }

      const formatted = recentChunks.map((c) => ({
        id: c.id,
        sessionId: c.sessionId,
        depth: c.depth,
        status: c.status,
        summary: c.summary || `${c.content.messages.length} messages`,
        created: new Date(c.createdAt * 1000).toISOString(),
        stats: {
          messages: c.content.messages.length,
          files_modified: c.content.metadata.files_modified?.length || 0,
        },
      }));

      return JSON.stringify({
        success: true,
        count: formatted.length,
        scope: searchScope,
        mode: 'recent',
        chunks: formatted,
        hint: 'Use memoir_expand({ chunk_id: "ch_xxx" }) to see full content.',
      });
    }

    // Search with query
    const results = chunkService.search(query, {
      sessionId,
      depth: args.depth,
      limit,
    });

    if (results.length === 0) {
      return JSON.stringify({
        success: true,
        count: 0,
        scope: searchScope,
        mode: 'search',
        query,
        message: `No matches for "${query}" in ${searchScope}`,
        hint: args.all_sessions ? undefined : 'Try with all_sessions: true to search past sessions',
      });
    }

    // Format results with essential information
    const formatted = results.map((r) => {
      const c = r.chunk;
      const summary = c.summary || `${c.content.messages.length} messages`;
      const messageCount = c.content.messages.length;
      const filesModified = c.content.metadata.files_modified?.length || 0;

      return {
        id: c.id,
        sessionId: c.sessionId,
        depth: c.depth,
        status: c.status,
        summary,
        stats: {
          messages: messageCount,
          files_modified: filesModified,
        },
        rank: r.rank,
      };
    });

    // Estimate total response size
    const responseText = JSON.stringify(formatted);
    const estimatedTokens = estimateTokens(responseText);

    // Calculate estimated tokens if all results were expanded
    const estimatedExpandedTokens = results.reduce((sum, r) => {
      // Rough estimate: summaries are ~5% of full content
      const summaryLength = (r.chunk.summary || '').length;
      const estimatedFullLength = Math.max(summaryLength * 20, 2000);
      return sum + Math.ceil(estimatedFullLength / CHARS_PER_TOKEN);
    }, 0);

    // Build response
    const response: {
      success: boolean;
      count: number;
      scope: string;
      mode: string;
      query: string;
      estimated_tokens: number;
      estimated_expanded_tokens: number;
      chunks: typeof formatted;
      hint: string;
      warning?: string;
    } = {
      success: true,
      count: results.length,
      scope: searchScope,
      mode: 'search',
      query,
      estimated_tokens: estimatedTokens,
      estimated_expanded_tokens: estimatedExpandedTokens,
      chunks: formatted,
      hint: 'Use memoir_expand({ chunk_id: "ch_xxx" }) to see full content.',
    };

    // Add warning for large potential expansions
    if (estimatedExpandedTokens > LARGE_RESULT_TOKEN_THRESHOLD && results.length > 3) {
      response.warning = `Expanding all ${results.length} results would use ~${estimatedExpandedTokens} tokens. Consider using memoir_expand with preview_only=true first, or delegate detailed analysis to a subagent.`;
    }

    return JSON.stringify(response);
  },
});

// Export helper for testing
export { estimateTokens };
