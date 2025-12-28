/**
 * Chat Message Hook Handler
 *
 * Handles the chat.message hook to:
 * - Inject relevant memories on first message of a session
 * - Detect memory keywords and add nudge messages
 */

import type { Memory } from '../types.ts';
import { getMemoryService } from '../memory/index.ts';

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
 * Formats the complete context injection for first message.
 *
 * Includes:
 * - Relevant project memories (preferences, patterns, gotchas, facts)
 * - Available tools overview
 *
 * Note: Session history is NOT injected automatically to avoid polluting
 * new sessions with potentially irrelevant context. Use memoir_history
 * to explicitly search for relevant past work when needed.
 *
 * @param memories - Relevant memories to inject
 * @returns Formatted context string
 */
function formatContextInjection(memories: Memory[]): string {
  const sections: string[] = [];

  // Project memories section
  if (memories.length > 0) {
    const memoryLines = memories.map((m) => `- [${m.type}] ${m.content}`);
    sections.push(`## Project Memory (Memoir)
The following memories are relevant to this conversation:

${memoryLines.join('\n')}`);
  }

  // Tools section (always include if we have memories)
  if (sections.length > 0) {
    sections.push(`## Memoir Tools
- \`memoir\` - Add or search project memories
- \`memoir_history\` - Browse/search session history (current session by default, use all_sessions: true for past work)
- \`memoir_expand\` - Expand a chunk ID to see full details`);
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

  // First message: inject relevant memories (not session history)
  const isFirstMessage = !injectedSessions.has(sessionID);
  if (isFirstMessage) {
    injectedSessions.add(sessionID);
    const memories = memoryService.searchRelevant(messageText);

    // Inject context if we have relevant memories
    if (memories.length > 0) {
      const contextText = formatContextInjection(memories);
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
