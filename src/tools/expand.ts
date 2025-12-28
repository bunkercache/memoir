/**
 * Memoir Expand Tool
 *
 * Expands a chunk to see its full content. Use when a summary
 * reference like [ch_xxx] needs more detail.
 */

import { tool } from '@opencode-ai/plugin';
import { getChunkService } from '../chunks/index.ts';
import type { Chunk, ChunkMessagePart } from '../types.ts';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Approximate characters per token for size estimation.
 * This is a rough estimate - actual tokenization varies by model.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Token threshold for warning about large responses.
 * Responses above this will include a subagent recommendation.
 */
const LARGE_RESPONSE_TOKEN_THRESHOLD = 4000;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Estimates the token count for a given text.
 *
 * Uses a simple character-based heuristic (4 chars per token).
 * This is approximate but sufficient for budget guidance.
 *
 * @param text - The text to estimate
 * @returns Estimated token count
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Formats a single message part for display.
 *
 * @param part - The message part to format
 * @returns Formatted string representation
 */
function formatMessagePart(part: ChunkMessagePart): string {
  switch (part.type) {
    case 'text':
      return part.text || '';
    case 'reasoning':
      return part.text ? `[Reasoning: ${part.text}]` : '';
    case 'tool': {
      if (!part.tool) return '';
      const lines: string[] = [`**Tool: ${part.tool}**`];

      // Include input if present
      if (part.input) {
        const inputStr = JSON.stringify(part.input, null, 2);
        // Truncate very long inputs
        const truncatedInput =
          inputStr.length > 500 ? inputStr.substring(0, 500) + '\n... (truncated)' : inputStr;
        lines.push(`Input:\n\`\`\`json\n${truncatedInput}\n\`\`\``);
      }

      // Include output if present
      if (part.output) {
        // Truncate very long outputs
        const truncatedOutput =
          part.output.length > 2000
            ? part.output.substring(0, 2000) + '\n... (truncated)'
            : part.output;
        lines.push(`Output:\n\`\`\`\n${truncatedOutput}\n\`\`\``);
      }

      return lines.join('\n');
    }
    case 'file':
      return part.text ? `[File: ${part.text}]` : '';
    default:
      return '';
  }
}

/**
 * Formats a chunk's content for display.
 *
 * Produces a human-readable representation of the chunk including:
 * - Chunk metadata (ID, session, status, depth)
 * - Summary (if available)
 * - Messages with role and timestamp
 * - Files modified (if any)
 *
 * @param chunk - The chunk to format
 * @returns Formatted string representation
 */
