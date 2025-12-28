/**
 * Chat Message Hook Handler
 *
 * Handles the chat.message hook to:
 * - Inject relevant memories on first message of a session
 * - Detect memory keywords and add nudge messages
 * - Track messages for chunk creation
 */

import type { Memory, Chunk } from '../types.ts';
import { getMemoryService } from '../memory/index.ts';
import { getChunkService } from '../chunks/index.ts';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Input for the chat.message hook.
 */
export interface ChatMessageInput {
  /** The session ID */
  sessionID: string;
  /** Optional agent identifier */
  agent?: string;
  /** Optional model information */
  model?: { providerID: string; modelID: string };
  /** Optional message ID */
  messageID?: string;
}

/**
 * A text part in a message.
 */
export interface TextPart {
  /** Unique identifier */
  id: string;
  /** Session ID */
  sessionID: string;
  /** Message ID */
  messageID: string;
  /** Part type */
  type: 'text';
  /** Text content */
  text: string;
  /** Whether this part was synthetically injected */
  synthetic?: boolean;
}

/**
 * A part in a message (simplified for hook handling).
 */
export type Part = TextPart | { type: string; [key: string]: unknown };

/**
 * A user message in the chat.
 */
export interface UserMessage {
  /** Message role */
  role: 'user';
  /** Additional message properties */
  [key: string]: unknown;
}

/**
 * Output for the chat.message hook.
 */
export interface ChatMessageOutput {
  /** The user message */
  message: UserMessage;
  /** Parts that make up the message */
  parts: Part[];
}

// =============================================================================
// SESSION TRACKING
// =============================================================================

/** Track which sessions have had context injected */
const injectedSessions = new Set<string>();

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Memory nudge message when keywords are detected.
 * Instructs the LLM to save the information using the memoir tool.
 */
const MEMORY_NUDGE_MESSAGE = `[MEMORY TRIGGER DETECTED]
The user wants you to remember something. Use the \`memoir\` tool with \`mode: "add"\` to save this information.
Extract the key information and save it as a concise, searchable memory.
Choose an appropriate type: "preference", "pattern", "gotcha", "fact", or "learned".`;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Formats a chunk summary for display.
 *
 * @param chunk - The chunk to summarize
 * @returns A brief summary string
 */
function formatChunkSummary(chunk: Chunk): string {
  if (chunk.summary) {
    return chunk.summary;
  }

  // Fallback: create summary from metadata
  const messageCount = chunk.content.messages.length;
  const files = chunk.content.metadata.files_modified?.length || 0;
  const tools = chunk.content.metadata.tools_used?.slice(0, 3).join(', ') || 'none';

  return `${messageCount} messages, ${files} files modified, tools: ${tools}`;
}

/**
 * Formats recent session history for context injection.
 *
 * @param chunks - Array of recent chunks with summaries
 * @returns Formatted string for session history, or empty string if none
 */
function formatSessionHistory(chunks: Chunk[]): string {
  if (chunks.length === 0) {
    return '';
  }

  const lines = chunks.map((c) => {
    const date = new Date(c.createdAt * 1000).toLocaleDateString();
    return `- [${c.id}] (${date}): ${formatChunkSummary(c)}`;
  });

  return `\n## Recent Session History
The following past work may be relevant:

${lines.join('\n')}

Use \`memoir_expand({ chunk_id: "ch_xxx" })\` to see full details of any chunk.`;
}

/**
 * Formats the complete context injection for first message.
 *
 * Includes:
 * - Relevant project memories
 * - Recent session history with chunk references
 * - Available tools overview
 *
 * @param memories - Relevant memories to inject
 * @param recentChunks - Recent chunks with summaries
 * @returns Formatted context string
 */
