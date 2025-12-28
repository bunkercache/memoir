/**
 * MessageTracker Unit Tests
 *
 * Tests in-memory message tracking for chunk creation.
 * Resets singleton between tests for isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MessageTracker,
  getMessageTracker,
  resetMessageTracker,
  type TrackedMessage,
} from './tracker.ts';

/**
 * Creates a test message with default values.
 */
function createTestMessage(overrides?: Partial<TrackedMessage>): TrackedMessage {
  return {
    id: `msg-${Date.now()}`,
    role: 'user',
    parts: [{ type: 'text', text: 'Test message' }],
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('MessageTracker', () => {
  let tracker: MessageTracker;

  beforeEach(() => {
    // Arrange: Reset singleton and create fresh tracker
    resetMessageTracker();
    tracker = new MessageTracker();
  });

  afterEach(() => {
    // Cleanup: Reset singleton state
    resetMessageTracker();
  });

  // ==========================================================================
  // trackMessage() Tests
  // ==========================================================================

  describe('trackMessage()', () => {
    /**
     * Positive test: Verifies message is added to session.
     * Objective: Ensure messages are tracked correctly.
     */
    it('should add message to session', () => {
      // Arrange
      const sessionId = 'session_123';
      const message = createTestMessage({ id: 'msg-1' });

      // Act
      tracker.trackMessage(sessionId, message);

      // Assert
      const messages = tracker.getMessages(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('msg-1');
    });

    /**
     * Positive test: Verifies multiple messages are tracked in order.
     * Objective: Ensure message ordering is preserved.
     */
    it('should track multiple messages in order', () => {
      // Arrange
      const sessionId = 'session_123';
      const message1 = createTestMessage({ id: 'msg-1', timestamp: 1000 });
      const message2 = createTestMessage({ id: 'msg-2', timestamp: 2000 });
      const message3 = createTestMessage({ id: 'msg-3', timestamp: 3000 });

      // Act
      tracker.trackMessage(sessionId, message1);
      tracker.trackMessage(sessionId, message2);
      tracker.trackMessage(sessionId, message3);

      // Assert
      const messages = tracker.getMessages(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0].id).toBe('msg-1');
      expect(messages[1].id).toBe('msg-2');
      expect(messages[2].id).toBe('msg-3');
    });

    /**
     * Positive test: Verifies messages are isolated per session.
     * Objective: Ensure sessions don't share messages.
     */
    it('should isolate messages per session', () => {
      // Arrange
      const message1 = createTestMessage({ id: 'msg-1' });
      const message2 = createTestMessage({ id: 'msg-2' });

      // Act
      tracker.trackMessage('session_1', message1);
      tracker.trackMessage('session_2', message2);

      // Assert
      expect(tracker.getMessages('session_1')).toHaveLength(1);
      expect(tracker.getMessages('session_1')[0].id).toBe('msg-1');
      expect(tracker.getMessages('session_2')).toHaveLength(1);
      expect(tracker.getMessages('session_2')[0].id).toBe('msg-2');
    });

    /**
     * Positive test: Verifies upsert behavior for existing message.
     * Objective: Ensure message.updated events don't create duplicates.
     */
    it('should update existing message instead of creating duplicate (upsert)', () => {
      // Arrange
      const sessionId = 'session_123';
      const initialMessage = createTestMessage({
        id: 'msg-1',
        parts: [{ type: 'text', text: 'Hello' }],
        timestamp: 1000,
      });
      const updatedMessage = createTestMessage({
        id: 'msg-1', // Same ID
        parts: [{ type: 'text', text: 'Hello, updated content!' }],
        timestamp: 2000,
      });

      // Act
      tracker.trackMessage(sessionId, initialMessage);
      tracker.trackMessage(sessionId, updatedMessage);

      // Assert - should have only 1 message with updated content
      const messages = tracker.getMessages(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('msg-1');
      expect(messages[0].parts[0].text).toBe('Hello, updated content!');
      expect(messages[0].timestamp).toBe(2000);
    });

    /**
     * Positive test: Verifies multiple updates to same message.
     * Objective: Ensure streaming updates don't create duplicates.
     */
    it('should handle multiple updates to same message', () => {
      // Arrange
      const sessionId = 'session_123';

      // Act - simulate streaming: same message ID, progressively more content
      tracker.trackMessage(
        sessionId,
        createTestMessage({ id: 'msg-1', parts: [{ type: 'text', text: 'H' }] })
      );
      tracker.trackMessage(
        sessionId,
        createTestMessage({ id: 'msg-1', parts: [{ type: 'text', text: 'Hello' }] })
      );
      tracker.trackMessage(
        sessionId,
        createTestMessage({ id: 'msg-1', parts: [{ type: 'text', text: 'Hello World!' }] })
      );

      // Assert - should still have only 1 message with final content
      const messages = tracker.getMessages(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].parts[0].text).toBe('Hello World!');
    });

    /**
     * Positive test: Verifies upsert preserves order of messages.
     * Objective: Ensure updated messages stay in original position.
     */
    it('should preserve message order when updating', () => {
      // Arrange
      const sessionId = 'session_123';
      tracker.trackMessage(
        sessionId,
        createTestMessage({ id: 'msg-1', parts: [{ type: 'text', text: 'First' }] })
      );
      tracker.trackMessage(
        sessionId,
        createTestMessage({ id: 'msg-2', parts: [{ type: 'text', text: 'Second' }] })
      );
      tracker.trackMessage(
        sessionId,
        createTestMessage({ id: 'msg-3', parts: [{ type: 'text', text: 'Third' }] })
      );

      // Act - update the middle message
      tracker.trackMessage(
        sessionId,
        createTestMessage({ id: 'msg-2', parts: [{ type: 'text', text: 'Second Updated' }] })
      );

      // Assert - order should be preserved
      const messages = tracker.getMessages(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0].parts[0].text).toBe('First');
      expect(messages[1].parts[0].text).toBe('Second Updated');
      expect(messages[2].parts[0].text).toBe('Third');
    });
  });

  // ==========================================================================
  // getMessages() Tests
  // ==========================================================================

  describe('getMessages()', () => {
    /**
     * Positive test: Verifies messages are returned for session.
     * Objective: Ensure message retrieval works correctly.
     */
    it('should return tracked messages', () => {
      // Arrange
      const sessionId = 'session_123';
      const message = createTestMessage({
        id: 'msg-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello!' }],
      });
      tracker.trackMessage(sessionId, message);

      // Act
      const messages = tracker.getMessages(sessionId);

      // Assert
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].parts[0].text).toBe('Hello!');
    });

    /**
     * Negative test: Verifies empty array for unknown session.
     * Objective: Ensure graceful handling of non-existent session.
     */
    it('should return empty array for unknown session', () => {
      // Arrange - no messages tracked

      // Act
      const messages = tracker.getMessages('unknown_session');

      // Assert
      expect(messages).toEqual([]);
    });
  });

  // ==========================================================================
  // clearSession() Tests
  // ==========================================================================

  describe('clearSession()', () => {
    /**
     * Positive test: Verifies all messages are removed for session.
     * Objective: Ensure session cleanup works correctly.
     */
    it('should remove all messages for session', () => {
      // Arrange
      const sessionId = 'session_123';
      tracker.trackMessage(sessionId, createTestMessage({ id: 'msg-1' }));
      tracker.trackMessage(sessionId, createTestMessage({ id: 'msg-2' }));
      tracker.setCurrentChunkId(sessionId, 'ch_123456789012');

      // Act
      tracker.clearSession(sessionId);

      // Assert
      expect(tracker.getMessages(sessionId)).toEqual([]);
      expect(tracker.getCurrentChunkId(sessionId)).toBeNull();
    });

    /**
     * Positive test: Verifies other sessions are not affected.
     * Objective: Ensure session isolation during cleanup.
     */
    it('should not affect other sessions', () => {
      // Arrange
      tracker.trackMessage('session_1', createTestMessage({ id: 'msg-1' }));
      tracker.trackMessage('session_2', createTestMessage({ id: 'msg-2' }));

      // Act
      tracker.clearSession('session_1');

      // Assert
      expect(tracker.getMessages('session_1')).toEqual([]);
      expect(tracker.getMessages('session_2')).toHaveLength(1);
    });

    /**
     * Positive test: Verifies clearing non-existent session is safe.
     * Objective: Ensure no error for clearing unknown session.
     */
    it('should be safe to clear non-existent session', () => {
      // Arrange - no session exists

      // Act & Assert - should not throw
      expect(() => tracker.clearSession('unknown_session')).not.toThrow();
    });
  });

  // ==========================================================================
  // getCurrentChunkId() / setCurrentChunkId() Tests
  // ==========================================================================

  describe('getCurrentChunkId() / setCurrentChunkId()', () => {
    /**
     * Negative test: Verifies null is returned initially.
     * Objective: Ensure default state is null.
     */
    it('should return null initially', () => {
      // Arrange - no chunk ID set

      // Act
      const chunkId = tracker.getCurrentChunkId('session_123');

      // Assert
      expect(chunkId).toBeNull();
    });

    /**
     * Positive test: Verifies chunk ID is stored and retrieved.
     * Objective: Ensure chunk ID tracking works correctly.
     */
    it('should store and return chunk ID', () => {
      // Arrange
      const sessionId = 'session_123';
      const chunkId = 'ch_123456789012';

      // Act
      tracker.setCurrentChunkId(sessionId, chunkId);
      const retrieved = tracker.getCurrentChunkId(sessionId);

      // Assert
      expect(retrieved).toBe(chunkId);
    });

    /**
     * Positive test: Verifies chunk ID can be updated.
     * Objective: Ensure chunk ID can be changed.
     */
    it('should update chunk ID when set again', () => {
      // Arrange
      const sessionId = 'session_123';
      tracker.setCurrentChunkId(sessionId, 'ch_first0000000');

      // Act
      tracker.setCurrentChunkId(sessionId, 'ch_second000000');

      // Assert
      expect(tracker.getCurrentChunkId(sessionId)).toBe('ch_second000000');
    });

    /**
     * Positive test: Verifies chunk IDs are isolated per session.
     * Objective: Ensure sessions have independent chunk IDs.
     */
    it('should isolate chunk IDs per session', () => {
      // Arrange & Act
      tracker.setCurrentChunkId('session_1', 'ch_chunk1000000');
      tracker.setCurrentChunkId('session_2', 'ch_chunk2000000');

      // Assert
      expect(tracker.getCurrentChunkId('session_1')).toBe('ch_chunk1000000');
      expect(tracker.getCurrentChunkId('session_2')).toBe('ch_chunk2000000');
    });
  });

  // ==========================================================================
  // hasMessages() Tests
  // ==========================================================================

  describe('hasMessages()', () => {
    /**
     * Positive test: Verifies true when messages exist.
     * Objective: Ensure message presence detection works.
     */
    it('should return true when messages exist', () => {
      // Arrange
      const sessionId = 'session_123';
      tracker.trackMessage(sessionId, createTestMessage());

      // Act
      const hasMessages = tracker.hasMessages(sessionId);

      // Assert
      expect(hasMessages).toBe(true);
    });

    /**
     * Negative test: Verifies false for empty session.
     * Objective: Ensure empty state is detected.
     */
    it('should return false for empty session', () => {
      // Arrange
      const sessionId = 'session_123';
      tracker.trackMessage(sessionId, createTestMessage());
      tracker.clearSession(sessionId);

      // Act
      const hasMessages = tracker.hasMessages(sessionId);

      // Assert
      expect(hasMessages).toBe(false);
    });

    /**
     * Negative test: Verifies false for unknown session.
     * Objective: Ensure non-existent session returns false.
     */
    it('should return false for unknown session', () => {
      // Arrange - no session exists

      // Act
      const hasMessages = tracker.hasMessages('unknown_session');

      // Assert
      expect(hasMessages).toBe(false);
    });
  });

  // ==========================================================================
  // getMessageCount() Tests
  // ==========================================================================

  describe('getMessageCount()', () => {
    /**
     * Positive test: Verifies correct count is returned.
     * Objective: Ensure message counting works correctly.
     */
    it('should return correct count', () => {
      // Arrange
      const sessionId = 'session_123';
      tracker.trackMessage(sessionId, createTestMessage({ id: 'msg-1' }));
      tracker.trackMessage(sessionId, createTestMessage({ id: 'msg-2' }));
      tracker.trackMessage(sessionId, createTestMessage({ id: 'msg-3' }));

      // Act
      const count = tracker.getMessageCount(sessionId);

      // Assert
      expect(count).toBe(3);
    });

    /**
     * Negative test: Verifies 0 for unknown session.
     * Objective: Ensure non-existent session returns 0.
     */
    it('should return 0 for unknown session', () => {
      // Arrange - no session exists

      // Act
      const count = tracker.getMessageCount('unknown_session');

      // Assert
      expect(count).toBe(0);
    });

    /**
     * Positive test: Verifies 0 after clearing session.
     * Objective: Ensure count is 0 after cleanup.
     */
    it('should return 0 after clearing session', () => {
      // Arrange
      const sessionId = 'session_123';
      tracker.trackMessage(sessionId, createTestMessage());
      tracker.clearSession(sessionId);

      // Act
      const count = tracker.getMessageCount(sessionId);

      // Assert
      expect(count).toBe(0);
    });
  });
});