function formatChunkContent(chunk: Chunk): string {
  const lines: string[] = [];

  // Header with metadata
  lines.push(`## Chunk ${chunk.id}`);
  lines.push(`Session: ${chunk.sessionId}`);
  lines.push(`Status: ${chunk.status}, Depth: ${chunk.depth}`);

  // Summary section
  if (chunk.summary) {
    lines.push(`\n### Summary\n${chunk.summary}`);
  }

  // Messages section
  const messageCount = chunk.content.messages.length;
  lines.push(`\n### Messages (${messageCount})`);

  for (const msg of chunk.content.messages) {
    const timestamp = new Date(msg.timestamp * 1000).toISOString();
    lines.push(`\n**${msg.role}** (${timestamp}):`);

    for (const part of msg.parts) {
      const formatted = formatMessagePart(part);
      if (formatted) {
        lines.push(formatted);
      }
    }
  }

  // Files modified section
  const filesModified = chunk.content.metadata.files_modified;
  if (filesModified && filesModified.length > 0) {
    lines.push(`\n### Files Modified\n${filesModified.join('\n')}`);
  }

  // Tools used section
  const toolsUsed = chunk.content.metadata.tools_used;
  if (toolsUsed && toolsUsed.length > 0) {
    lines.push(`\n### Tools Used\n${toolsUsed.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Formats a chunk preview (metadata and summary only, no full content).
 *
 * @param chunk - The chunk to preview
 * @returns Formatted preview string
 */
function formatChunkPreview(chunk: Chunk): string {
  const lines: string[] = [];

  // Header with metadata
  lines.push(`## Chunk ${chunk.id}`);
  lines.push(`Session: ${chunk.sessionId}`);
  lines.push(`Status: ${chunk.status}, Depth: ${chunk.depth}`);
  lines.push(`Created: ${new Date(chunk.createdAt * 1000).toISOString()}`);

  // Summary section
  if (chunk.summary) {
    lines.push(`\n### Summary\n${chunk.summary}`);
  }

  // Stats section
  const messageCount = chunk.content.messages.length;
  const filesModified = chunk.content.metadata.files_modified?.length || 0;
  const toolsUsed = chunk.content.metadata.tools_used || [];

  lines.push(`\n### Stats`);
  lines.push(`- Messages: ${messageCount}`);
  lines.push(`- Files modified: ${filesModified}`);
  if (toolsUsed.length > 0) {
    lines.push(`- Tools used: ${toolsUsed.join(', ')}`);
  }

  // Estimate full content size
  const fullContent = formatChunkContent(chunk);
  const estimatedTokens = estimateTokens(fullContent);
  lines.push(`- Estimated full size: ~${estimatedTokens} tokens`);

  // Child refs if present
  if (chunk.childRefs && chunk.childRefs.length > 0) {
    lines.push(`\n### Child Chunks`);
    lines.push(chunk.childRefs.map((id) => `- ${id}`).join('\n'));
  }

  return lines.join('\n');
}

/**
 * Memoir expand tool for viewing full chunk content.
 *
 * When search results or summaries reference a chunk ID (e.g., [ch_xxx]),
 * use this tool to expand and view the full content of that chunk.
 *
 * CONTEXT BUDGET NOTE: Full chunk expansion can consume significant context.
 * Use preview_only=true first to check size, or delegate to a subagent for
 * large explorations.
 *
 * @example
 * ```typescript
 * // Preview a chunk (low context cost)
 * memoir_expand({ chunk_id: 'ch_abc123', preview_only: true })
 *
 * // Expand a single chunk
 * memoir_expand({ chunk_id: 'ch_abc123' })
 *
 * // Expand with children (can be large!)
 * memoir_expand({ chunk_id: 'ch_abc123', include_children: true })
 * ```
 */
export const expandTool = tool({
  description: `Expand a chunk to see its full content. Use when a summary reference like [ch_xxx] needs more detail.

CONTEXT BUDGET: Full expansions can be large (1000-10000+ tokens). Use preview_only=true first to check size. For exploring multiple chunks, consider delegating to a subagent to preserve your context window.`,
  args: {
    chunk_id: tool.schema.string().describe('The chunk ID to expand (e.g., ch_xxx)'),
    include_children: tool.schema
      .boolean()
      .optional()
      .describe('Also include child chunks in the expansion (can significantly increase size)'),
    preview_only: tool.schema
      .boolean()
      .optional()
      .describe(
        'Return only metadata and summary without full message content. Use to check size before full expansion.'
      ),
  },
  async execute(args) {
    const chunkService = getChunkService();

    const chunks = chunkService.expand(args.chunk_id, args.include_children);

    if (chunks.length === 0) {
      return JSON.stringify({
        success: false,
        error: `Chunk ${args.chunk_id} not found`,
      });
    }

    // Preview mode - return summaries and metadata only
    if (args.preview_only) {
      const previews = chunks.map(formatChunkPreview).join('\n\n---\n\n');
      const totalEstimatedTokens = chunks.reduce((sum, chunk) => {
        const fullContent = formatChunkContent(chunk);
        return sum + estimateTokens(fullContent);
      }, 0);

      return JSON.stringify({
        success: true,
        mode: 'preview',
        chunk_count: chunks.length,
        estimated_full_tokens: totalEstimatedTokens,
        previews,
        hint:
          totalEstimatedTokens > LARGE_RESPONSE_TOKEN_THRESHOLD
            ? `Full expansion would be ~${totalEstimatedTokens} tokens. Consider using a subagent for detailed analysis.`
            : 'Use preview_only=false for full content.',
      });
    }

    // Full expansion mode
    const formatted = chunks.map(formatChunkContent).join('\n\n---\n\n');
    const estimatedTokens = estimateTokens(formatted);

    // Build response with metadata
    const response: {
      success: boolean;
      chunk_count: number;
      estimated_tokens: number;
      content: string;
      warning?: string;
    } = {
      success: true,
      chunk_count: chunks.length,
      estimated_tokens: estimatedTokens,
      content: formatted,
    };

    // Add warning for large responses
    if (estimatedTokens > LARGE_RESPONSE_TOKEN_THRESHOLD) {
      response.warning = `Large response (~${estimatedTokens} tokens). For future explorations of this size, consider delegating to a subagent to preserve context.`;
    }

    return JSON.stringify(response);
  },
});

// Export helper functions for testing
export { estimateTokens, formatChunkContent, formatChunkPreview };
