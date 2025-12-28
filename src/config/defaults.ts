/**
 * Default Configuration Values
 *
 * These defaults are used when no configuration file is found
 * or when specific values are not provided in the config.
 */

import type { ResolvedMemoirConfig } from '../types.ts';

/**
 * Default database filename used when memory and history share a database.
 */
export const DEFAULT_DB_FILENAME = 'memory.db';

/**
 * Default configuration for the Memoir plugin.
 * All values are fully specified with sensible defaults.
 */
export const DEFAULT_CONFIG: ResolvedMemoirConfig = {
  memory: {
    maxInject: 10,
    maxSearchResults: 20,
    keywordDetection: true,
    customKeywords: [],
  },
  chunks: {
    maxContentSize: 50000,
    maxCompactionContext: 10,
    autoArchiveDays: 0,
  },
  search: {
    mode: 'fts',
  },
  storage: {
    directory: 'auto',
    filename: DEFAULT_DB_FILENAME,
    gitignore: true,
  },
  logging: {
    debug: false,
    file: null,
  },
};