function formatContextInjection(memories: Memory[], recentChunks: Chunk[]): string {
  const sections: string[] = [];

  // Project memories section
  if (memories.length > 0) {
    const memoryLines = memories.map((m) => `- [${m.type}] ${m.content}`);
    sections.push(`## Project Memory (Memoir)
The following memories are relevant to this conversation:

${memoryLines.join('\n')}`);
  }

  // Session history section
  const historySection = formatSessionHistory(recentChunks);
  if (historySection) {
    sections.push(historySection);
  }

  // Tools section (always include if we have any content)
  if (sections.length > 0) {
    sections.push(`## Memoir Tools
- \`memoir\` - Add or search project memories
- \`memoir_history\` - Search past sessions for relevant work (returns compact summaries)
- \`memoir_expand\` - Expand a [ch_xxx] reference to see full details
  - Use \`preview_only: true\` to check size before full expansion

**Context Budget Tip**: Expanded chunks can be large (1000-10000+ tokens each).
When exploring history or analyzing multiple chunks, consider delegating to a subagent:
\`\`\`
Task({ 
  prompt: "Use memoir_history and memoir_expand to find and analyze past work on [topic]",
  subagent_type: "explore"
})
\`\`\``);
  }

  return sections.join('\n\n');
}

/**
 * Creates a synthetic text part for injection.
 *
 * @param sessionID - The session ID
 * @param messageID - The message ID
 * @param text - The text content
 * @returns A synthetic TextPart
 */
function createSyntheticPart(sessionID: string, messageID: string, text: string): TextPart {
  return {
    id: `memoir-${Date.now()}`,
    sessionID,
    messageID,
    type: 'text',
    text,
    synthetic: true,
  };
}

/**
 * Extracts text content from message parts.
 *
 * @param parts - Array of message parts
 * @returns Concatenated text from all text parts
 */
function extractTextFromParts(parts: Part[]): string {
  return parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

// =============================================================================
// HOOK HANDLER
// =============================================================================

/**
 * Handles the chat.message hook.
 *
 * This hook is called for each user message and performs:
 * 1. First message: Injects relevant memories into context
 * 2. Keyword detection: Adds nudge message if memory keywords detected
 * 3. Message tracking: Tracks the message for chunk creation
 *
 * @param input - Hook input containing session and message info
 * @param output - Hook output containing message and parts (mutable)
 *
 * @example
 * ```typescript
 * // In plugin registration
 * hook: {
 *   'chat.message': handleChatMessage,
 * }
 * ```
 */
export async function handleChatMessage(
  input: ChatMessageInput,
  output: ChatMessageOutput
): Promise<void> {
  const { sessionID, messageID } = input;
  const memoryService = getMemoryService();

  // Extract text from parts
  const messageText = extractTextFromParts(output.parts);

  // Exit early if no text content
  if (!messageText.trim()) {
    return;
  }

  // First message: inject relevant memories and session history
  const isFirstMessage = !injectedSessions.has(sessionID);
  if (isFirstMessage) {
    injectedSessions.add(sessionID);
    const memories = memoryService.searchRelevant(messageText);

    // Get recent summary chunks for context (may fail if service not initialized)
    let recentChunks: Chunk[] = [];
    try {
      const chunkService = getChunkService();
      recentChunks = chunkService.getRecentSummaryChunks(5);
    } catch {
      // ChunkService not initialized yet, skip history injection
    }

    // Inject context if we have memories or history
    if (memories.length > 0 || recentChunks.length > 0) {
      const contextText = formatContextInjection(memories, recentChunks);
      const contextPart = createSyntheticPart(sessionID, messageID || '', contextText);
      output.parts.unshift(contextPart);
    }
  }

  // Check for memory keywords
  if (memoryService.detectKeyword(messageText)) {
    const nudgePart = createSyntheticPart(sessionID, messageID || '', MEMORY_NUDGE_MESSAGE);
    output.parts.push(nudgePart);
  }

  // Note: Message tracking is now handled by the event hook (message.updated + message.part.updated)
  // This ensures we have the correct messageID from OpenCode rather than generating a fake one.
}

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

/**
 * Clears the injection tracking for a specific session.
 *
 * Call this when a session is deleted or reset to allow
 * memory injection on the next first message.
 *
 * @param sessionID - The session ID to clear
 */
export function clearInjectedSession(sessionID: string): void {
  injectedSessions.delete(sessionID);
}

/**
 * Resets all injection tracking.
 *
 * Primarily used for testing to ensure a clean state.
 */
export function resetInjectedSessions(): void {
  injectedSessions.clear();
}

/**
 * Checks if a session has had memories injected.
 *
 * @param sessionID - The session ID to check
 * @returns True if the session has had memories injected
 */
export function hasInjectedSession(sessionID: string): boolean {
  return injectedSessions.has(sessionID);
}
