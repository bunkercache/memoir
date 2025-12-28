/**
 * Memoir History Tool
 *
 * Searches session history for past work. Returns chunk summaries
 * with IDs that can be expanded using the memoir_expand tool.
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
 * Memoir history tool for searching session history.
 *
 * Searches through past session chunks to find relevant work history.
 * Results include chunk summaries and IDs that can be expanded with
 * the memoir_expand tool for full details.
 *
 * CONTEXT BUDGET NOTE: Search results are compact summaries. However,
 * if you plan to expand multiple results, consider delegating to a
 * subagent to avoid context window pressure.
 *
 * @example
 * ```typescript
 * // Search all history
 * memoir_history({ query: 'authentication implementation' })
 *
 * // Search specific session
 * memoir_history({ query: 'bug fix', session_id: 'sess_abc123' })
 *
 * // Search only summary chunks (higher depth)
 * memoir_history({ query: 'refactoring', depth: 1, limit: 5 })
 * ```
 */
export const historyTool = tool({
  description: `Search session history for past work. Returns compact chunk summaries with IDs that can be expanded.

CONTEXT BUDGET: Results are summaries (~50-200 tokens each). To view full chunk content, use memoir_expand. For deep exploration of multiple chunks, consider delegating to a subagent.`,
  args: {
    query: tool.schema.string().describe('Search query for finding relevant history'),
    session_id: tool.schema.string().optional().describe('Limit search to a specific session'),
    depth: tool.schema
      .number()
      .optional()
      .describe('Minimum depth to search (0 = original chunks, higher = summaries)'),
    limit: tool.schema
      .number()
      .optional()
      .describe('Maximum number of results to return (default: 10, max recommended: 20)'),
  },
  async execute(args) {
    const chunkService = getChunkService();

    const results = chunkService.search(args.query, {
      sessionId: args.session_id,
      depth: args.depth,
      limit: args.limit,
    });

    if (results.length === 0) {
      return JSON.stringify({
        success: true,
        count: 0,
        estimated_tokens: 50,
        message: 'No matching chunks found',
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
      estimated_tokens: number;
      estimated_expanded_tokens: number;
      chunks: typeof formatted;
      hint: string;
      warning?: string;
    } = {
      success: true,
      count: results.length,
      estimated_tokens: estimatedTokens,
      estimated_expanded_tokens: estimatedExpandedTokens,
      chunks: formatted,
      hint: 'Use memoir_expand({ chunk_id: "ch_xxx", preview_only: true }) to check size before full expansion.',
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
