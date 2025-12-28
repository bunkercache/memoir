/**
 * Message Tracker
 *
 * Provides in-memory tracking of messages for chunk creation.
 * Tracks messages per session and maintains current chunk IDs.
 */

import type { ChunkMessagePart } from '../types.ts';

/**
 * A tracked message in the session.
 */
export interface TrackedMessage {
  /** Unique message identifier */
  id: string;

  /** Role of the message sender */
  role: 'user' | 'assistant';

  /** Parts that make up the message content */
  parts: ChunkMessagePart[];

  /** Unix timestamp when the message was created */
  timestamp: number;
}

/**
 * Tracks messages for chunk creation.
 *
 * Maintains an in-memory store of messages per session and tracks
 * the current chunk ID for each session.
 *
 * @example
 * ```typescript
 * const tracker = getMessageTracker();
 * tracker.trackMessage('session_123', {
 *   id: 'msg_1',
 *   role: 'user',
 *   parts: [{ type: 'text', text: 'Hello' }],
 *   timestamp: Date.now()
 * });
 * ```
 */
export class MessageTracker {
  /** Messages stored per session */
  private sessions: Map<string, TrackedMessage[]>;

  /** Current chunk ID per session */
  private currentChunkIds: Map<string, string>;

  constructor() {
    this.sessions = new Map();
    this.currentChunkIds = new Map();
  }

  /**
   * Tracks a message for a session.
   *
   * If a message with the same ID already exists, it will be updated
   * with the new content (upsert behavior). This handles streaming
   * updates where message.updated fires multiple times for the same message.
   *
   * @param sessionId - The session ID
   * @param message - The message to track
   */
  trackMessage(sessionId: string, message: TrackedMessage): void {
    const messages = this.sessions.get(sessionId) ?? [];

    // Check if message already exists (upsert)
    const existingIndex = messages.findIndex((m) => m.id === message.id);
    if (existingIndex >= 0) {
      // Update existing message with new content
      messages[existingIndex] = message;
    } else {
      // Add new message
      messages.push(message);
    }

    this.sessions.set(sessionId, messages);
  }

  /**
   * Gets all tracked messages for a session.
   *
   * @param sessionId - The session ID
   * @returns Array of tracked messages (empty if session not found)
   */
  getMessages(sessionId: string): TrackedMessage[] {
    return this.sessions.get(sessionId) ?? [];
  }

  /**
   * Clears all tracked messages for a session.
   *
   * @param sessionId - The session ID
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.currentChunkIds.delete(sessionId);
  }

  /**
   * Gets the current chunk ID for a session.
   *
   * @param sessionId - The session ID
   * @returns The current chunk ID, or null if not set
   */
  getCurrentChunkId(sessionId: string): string | null {
    return this.currentChunkIds.get(sessionId) ?? null;
  }

  /**
   * Sets the current chunk ID for a session.
   *
   * @param sessionId - The session ID
   * @param chunkId - The chunk ID to set as current
   */
  setCurrentChunkId(sessionId: string, chunkId: string): void {
    this.currentChunkIds.set(sessionId, chunkId);
  }

  /**
   * Checks if a session has any tracked messages.
   *
   * @param sessionId - The session ID
   * @returns True if the session has messages
   */
  hasMessages(sessionId: string): boolean {
    const messages = this.sessions.get(sessionId);
    return messages !== undefined && messages.length > 0;
  }

  /**
   * Gets the count of tracked messages for a session.
   *
   * @param sessionId - The session ID
   * @returns The number of tracked messages
   */
  getMessageCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.length ?? 0;
  }

  /**
   * Ensures a message exists in the tracker with the correct role.
   *
   * Creates a new message entry if it doesn't exist.
   * If the message exists but has a different role, updates the role.
   * This handles the race condition where parts arrive before message metadata.
   *
   * @param sessionId - The session ID
   * @param messageId - The message ID
   * @param role - The message role
   */
  ensureMessage(sessionId: string, messageId: string, role: 'user' | 'assistant'): void {
    const messages = this.sessions.get(sessionId) ?? [];
    const existing = messages.find((m) => m.id === messageId);

    if (!existing) {
      messages.push({
        id: messageId,
        role,
        parts: [],
        timestamp: Date.now(),
      });
      this.sessions.set(sessionId, messages);
    } else if (existing.role !== role) {
      // Update role if it was wrong (parts arrived before message.updated)
      existing.role = role;
    }
  }

  /**
   * Adds or updates a part within a message.
   *
   * Parts are tracked by their part ID to handle streaming updates
   * where the same part is updated multiple times with more content.
   *
   * @param sessionId - The session ID
   * @param messageId - The message ID
   * @param partId - The part ID (for deduplication)
   * @param part - The part content
   */
  addPart(sessionId: string, messageId: string, partId: string, part: ChunkMessagePart): void {
    const messages = this.sessions.get(sessionId) ?? [];
    const message = messages.find((m) => m.id === messageId);

    if (!message) {
      // Message doesn't exist yet - create it
      // Role will be set correctly when message.updated fires
      messages.push({
        id: messageId,
        role: 'assistant', // Default, will be corrected by ensureMessage if needed
        parts: [{ ...part, _partId: partId } as ChunkMessagePart & { _partId: string }],
        timestamp: Date.now(),
      });
      this.sessions.set(sessionId, messages);
      return;
    }

    // Find existing part by partId (stored in _partId metadata)
    const partsWithIds = message.parts as (ChunkMessagePart & { _partId?: string })[];
    const existingIndex = partsWithIds.findIndex((p) => p._partId === partId);

    if (existingIndex >= 0) {
      // Update existing part
      partsWithIds[existingIndex] = { ...part, _partId: partId };
    } else {
      // Add new part
      partsWithIds.push({ ...part, _partId: partId });
    }
  }
}

/** Singleton instance of the message tracker */
let tracker: MessageTracker | null = null;

/**
 * Gets the singleton MessageTracker instance.
 *
 * Creates a new instance if one doesn't exist.
 *
 * @returns The MessageTracker instance
 *
 * @example
 * ```typescript
 * const tracker = getMessageTracker();
 * tracker.trackMessage('session_123', message);
 * ```
 */
export function getMessageTracker(): MessageTracker {
  if (!tracker) {
    tracker = new MessageTracker();
  }
  return tracker;
}

/**
 * Resets the singleton MessageTracker instance.
 *
 * Primarily used for testing to ensure a clean state.
 *
 * @example
 * ```typescript
 * // In test teardown
 * resetMessageTracker();
 * ```
 */
export function resetMessageTracker(): void {
  tracker = null;
}
