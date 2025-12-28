/**
 * Event Hook Handler
 *
 * Handles the event hook for various OpenCode events:
 * - session.idle: Finalize current chunk
 * - session.compacted: Post-compaction processing
 * - session.deleted: Clean up session data
 * - message.updated: Track assistant messages
 */

import type { Chunk, ChunkMessagePart } from '../types.ts';
import { getChunkService, getMessageTracker } from '../chunks/index.ts';
import { clearInjectedSession } from './chat-message.ts';
import { Logger } from '../logging/index.ts';

// =============================================================================
// OPENCODE CLIENT
// =============================================================================

/** Stored OpenCode client for API calls */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let openCodeClient: any = null;

/**
 * Stores the OpenCode client for use in event handlers.
 * Called during plugin initialization.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setOpenCodeClient(client: any): void {
  openCodeClient = client;
}

/**
 * Gets the stored OpenCode client.
 * Returns null if not initialized.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getOpenCodeClient(): any {
  return openCodeClient;
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Session information for deleted sessions.
 */
export interface Session {
  /** Session ID */
  id: string;
  /** Additional session properties */
  [key: string]: unknown;
}

/**
 * Message part from OpenCode events.
 */
export interface MessagePart {
  /** Part type */
  type: string;
  /** Text content (for text parts) */
  text?: string;
  /** Tool name (for tool parts) */
  tool?: string;
  /** Tool input (for tool parts) */
  input?: Record<string, unknown>;
  /** Tool output (for tool parts) */
  output?: string;
}

/**
 * Message information from OpenCode events.
 */
export interface Message {
  /** Message ID */
  id: string;
  /** Session ID */
  sessionID: string;
  /** Message role */
  role: 'user' | 'assistant';
  /** Message parts */
  parts?: MessagePart[];
  /** Additional message properties */
  [key: string]: unknown;
}

/**
 * Event when a session becomes idle.
 */
export interface EventSessionIdle {
  type: 'session.idle';
  properties: {
    sessionID: string;
  };
}

/**
 * Event when a session is compacted.
 */
export interface EventSessionCompacted {
  type: 'session.compacted';
  properties: {
    sessionID: string;
  };
}

/**
 * Event when a session is deleted.
 */
export interface EventSessionDeleted {
  type: 'session.deleted';
  properties: {
    info: Session;
  };
}

/**
 * Event when a message is updated.
 */
export interface EventMessageUpdated {
  type: 'message.updated';
  properties: {
    info: Message;
  };
}

/**
 * Tool state from OpenCode events.
 * The state object contains input/output depending on the status.
 */
