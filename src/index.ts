/**
 * Memoir - A smart memory management plugin for OpenCode
 *
 * Provides two interrelated systems:
 * 1. Project Memory - Persistent learnings about the codebase
 * 2. Session History - Hierarchical context tree for traversing compacted history
 */

import type { Plugin, PluginInput } from '@opencode-ai/plugin';

// Config
import { ConfigService } from './config/index.ts';
import { resolveStoragePaths, updateGitignore } from './config/paths.ts';

// Logging
import { Logger } from './logging/index.ts';

// Database
import { DatabaseService } from './db/index.ts';

// Memory
import { initializeMemoryService } from './memory/index.ts';

// Chunks
import { initializeChunkService } from './chunks/index.ts';

// Hooks
import { handleChatMessage } from './hooks/chat-message.ts';
import { handleCompaction } from './hooks/compaction.ts';
import { handleEvent, setOpenCodeClient } from './hooks/events.ts';

// Tools
import { memoirTool } from './tools/memoir.ts';
import { expandTool } from './tools/expand.ts';
import { historyTool } from './tools/history.ts';

/**
 * Enabled features based on storage configuration.
 */
interface EnabledFeatures {
  memory: boolean;
  history: boolean;
}

/**
 * Initialize all Memoir services.
 *
 * Sets up the configuration, database, memory, and chunk services
 * in the correct order with proper dependency injection.
 *
 * @param worktree - The repository root path
 * @param projectId - The OpenCode project identifier
 * @returns Which features are enabled
 */
function initializeServices(worktree: string, projectId: string): EnabledFeatures {
  // 1. Initialize config
  const configService = ConfigService.initialize(worktree);

  const resolvedConfig = {
    memory: configService.memory,
    chunks: configService.chunks,
    search: configService.search,
    storage: configService.storage,
    logging: configService.logging,
  };

  // 2. Resolve storage paths
  const paths = resolveStoragePaths(worktree, projectId, resolvedConfig);

  // 3. Initialize logger (uses storage directory)
  const storageDir = paths.memoryDb?.path
    ? paths.memoryDb.path.replace(/\/[^/]+$/, '')
    : paths.historyDb?.path
      ? paths.historyDb.path.replace(/\/[^/]+$/, '')
      : worktree;
  Logger.initialize(resolvedConfig.logging, storageDir);

  // 4. Update gitignore if needed
  updateGitignore(worktree, paths);

  // 5. Initialize databases and services based on enabled features
  const features: EnabledFeatures = {
    memory: paths.memoryDb !== null,
    history: paths.historyDb !== null,
  };

  // If using shared database, initialize once
  if (paths.sharedDatabase && paths.memoryDb) {
    DatabaseService.initialize(paths.memoryDb.path);
    const db = DatabaseService.get().getDatabase();

    if (features.memory) {
      initializeMemoryService(db, resolvedConfig);
    }
    if (features.history) {
      initializeChunkService(db, resolvedConfig);
    }
  } else {
    // Separate databases
    if (paths.memoryDb) {
      DatabaseService.initialize(paths.memoryDb.path, 'memory');
      const memoryDb = DatabaseService.get('memory').getDatabase();
      initializeMemoryService(memoryDb, resolvedConfig);
    }

    if (paths.historyDb) {
      DatabaseService.initialize(paths.historyDb.path, 'history');
      const historyDb = DatabaseService.get('history').getDatabase();
      initializeChunkService(historyDb, resolvedConfig);
    }
  }

  return features;
}

/**
 * Memoir Plugin for OpenCode
 *
 * A smart memory management plugin that supports nested aggregation of memory,
 * summaries, and file changes that compact in layers with upstream references.
 */
export const MemoirPlugin: Plugin = async (ctx: PluginInput) => {
  const { project, worktree, client } = ctx;

  // Set up logging client first (before services init so we can log during init)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Logger.setClient(client as any);

  // Initialize all services
  initializeServices(worktree, project.id);

  // Store the client for use in event handlers
  setOpenCodeClient(client);

  return {
    // Event hook - handles session.idle, session.compacted, session.deleted, message.updated
    event: handleEvent,

    // Chat message hook - injects memories, detects keywords, tracks messages
    'chat.message': handleChatMessage,

    // Compaction hook - injects chunk references into compaction context
    'experimental.session.compacting': handleCompaction,

    // Tools
    tool: {
      memoir: memoirTool,
      memoir_expand: expandTool,
      memoir_history: historyTool,
    },
  };
};

// Default export for plugin loading
export default MemoirPlugin;

// Re-export types for external use
export type {
  Memory,
  MemoryType,
  MemorySource,
  Chunk,
  ChunkStatus,
  ChunkContent,
  ChunkMessage,
  ChunkMessagePart,
  ChunkOutcome,
  MemoirConfig,
  ResolvedMemoirConfig,
  StoragePaths,
} from './types.ts';
