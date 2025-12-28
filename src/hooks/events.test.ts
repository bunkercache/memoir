/**
 * Event Hook Tests
 *
 * Tests for the handleEvent hook which routes events to handlers:
 * - session.idle: Finalize current chunk
 * - session.compacted: Post-compaction processing
 * - session.deleted: Clean up session data
 * - message.updated: Track assistant messages
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
  getMessageTracker,
} from '../chunks/index.ts';
import { DEFAULT_CONFIG } from '../config/defaults.ts';
import type { ResolvedMemoirConfig, ChunkContent } from '../types.ts';
import {
  handleEvent,
  type EventInput,
  type EventSessionIdle,
  type EventSessionCompacted,
  type EventSessionDeleted,
  type EventMessageUpdated,
  type Message,
} from './events.ts';
import { resetInjectedSessions, hasInjectedSession } from './chat-message.ts';
import { createTestDatabase } from '../db/test-utils.ts';

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestConfig(): ResolvedMemoirConfig {
  return { ...DEFAULT_CONFIG };
}

function createSessionIdleEvent(sessionID: string): EventInput {
  const event: EventSessionIdle = {
    type: 'session.idle',
    properties: { sessionID },
  };
  return { event };
}

function createSessionCompactedEvent(sessionID: string): EventInput {
  const event: EventSessionCompacted = {
    type: 'session.compacted',
    properties: { sessionID },
  };
  return { event };
}

function createSessionDeletedEvent(sessionID: string): EventInput {
  const event: EventSessionDeleted = {
    type: 'session.deleted',
    properties: { info: { id: sessionID } },
  };
  return { event };
}

function createMessageUpdatedEvent(message: Message): EventInput {
  const event: EventMessageUpdated = {
    type: 'message.updated',
    properties: { info: message },
  };
  return { event };
}

function createTestChunkContent(messageText: string): ChunkContent {
  return {
    messages: [
      {
        id: `msg-${Date.now()}`,
        role: 'user',
        parts: [{ type: 'text', text: messageText }],
        timestamp: Math.floor(Date.now() / 1000),
      },
    ],
    metadata: {},
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('handleEvent', () => {
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

    // Reset state
    resetInjectedSessions();
  });

  afterEach(() => {
    resetMemoryService();
    resetChunkService();
    resetMessageTracker();
    resetInjectedSessions();
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // POSITIVE TESTS
  // ===========================================================================

  describe('session.idle event', () => {
    /**
     * Objective: Verify that session.idle event finalizes the current chunk.
     * This test ensures tracked messages are converted to a chunk.
     */
    it('should handle session.idle event and finalize chunk', async () => {
      // Arrange: Track some messages
      const tracker = getMessageTracker();
      const sessionID = 'session-idle-test';

      tracker.trackMessage(sessionID, {
        id: 'msg-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
        timestamp: Date.now(),
      });
      tracker.trackMessage(sessionID, {
        id: 'msg-2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi there!' }],
        timestamp: Date.now(),
      });

      expect(tracker.hasMessages(sessionID)).toBe(true);

      const input = createSessionIdleEvent(sessionID);

      // Act
      await handleEvent(input);

      // Assert: Messages should be cleared (finalized into chunk)
      expect(tracker.hasMessages(sessionID)).toBe(false);

      // Verify chunk was created
      const chunkService = getChunkService();
      const chunks = chunkService.getActiveChunks(sessionID);
      expect(chunks.length).toBe(1);
      expect(chunks[0].content.messages.length).toBe(2);
    });

    /**
     * Objective: Verify that session.idle with no messages does nothing.
     * This test ensures no chunk is created when there are no messages.
     */
    it('should handle session.idle with no tracked messages gracefully', async () => {
      // Arrange: No messages tracked
      const sessionID = 'session-idle-empty';
      const input = createSessionIdleEvent(sessionID);

      // Act & Assert: Should not throw
      await expect(handleEvent(input)).resolves.not.toThrow();

      // Verify no chunks created
      const chunkService = getChunkService();
      const chunks = chunkService.getActiveChunks(sessionID);
      expect(chunks.length).toBe(0);
    });
  });

  describe('session.compacted event', () => {
    /**
     * Objective: Verify that session.compacted event is handled.
     * This test ensures the event is processed without errors.
     */
    it('should handle session.compacted event', async () => {
      // Arrange
      const sessionID = 'session-compacted-test';
      const input = createSessionCompactedEvent(sessionID);

      // Act & Assert: Should not throw
      await expect(handleEvent(input)).resolves.not.toThrow();
    });
  });

  describe('session.deleted event', () => {
    /**
     * Objective: Verify that session.deleted event cleans up session data.
     * This test ensures chunks, tracked messages, and injection state are cleared.
     */
    it('should handle session.deleted event and cleanup', async () => {
      // Arrange: Create chunks and track messages
      const chunkService = getChunkService();
      const tracker = getMessageTracker();
      const sessionID = 'session-deleted-test';

      // Create a chunk
      chunkService.create(sessionID, createTestChunkContent('Test work'));

      // Track a message
      tracker.trackMessage(sessionID, {
        id: 'msg-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
        timestamp: Date.now(),
      });

      const input = createSessionDeletedEvent(sessionID);

      // Verify setup
      expect(chunkService.getActiveChunks(sessionID).length).toBe(1);
      expect(tracker.hasMessages(sessionID)).toBe(true);

      // Act
      await handleEvent(input);

      // Assert: All session data should be cleaned up
      expect(chunkService.getActiveChunks(sessionID).length).toBe(0);
      expect(tracker.hasMessages(sessionID)).toBe(false);
    });

    /**
     * Objective: Verify that session.deleted clears injection tracking.
     * This test ensures the session can be re-injected after deletion.
     */
    it('should clear injection tracking on session.deleted', async () => {
      // Arrange: Simulate a session that has been injected
      const sessionID = 'session-injection-clear';

      // Use handleChatMessage to set up injection state
      const { handleChatMessage } = await import('./chat-message.ts');
      await handleChatMessage(
        { sessionID, messageID: 'msg-1' },
        {
          message: { role: 'user' },
          parts: [
            {
              id: 'part-1',
              sessionID,
              messageID: 'msg-1',
              type: 'text',
              text: 'Hello',
            },
          ],
        }
      );

      expect(hasInjectedSession(sessionID)).toBe(true);

      const input = createSessionDeletedEvent(sessionID);

      // Act
      await handleEvent(input);

      // Assert: Injection tracking should be cleared
      expect(hasInjectedSession(sessionID)).toBe(false);
    });
  });

  describe('message.updated event', () => {
    /**
     * Objective: Verify that message.updated creates message shells.
     * Note: message.updated no longer contains parts - it only creates the message entry.
     * Parts are added separately via message.part.updated events.
     */
    it('should handle message.updated event for assistant messages', async () => {
      // Arrange
      const tracker = getMessageTracker();
      const sessionID = 'session-msg-update';

      const message: Message = {
        id: 'msg-assistant-1',
        sessionID,
        role: 'assistant',
        // Note: parts are NOT included in message.updated events from OpenCode
      };

      const input = createMessageUpdatedEvent(message);

      expect(tracker.hasMessages(sessionID)).toBe(false);

      // Act
      await handleEvent(input);

      // Assert: Message shell should be created (with empty parts)
      expect(tracker.hasMessages(sessionID)).toBe(true);
      const messages = tracker.getMessages(sessionID);
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].parts.length).toBe(0); // Parts come from message.part.updated
    });

    /**
     * Objective: Verify that user messages are also tracked.
     * Both user and assistant messages should create message shells.
     */
    it('should handle message.updated event for user messages', async () => {
      // Arrange
      const tracker = getMessageTracker();
      const sessionID = 'session-user-msg';

      const message: Message = {
        id: 'msg-user-1',
        sessionID,
        role: 'user',
      };

      const input = createMessageUpdatedEvent(message);

      // Act
      await handleEvent(input);

      // Assert: User message shell should be created
      expect(tracker.hasMessages(sessionID)).toBe(true);
      const messages = tracker.getMessages(sessionID);
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe('user');
    });
  });

  // ===========================================================================
  // NEGATIVE TESTS
  // ===========================================================================

  describe('unknown event types', () => {
    /**
     * Objective: Verify that unknown event types are ignored.
     * This test ensures the hook doesn't throw for unrecognized events.
     */
    it('should ignore unknown event types', async () => {
      // Arrange
      const input: EventInput = {
        event: {
          type: 'unknown.event.type',
          properties: { foo: 'bar' },
        },
      };

      // Act & Assert: Should not throw
      await expect(handleEvent(input)).resolves.not.toThrow();
    });

    /**
     * Objective: Verify that custom/future event types are handled gracefully.
     * This test ensures forward compatibility.
     */
    it('should handle future event types gracefully', async () => {
      // Arrange
      const input: EventInput = {
        event: {
          type: 'session.new_feature',
          properties: { sessionID: 'test' },
        },
      };

      // Act & Assert: Should not throw
      await expect(handleEvent(input)).resolves.not.toThrow();
    });
  });

  describe('message.updated edge cases', () => {
    /**
     * Objective: Verify that non-user/assistant roles are ignored.
     * This test ensures only valid roles are tracked.
     */
    it('should ignore message.updated for invalid roles', async () => {
      // Arrange
      const tracker = getMessageTracker();
      const sessionID = 'session-invalid-role';

      const message = {
        id: 'msg-system-1',
        sessionID,
        role: 'system', // Invalid role
      } as unknown as Message;

      const input = createMessageUpdatedEvent(message);

      // Act
      await handleEvent(input);

      // Assert: Message should NOT be tracked
      expect(tracker.hasMessages(sessionID)).toBe(false);
    });

    /**
     * Objective: Verify that messages without parts are still tracked.
     * message.updated creates the shell, parts come later via message.part.updated.
     */
    it('should create message shell even without parts', async () => {
      // Arrange
      const tracker = getMessageTracker();
      const sessionID = 'session-no-parts';

      const message: Message = {
        id: 'msg-no-parts',
        sessionID,
        role: 'assistant',
        // parts is undefined - this is normal for message.updated
      };

      const input = createMessageUpdatedEvent(message);

      // Act
      await handleEvent(input);

      // Assert: Message shell should be created
      expect(tracker.hasMessages(sessionID)).toBe(true);
      expect(tracker.getMessages(sessionID)[0].parts).toEqual([]);
    });

    /**
     * Objective: Verify multiple message.updated calls are idempotent.
     * OpenCode may fire multiple updates for the same message.
     */
    it('should handle duplicate message.updated events', async () => {
      // Arrange
      const tracker = getMessageTracker();
      const sessionID = 'session-duplicate';

      const message: Message = {
        id: 'msg-dup-1',
        sessionID,
        role: 'assistant',
      };

      const input = createMessageUpdatedEvent(message);

      // Act: Fire the event multiple times
      await handleEvent(input);
      await handleEvent(input);
      await handleEvent(input);

      // Assert: Should still only have one message
      expect(tracker.getMessages(sessionID).length).toBe(1);
    });
  });
});