// =============================================================================
// Singleton Tests
// =============================================================================

describe('MessageTracker Singleton', () => {
  beforeEach(() => {
    resetMessageTracker();
  });

  afterEach(() => {
    resetMessageTracker();
  });

  /**
   * Positive test: Verifies singleton returns same instance.
   * Objective: Ensure singleton pattern works correctly.
   */
  it('should return same instance from getMessageTracker()', () => {
    // Arrange & Act
    const tracker1 = getMessageTracker();
    const tracker2 = getMessageTracker();

    // Assert
    expect(tracker1).toBe(tracker2);
  });

  /**
   * Positive test: Verifies singleton state is shared.
   * Objective: Ensure state persists across getInstance calls.
   */
  it('should share state across getInstance calls', () => {
    // Arrange
    const tracker1 = getMessageTracker();
    tracker1.trackMessage('session_123', createTestMessage({ id: 'msg-1' }));

    // Act
    const tracker2 = getMessageTracker();
    const messages = tracker2.getMessages('session_123');

    // Assert
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
  });

  /**
   * Positive test: Verifies reset clears singleton.
   * Objective: Ensure reset creates fresh instance.
   */
  it('should create new instance after resetMessageTracker()', () => {
    // Arrange
    const tracker1 = getMessageTracker();
    tracker1.trackMessage('session_123', createTestMessage());

    // Act
    resetMessageTracker();
    const tracker2 = getMessageTracker();

    // Assert
    expect(tracker2.getMessages('session_123')).toEqual([]);
  });
});
