/**
 * Chat Message Hook Tests
 *
 * Tests for the handleChatMessage hook which:
 * - Injects relevant memories on first message of a session
 * - Detects memory keywords and adds nudge messages
 * - Tracks messages for chunk creation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseLike } from '../db/index.ts';
import { rmSync } from 'node:fs';
import { initializeMemoryService, resetMemoryService } from '../memory/index.ts';
import { initializeChunkService, resetChunkService, resetMessageTracker } from '../chunks/index.ts';
import { DEFAULT_CONFIG } from '../config/defaults.ts';
import type { ResolvedMemoirConfig } from '../types.ts';
import {
  handleChatMessage,
  clearInjectedSession,
  resetInjectedSessions,
  hasInjectedSession,
  type ChatMessageInput,
  type ChatMessageOutput,
  type TextPart,
  type Part,
} from './chat-message.ts';
import { createTestDatabase } from '../db/test-utils.ts';

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestConfig(): ResolvedMemoirConfig {
  return { ...DEFAULT_CONFIG };
}

function createMockTextPart(text: string, sessionID = 'test-session'): TextPart {
  return {
    id: `part-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sessionID,
    messageID: 'test-message',
    type: 'text',
    text,
  };
}

function createMockInput(sessionID = 'test-session', messageID = 'test-message'): ChatMessageInput {
  return {
    sessionID,
    messageID,
  };
}

function createMockOutput(parts: Part[], sessionID = 'test-session'): ChatMessageOutput {
  return {
    message: { role: 'user', id: 'msg-1', sessionID },
    parts,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('handleChatMessage', () => {
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

    // Reset injection tracking
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

  describe('memory injection on first message', () => {
    /**
     * Objective: Verify that relevant memories are injected on the first message of a session.
     * This test ensures the hook adds a synthetic part with memory context when memories exist.
     */
    it('should inject memories on first message of session when memories exist', async () => {
      // Arrange: Add a memory that will be relevant to the search
      const memoryService = (await import('../memory/index.ts')).getMemoryService();
      memoryService.add('Always use TypeScript strict mode', 'preference');

      const input = createMockInput('session-1');
      const output = createMockOutput([createMockTextPart('How do I configure TypeScript?')]);
      const initialPartsCount = output.parts.length;

      // Act
      await handleChatMessage(input, output);

      // Assert: A synthetic part should be prepended with memory context
      expect(output.parts.length).toBeGreaterThan(initialPartsCount);
      const injectedPart = output.parts[0] as TextPart;
      expect(injectedPart.synthetic).toBe(true);
      expect(injectedPart.text).toContain('Project Memory');
      expect(injectedPart.text).toContain('TypeScript strict mode');
    });

    /**
     * Objective: Verify that session history from OTHER sessions is NOT injected.
     * This prevents polluting new sessions with potentially irrelevant context.
     * Users can explicitly search for past work using memoir_history.
     */
    it('should NOT inject session history from other sessions', async () => {
      // Arrange: Create a summary chunk in a different session
      const { getChunkService } = await import('../chunks/index.ts');
      const chunkService = getChunkService();

      // Create a summary chunk in a past session
      const chunk = chunkService.create('past-session', {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'Old message' }],
            timestamp: 0,
          },
        ],
        metadata: { tools_used: ['bash'], files_modified: ['test.ts'] },
      });

      // Simulate compaction by creating a parent with summary
      const { ChunkRepository } = await import('../chunks/repository.ts');
      const repo = new ChunkRepository(db);
      repo.update(chunk.id, { status: 'compacted' });

      repo.create({
        sessionId: 'past-session',
        content: { messages: [], metadata: {} },
        depth: 1,
        summary: 'Implemented a new feature with TypeScript',
      });

      const input = createMockInput('new-session');
      const output = createMockOutput([createMockTextPart('Hello')], 'new-session');

      // Act
      await handleChatMessage(input, output);

      // Assert: Should NOT inject session history (only 1 part - the original)
      expect(output.parts.length).toBe(1);
      expect((output.parts[0] as TextPart).text).toBe('Hello');
    });

    /**
     * Objective: Verify that Memoir Tools section is included when context is injected.
     * This test ensures the LLM knows about available tools.
     */
    it('should include Memoir Tools section in context injection', async () => {
      // Arrange: Add a memory to trigger injection
      const memoryService = (await import('../memory/index.ts')).getMemoryService();
      memoryService.add('Test memory for tools section', 'fact');

      const input = createMockInput('session-tools');
      const output = createMockOutput([createMockTextPart('Test message')], 'session-tools');

      // Act
      await handleChatMessage(input, output);

      // Assert: Should include tools section
      const injectedPart = output.parts[0] as TextPart;
      expect(injectedPart.synthetic).toBe(true);
      expect(injectedPart.text).toContain('Memoir Tools');
      expect(injectedPart.text).toContain('memoir_history');
      expect(injectedPart.text).toContain('memoir_expand');
    });

    /**
     * Objective: Verify that the session is marked as injected after first message.
     * This test ensures hasInjectedSession returns true after processing.
     */
    it('should mark session as injected after first message', async () => {
      // Arrange
      const sessionID = 'session-mark-test';
      const input = createMockInput(sessionID);
      const output = createMockOutput([createMockTextPart('Hello world')], sessionID);

      expect(hasInjectedSession(sessionID)).toBe(false);

      // Act
      await handleChatMessage(input, output);

      // Assert
      expect(hasInjectedSession(sessionID)).toBe(true);
    });
  });

  describe('keyword detection', () => {
    /**
     * Objective: Verify that memory keywords trigger a nudge message.
     * This test ensures the hook detects "remember" and adds a nudge part.
     */
    it('should detect memory keywords and add nudge part', async () => {
      // Arrange
      const input = createMockInput('session-keyword');
      const output = createMockOutput([
        createMockTextPart('Please remember that I prefer tabs over spaces'),
      ]);
      const initialPartsCount = output.parts.length;

      // Act
      await handleChatMessage(input, output);

      // Assert: A nudge part should be appended
      expect(output.parts.length).toBeGreaterThan(initialPartsCount);
      const lastPart = output.parts[output.parts.length - 1] as TextPart;
      expect(lastPart.synthetic).toBe(true);
      expect(lastPart.text).toContain('MEMORY TRIGGER DETECTED');
      expect(lastPart.text).toContain('memoir');
    });
  });

  describe('message tracking', () => {
    /**
     * Note: Message tracking has been moved to the event handler.
     * handleChatMessage no longer directly tracks messages - it only
     * handles memory injection and keyword detection.
     *
     * Message tracking is now done via:
     * - message.updated events (creates message shell)
     * - message.part.updated events (adds content to messages)
     *
     * See events.test.ts for message tracking tests.
     */
    it('should not track messages (moved to event handler)', async () => {
      // Arrange
      const { getMessageTracker } = await import('../chunks/index.ts');
      const tracker = getMessageTracker();
      const sessionID = 'session-track';
      const input = createMockInput(sessionID, 'msg-track-1');
      const output = createMockOutput([createMockTextPart('Track this message')], sessionID);

      expect(tracker.hasMessages(sessionID)).toBe(false);

      // Act
      await handleChatMessage(input, output);

      // Assert - no messages tracked (tracking moved to event handler)
      expect(tracker.hasMessages(sessionID)).toBe(false);
    });
  });

  describe('session management', () => {
    /**
     * Objective: Verify that clearInjectedSession allows re-injection.
     * This test ensures clearing a session resets the injection state.
     */
    it('clearInjectedSession should allow re-injection', async () => {
      // Arrange: Add memory and process first message
      const memoryService = (await import('../memory/index.ts')).getMemoryService();
      memoryService.add('Test memory for re-injection', 'fact');

      const sessionID = 'session-clear';
      const input = createMockInput(sessionID);
      const output1 = createMockOutput([createMockTextPart('First message')], sessionID);

      await handleChatMessage(input, output1);
      expect(hasInjectedSession(sessionID)).toBe(true);

      // Act: Clear the session
      clearInjectedSession(sessionID);

      // Assert: Session should allow re-injection
      expect(hasInjectedSession(sessionID)).toBe(false);

      // Verify re-injection works
      const output2 = createMockOutput([createMockTextPart('Second message')], sessionID);
      await handleChatMessage(input, output2);
      expect(hasInjectedSession(sessionID)).toBe(true);
    });

    /**
     * Objective: Verify that resetInjectedSessions clears all sessions.
     * This test ensures the global reset works correctly.
     */
    it('resetInjectedSessions should clear all sessions', async () => {
      // Arrange: Process messages for multiple sessions
      const sessions = ['session-a', 'session-b', 'session-c'];
      for (const sessionID of sessions) {
        const input = createMockInput(sessionID);
        const output = createMockOutput([createMockTextPart('Hello')], sessionID);
        await handleChatMessage(input, output);
        expect(hasInjectedSession(sessionID)).toBe(true);
      }

      // Act
      resetInjectedSessions();

      // Assert: All sessions should be cleared
      for (const sessionID of sessions) {
        expect(hasInjectedSession(sessionID)).toBe(false);
      }
    });
  });

  // ===========================================================================
  // NEGATIVE TESTS
  // ===========================================================================

  describe('subsequent messages', () => {
    /**
     * Objective: Verify that memories are NOT injected on subsequent messages.
     * This test ensures only the first message gets memory injection.
     */
    it('should NOT inject memories on subsequent messages', async () => {
      // Arrange: Add memory and process first message
      const memoryService = (await import('../memory/index.ts')).getMemoryService();
      memoryService.add('Important memory about testing', 'fact');

      const sessionID = 'session-subsequent';
      const input = createMockInput(sessionID);

      // First message - should inject (query contains "important" which matches the memory)
      const output1 = createMockOutput(
        [createMockTextPart('Tell me something important')],
        sessionID
      );
      await handleChatMessage(input, output1);
      const firstMessagePartsCount = output1.parts.length;
      expect(firstMessagePartsCount).toBeGreaterThan(1); // Has injected part

      // Act: Second message
      const output2 = createMockOutput([createMockTextPart('Second message')], sessionID);
      await handleChatMessage(input, output2);

      // Assert: No memory injection on second message (only original part)
      // Note: keyword detection might still add parts, so we check for no synthetic prepend
      const firstPart = output2.parts[0] as TextPart;
      expect(firstPart.synthetic).toBeUndefined();
      expect(firstPart.text).toBe('Second message');
    });
  });

  describe('empty message handling', () => {
    /**
     * Objective: Verify that empty message text is handled gracefully.
     * This test ensures the hook exits early without errors for empty content.
     */
    it('should handle empty message text gracefully', async () => {
      // Arrange
      const sessionID = 'session-empty';
      const input = createMockInput(sessionID);
      const output = createMockOutput([createMockTextPart('')], sessionID);
      const initialPartsCount = output.parts.length;

      // Act
      await handleChatMessage(input, output);

      // Assert: No parts added, no errors
      expect(output.parts.length).toBe(initialPartsCount);
      // Session should NOT be marked as injected for empty messages
      expect(hasInjectedSession(sessionID)).toBe(false);
    });

    /**
     * Objective: Verify that whitespace-only message text is handled gracefully.
     * This test ensures the hook treats whitespace as empty.
     */
    it('should handle whitespace-only message text gracefully', async () => {
      // Arrange
      const sessionID = 'session-whitespace';
      const input = createMockInput(sessionID);
      const output = createMockOutput([createMockTextPart('   \n\t  ')], sessionID);

      // Act
      await handleChatMessage(input, output);

      // Assert: Session should NOT be marked as injected
      expect(hasInjectedSession(sessionID)).toBe(false);
    });
  });

  describe('no memories available', () => {
    /**
     * Objective: Verify that no injection occurs when no relevant memories exist.
     * This test ensures the hook doesn't add empty context.
     */
    it('should NOT inject when no relevant memories exist', async () => {
      // Arrange: No memories added
      const sessionID = 'session-no-memories';
      const input = createMockInput(sessionID);
      const output = createMockOutput(
        [createMockTextPart('Query about something with no memories')],
        sessionID
      );

      // Act
      await handleChatMessage(input, output);

      // Assert: No synthetic memory part prepended
      const firstPart = output.parts[0] as TextPart;
      expect(firstPart.synthetic).toBeUndefined();
      expect(firstPart.text).toBe('Query about something with no memories');
      // Session should still be marked as injected (even if no memories found)
      expect(hasInjectedSession(sessionID)).toBe(true);
    });
  });

  describe('non-text parts', () => {
    /**
     * Objective: Verify that non-text parts are handled correctly.
     * This test ensures the hook only processes text parts.
     */
    it('should handle output with non-text parts', async () => {
      // Arrange
      const sessionID = 'session-non-text';
      const input = createMockInput(sessionID);
      const output = createMockOutput(
        [{ type: 'image', data: 'base64data' }, createMockTextPart('Some text')],
        sessionID
      );

      // Act & Assert: Should not throw
      await expect(handleChatMessage(input, output)).resolves.not.toThrow();
    });
  });
});
