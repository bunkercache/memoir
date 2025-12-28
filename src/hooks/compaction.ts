/**
 * Compaction Hook Handler
 *
 * Handles the experimental.session.compacting hook to:
 * - Inject chunk summaries into the compaction context
 * - Provide chunk references for later expansion
 */

import type { Chunk } from '../types.ts';
import { getChunkService } from '../chunks/index.ts';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Input for the experimental.session.compacting hook.
 */
export interface CompactionInput {
  /** The session ID being compacted */
  sessionID: string;
}

/**
 * Output for the experimental.session.compacting hook.
 */
export interface CompactionOutput {
  /** Context strings to include in compaction */
  context: string[];
  /** Optional prompt override */
  prompt?: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Creates a summary string for a chunk.
 *
 * If the chunk has a summary, uses that. Otherwise, generates
 * a brief summary from the chunk's content metadata.
 *
 * @param chunk - The chunk to summarize
 * @returns A summary string for the chunk
 */
function summarizeChunk(chunk: Chunk): string {
  // Use existing summary if available
  if (chunk.summary) {
    return chunk.summary;
  }

  // Create a brief summary from content metadata
  const content = chunk.content;
  const messageCount = content.messages.length;
  const tools = content.metadata.tools_used?.join(', ') || 'none';
  const files = content.metadata.files_modified?.length || 0;
  const outcome = content.metadata.outcome || 'unknown';

  return `${messageCount} messages, tools: ${tools}, ${files} files modified, outcome: ${outcome}`;
}

/**
 * Formats chunk summaries for injection into compaction context.
 *
 * @param chunks - Array of chunks to format
 * @returns Formatted context string with chunk references
 */
function formatChunksForContext(chunks: Chunk[]): string {
  const chunkSummaries = chunks.map((c) => `[${c.id}]: ${summarizeChunk(c)}`).join('\n');

  return `## Session History (Memoir)
When summarizing, reference these chunk IDs so details can be retrieved later:

${chunkSummaries}

IMPORTANT: Your summary should include [chunk_id] references like:
"Fixed authentication bug [ch_xxx] and added rate limiting [ch_yyy]"

This allows the full context to be retrieved if needed using the memoir_expand tool.`;
}

// =============================================================================
// HOOK HANDLER
// =============================================================================

/**
 * Handles the experimental.session.compacting hook.
 *
 * This hook is called when OpenCode is about to compact a session's context.
 * It injects chunk summaries and references into the compaction context,
 * allowing the LLM to create summaries that reference specific chunks
 * for later expansion.
 *
 * @param input - Hook input containing the session ID
 * @param output - Hook output containing context array (mutable)
 *
 * @example
 * ```typescript
 * // In plugin registration
 * hook: {
 *   'experimental.session.compacting': handleCompaction,
 * }
 * ```
 */
export async function handleCompaction(
  input: CompactionInput,
  output: CompactionOutput
): Promise<void> {
  const { sessionID } = input;
  const chunkService = getChunkService();

  // Get active chunks for this session
  const chunks = chunkService.getActiveChunks(sessionID);

  // Exit early if no chunks to include
  if (chunks.length === 0) {
    return;
  }

  // Build and inject context with chunk references
  const contextText = formatChunksForContext(chunks);
  output.context.push(contextText);
}