export interface ToolState {
  status: 'pending' | 'running' | 'completed' | 'error';
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A message part from OpenCode events.
 * For text parts: has `text` field
 * For tool parts: has `tool` and `state` fields (state contains input/output)
 */
export interface EventMessagePart {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
  // Text part fields
  text?: string;
  // Tool part fields
  tool?: string;
  callID?: string;
  state?: ToolState;
}

/**
 * Event when a message part is updated.
 */
export interface EventMessagePartUpdated {
  type: 'message.part.updated';
  properties: {
    part: EventMessagePart;
  };
}

/**
 * Union of all supported event types.
 */
export type Event =
  | EventSessionIdle
  | EventSessionCompacted
  | EventSessionDeleted
  | EventMessageUpdated
  | EventMessagePartUpdated
  | { type: string; properties: unknown };

/**
 * Input for the event hook.
 */
export interface EventInput {
  event: Event;
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

/**
 * Handles the session.idle event.
 *
 * Finalizes the current chunk from tracked messages when
 * the session becomes idle.
 *
 * @param sessionID - The session ID that became idle
 */
async function handleSessionIdle(sessionID: string): Promise<void> {
  const chunkService = getChunkService();

  // Finalize current chunk from tracked messages
  chunkService.finalize(sessionID);
}

/**
 * Generates a summary from chunks being compacted.
 * Extracts tools used, files modified, and message counts.
 */
function generateCompactionSummary(chunks: Chunk[]): string {
  const allTools = new Set<string>();
  const allFiles = new Set<string>();
  let totalMessages = 0;

  for (const chunk of chunks) {
    totalMessages += chunk.content.messages.length;
    if (chunk.content.metadata.tools_used) {
      for (const t of chunk.content.metadata.tools_used) {
        allTools.add(t);
      }
    }
    if (chunk.content.metadata.files_modified) {
      for (const f of chunk.content.metadata.files_modified) {
        allFiles.add(f);
      }
    }
  }

  const parts: string[] = [];
  parts.push(`${totalMessages} messages across ${chunks.length} chunks`);

  if (allTools.size > 0) {
    parts.push(`tools: ${Array.from(allTools).join(', ')}`);
  }

  if (allFiles.size > 0) {
    const fileList =
      allFiles.size <= 3
        ? Array.from(allFiles).join(', ')
        : `${Array.from(allFiles).slice(0, 3).join(', ')} +${allFiles.size - 3} more`;
    parts.push(`files: ${fileList}`);
  }

  return parts.join('; ');
}

/**
 * Message part structure from OpenCode API
 */
interface OpenCodeMessagePart {
  type: string;
  text?: string;
}

/**
 * Message structure from OpenCode API
 */
interface OpenCodeMessage {
  info: {
    id: string;
    role: string;
  };
  parts: OpenCodeMessagePart[];
}

/**
 * Fetches the compaction summary from OpenCode.
 * After compaction, the summary is typically in the most recent assistant message.
 * Returns null if unavailable.
 */
async function fetchCompactionSummary(sessionID: string): Promise<string | null> {
  const client = getOpenCodeClient();
  if (!client) {
    return null;
  }

  try {
    const messagesResult = await client.session.messages({ path: { id: sessionID } });

    if (!messagesResult.data || !Array.isArray(messagesResult.data)) {
      return null;
    }

    const messages = messagesResult.data as OpenCodeMessage[];

    // Search through messages in REVERSE order (newest first) for the compaction summary
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (!message.parts || !Array.isArray(message.parts)) {
        continue;
      }

      for (const part of message.parts) {
        if (part.type === 'text' && part.text) {
          const text = part.text;
          // Check if this looks like a compaction summary
          if (
            text.includes('Session Continuation Prompt') ||
            text.includes('Complete Summary of All Work') ||
            (text.includes('What We Did') && text.includes('ch_'))
          ) {
            // Don't return our own memory injection
            if (!text.startsWith('## Project Memory (Memoir)')) {
              return text;
            }
          }
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Handles the session.compacted event.
 *
 * Called after OpenCode compacts a session. This is when we should
 * compact our accumulated chunks into a summary chunk.
 *
 * @param sessionID - The session ID that was compacted
 */
async function handleSessionCompacted(sessionID: string): Promise<void> {
  const chunkService = getChunkService();

  // First, finalize any pending messages into a chunk
  chunkService.finalize(sessionID);

  // Get all active chunks for this session
  const activeChunks = chunkService.getActiveChunks(sessionID);

  // If we have multiple chunks, compact them
  if (activeChunks.length > 1) {
    // Try to fetch the summary from OpenCode
    const openCodeSummary = await fetchCompactionSummary(sessionID);

    // Use OpenCode's summary if available, otherwise generate our own
    const compactionSummary = openCodeSummary || generateCompactionSummary(activeChunks);
    chunkService.compact(sessionID, compactionSummary);
  }
}

/**
 * Handles the session.deleted event.
 *
 * Cleans up all session-related data including chunks,
 * tracked messages, and injection state.
 *
 * @param sessionID - The session ID that was deleted
 */
async function handleSessionDeleted(sessionID: string): Promise<void> {
  const chunkService = getChunkService();
  const tracker = getMessageTracker();

  // Clean up chunks for this session
  chunkService.deleteSession(sessionID);

  // Clear tracked messages
  tracker.clearSession(sessionID);

  // Clear injection tracking
  clearInjectedSession(sessionID);
}

/**
 * Handles the message.updated event.
 *
 * Tracks assistant messages for chunk content. User messages
 * are tracked in the chat.message hook.
 *
 * @param message - The message that was updated
 */
/**
 * Tracks message metadata (role, timestamps) when message.updated fires.
 * The actual content comes from message.part.updated events.
 */
async function handleMessageUpdated(message: Message): Promise<void> {
  // Track both user and assistant messages
  if (message.role !== 'user' && message.role !== 'assistant') {
    return;
  }

  const tracker = getMessageTracker();
  tracker.ensureMessage(message.sessionID, message.id, message.role);
}

/**
 * Handles the message.part.updated event.
 *
 * Adds or updates a part within a tracked message.
 * This is where the actual message content (text, tool calls) comes in.
 *
 * @param part - The message part that was updated
 */
async function handleMessagePartUpdated(part: EventMessagePart): Promise<void> {
  const log = Logger.get();

  // DEBUG: Log ALL part types to discover what OpenCode sends
  log.debug('message.part.updated received', {
    type: part.type,
    tool: part.tool,
    stateStatus: part.state?.status,
    messageID: part.messageID,
    hasInput: !!part.state?.input,
    hasOutput: !!part.state?.output,
    textLength: part.text?.length,
  });

  // Only track content-bearing part types
  // OpenCode uses 'text' for text parts and 'tool' for tool invocations
  if (part.type !== 'text' && part.type !== 'tool') {
    // Log unhandled types at debug level
    log.debug('skipping unhandled part type', { type: part.type });
    return;
  }

  // Skip empty text parts
  if (part.type === 'text' && (!part.text || part.text.trim() === '')) {
    return;
  }

  // For tool parts, only track when completed (has output)
  // Skip pending/running states to avoid storing incomplete tool calls
  if (part.type === 'tool' && part.state?.status !== 'completed') {
    log.debug('skipping incomplete tool', { tool: part.tool, status: part.state?.status });
    return;
  }

  const tracker = getMessageTracker();

  // Convert to chunk message part
  let chunkPart: ChunkMessagePart;
  if (part.type === 'text') {
    chunkPart = {
      type: 'text',
      text: part.text,
    };
  } else if (part.type === 'tool') {
    chunkPart = {
      type: 'tool',
      tool: part.tool,
      input: part.state?.input,
      output: part.state?.output,
    };
  } else {
    return; // Skip other types
  }

  // Add the part to the message
  tracker.addPart(part.sessionID, part.messageID, part.id, chunkPart);
}

// =============================================================================
// HOOK HANDLER
// =============================================================================

/**
 * Handles the event hook.
 *
 * Routes events to their appropriate handlers based on event type.
 * Supports session lifecycle events and message updates.
 *
 * @param input - Hook input containing the event
 *
 * @example
 * ```typescript
 * // In plugin registration
 * hook: {
 *   'event': handleEvent,
 * }
 * ```
 */
// Events we handle - used for early exit optimization
const HANDLED_EVENTS = new Set([
  'session.idle',
  'session.compacted',
  'session.deleted',
  'message.updated',
  'message.part.updated', // Need this to get message content
]);

export async function handleEvent(input: EventInput): Promise<void> {
  const { event } = input;
  const log = Logger.get();

  // Early exit for events we don't handle
  if (!HANDLED_EVENTS.has(event.type)) {
    return;
  }

  log.debug('handling event', { type: event.type });

  switch (event.type) {
    case 'session.idle': {
      const idleEvent = event as EventSessionIdle;
      await handleSessionIdle(idleEvent.properties.sessionID);
      break;
    }

    case 'session.compacted': {
      const compactedEvent = event as EventSessionCompacted;
      await handleSessionCompacted(compactedEvent.properties.sessionID);
      break;
    }

    case 'session.deleted': {
      const deletedEvent = event as EventSessionDeleted;
      await handleSessionDeleted(deletedEvent.properties.info.id);
      break;
    }

    case 'message.updated': {
      const updatedEvent = event as EventMessageUpdated;
      await handleMessageUpdated(updatedEvent.properties.info);
      break;
    }

    case 'message.part.updated': {
      const partEvent = event as EventMessagePartUpdated;
      await handleMessagePartUpdated(partEvent.properties.part);
      break;
    }
  }
}
