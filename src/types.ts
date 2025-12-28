/**
 * Memoir Plugin Type Definitions
 *
 * Shared types used across the Memoir plugin modules.
 * Includes types for project memories, session history chunks,
 * configuration, and storage paths.
 */

// =============================================================================
// MEMORY TYPES
// =============================================================================

/**
 * Categories for project memories.
 *
 * - `preference`: User or project preferences (e.g., "Always run tests after changes")
 * - `pattern`: Coding patterns used in the project (e.g., "We use Result<T, E> for error handling")
 * - `gotcha`: Known issues or things to avoid (e.g., "Don't use lodash, we have custom utilities")
 * - `fact`: General facts about the project (e.g., "API is at /api/v2")
 * - `learned`: Auto-detected patterns from conversations (e.g., "User prefers TypeScript strict mode")
 */
export type MemoryType = 'preference' | 'pattern' | 'gotcha' | 'fact' | 'learned';

/**
 * Origin of a memory entry.
 *
 * - `user`: Explicitly saved by the user via tool call
 * - `compaction`: Extracted during session compaction
 * - `auto`: Automatically detected via keyword patterns
 */
export type MemorySource = 'user' | 'compaction' | 'auto';

/**
 * A project memory entry storing learnings and facts about the codebase.
 */
export interface Memory {
  /** Unique identifier (e.g., "mem_7xKj9mN2pQ4r") */
  id: string;

  /** The memory content text */
  content: string;

  /** Category of the memory */
  type: MemoryType;

  /** Optional tags for categorization (stored as JSON array in DB) */
  tags: string[] | null;

  /** How this memory was created */
  source: MemorySource;

  /** Unix timestamp when the memory was created */
  createdAt: number;

  /** Unix timestamp when the memory was last updated, or null if never updated */
  updatedAt: number | null;

  /** Vector embedding for semantic search (reserved for future use) */
  embedding: Uint8Array | null;
}

// =============================================================================
// CHUNK TYPES
// =============================================================================

/**
 * Status of a session history chunk.
 *
 * - `active`: Currently active and visible in context
 * - `compacted`: Has been summarized into a parent chunk
 * - `archived`: Archived for long-term storage (not actively used)
 */
export type ChunkStatus = 'active' | 'compacted' | 'archived';

/**
 * Outcome of the work done in a chunk.
 *
 * - `success`: Task completed successfully
 * - `partial`: Task partially completed
 * - `failed`: Task failed
 * - `ongoing`: Task is still in progress
 */
export type ChunkOutcome = 'success' | 'partial' | 'failed' | 'ongoing';

/**
 * A part of a message within a chunk.
 * Represents different types of content in assistant/user messages.
 */
export interface ChunkMessagePart {
  /** Type of the message part */
  type: 'text' | 'tool' | 'file' | 'reasoning';

  /** Text content (for 'text' and 'reasoning' types) */
  text?: string;

  /** Tool name (for 'tool' type) */
  tool?: string;

  /** Tool input parameters (for 'tool' type) */
  input?: Record<string, unknown>;

  /** Tool output result (for 'tool' type) */
  output?: string;
}

/**
 * A message stored within a chunk.
 */
export interface ChunkMessage {
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
 * Content structure stored in a chunk's content field (as JSON).
 */
export interface ChunkContent {
  /** Messages contained in this chunk */
  messages: ChunkMessage[];

  /** Metadata about the work done in this chunk */
  metadata: {
    /** Files that were modified during this chunk */
    files_modified?: string[];

    /** Tools that were used during this chunk */
    tools_used?: string[];

    /** Outcome of the work done */
    outcome?: ChunkOutcome;
  };
}

/**
 * A session history chunk representing a segment of conversation.
 * Chunks form a tree structure where compacted chunks become children of summary chunks.
 */
export interface Chunk {
  /** Unique identifier (e.g., "ch_3bF8kL1nR5tY") */
  id: string;

  /** Session this chunk belongs to */
  sessionId: string;

  /** Parent chunk ID (null for root chunks) */
  parentId: string | null;

  /** Depth in the chunk tree (0 for leaf chunks, increases with compaction) */
  depth: number;

  /** IDs of child chunks (for summary chunks after compaction) */
  childRefs: string[] | null;

  /** The chunk content containing messages and metadata */
  content: ChunkContent;

  /** Summary text (generated during compaction, null for leaf chunks) */
  summary: string | null;

  /** Current status of the chunk */
  status: ChunkStatus;

  /** Unix timestamp when the chunk was created */
  createdAt: number;

  /** Unix timestamp when the chunk was finalized (session.idle event) */
  finalizedAt: number | null;

  /** Unix timestamp when this chunk was compacted into a parent */
  compactedAt: number | null;

  /** Vector embedding for semantic search (reserved for future use) */
  embedding: Uint8Array | null;
}

// =============================================================================
// EMBEDDING PROVIDER TYPES
// =============================================================================

/**
 * OpenAI embedding configuration.
 * Uses OpenAI's embedding API (or compatible APIs like Azure OpenAI).
 */
export interface OpenAIEmbeddingConfig {
  provider: 'openai';

  /** Model to use (e.g., 'text-embedding-3-small', 'text-embedding-3-large') */
  model: string;

  /** API key (falls back to OPENAI_API_KEY env var) */
  apiKey?: string;

  /** Base URL for the API (for Azure OpenAI or compatible APIs) */
  baseUrl?: string;

  /** Output dimensions (for models that support variable dimensions) */
  dimensions?: number;
}

/**
 * Ollama embedding configuration.
 * Uses a locally running Ollama instance.
 */
export interface OllamaEmbeddingConfig {
  provider: 'ollama';

  /** Model to use (e.g., 'nomic-embed-text', 'mxbai-embed-large') */
  model: string;

  /** Base URL for Ollama API (default: http://localhost:11434) */
  baseUrl?: string;
}

/**
 * OpenCode embedding configuration.
 * Uses the OpenCode API for embeddings.
 */
export interface OpenCodeEmbeddingConfig {
  provider: 'opencode';

  /** Model to use (uses cheapest available if not specified) */
  model?: string;
}

/**
 * Voyage AI embedding configuration.
 * Uses Voyage's embedding API, optimized for retrieval.
 */
export interface VoyageEmbeddingConfig {
  provider: 'voyage';

  /** Model to use (e.g., 'voyage-3', 'voyage-code-3') */
  model: string;

  /** API key (falls back to VOYAGE_API_KEY env var) */
  apiKey?: string;
}

/**
 * Cohere embedding configuration.
 * Uses Cohere's embedding API.
 */
export interface CohereEmbeddingConfig {
  provider: 'cohere';

  /** Model to use (e.g., 'embed-english-v3.0', 'embed-multilingual-v3.0') */
  model: string;

  /** API key (falls back to COHERE_API_KEY env var) */
  apiKey?: string;

  /** Input type for the embedding (affects how text is processed) */
  inputType?: 'search_document' | 'search_query' | 'classification' | 'clustering';
}

/**
 * Union of all supported embedding provider configurations.
 * Discriminated by the `provider` field.
 */
export type EmbeddingProviderConfig =
  | OpenAIEmbeddingConfig
  | OllamaEmbeddingConfig
  | OpenCodeEmbeddingConfig
  | VoyageEmbeddingConfig
  | CohereEmbeddingConfig;

/**
 * Supported embedding provider names.
 */
export type EmbeddingProvider = EmbeddingProviderConfig['provider'];

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/**
 * Memory system configuration
 */
export interface MemoryConfig {
  /** Maximum memories to inject on first message (0-50, default: 10) */
  maxInject: number;

  /** Maximum memories to return from search (1-100, default: 20) */
  maxSearchResults: number;

  /** Enable keyword detection for automatic memory triggers (default: true) */
  keywordDetection: boolean;

  /** Custom keywords to trigger memory save (in addition to defaults) */
  customKeywords: string[];
}

/**
 * Chunk/session history configuration
 */
export interface ChunksConfig {
  /** Maximum chunk content size in characters before splitting (1000-200000, default: 50000) */
  maxContentSize: number;

  /** Number of chunks to include in compaction context (1-50, default: 10) */
  maxCompactionContext: number;

  /** Auto-archive chunks older than N days (0 = never, default: 0) */
  autoArchiveDays: number;
}

/**
 * Search configuration
 */
export interface SearchConfig {
  /** Search mode: 'fts' (full-text), 'vector' (semantic), or 'hybrid' (both) */
  mode: 'fts' | 'vector' | 'hybrid';

  /** Embedding provider configuration (required when mode is 'vector' or 'hybrid') */
  embedding?: EmbeddingProviderConfig;
}

/**
 * Storage directory keywords.
 *
 * - `auto`: Automatically detect based on OpenCode installation (default)
 * - `local`: Store in repository's `.opencode/memoir/` directory
 * - `global`: Store in `~/.local/share/opencode/project/<projectId>/memoir/`
 */
export type StorageDirectoryKeyword = 'auto' | 'local' | 'global';

/**
 * Separate database filenames for memory and history.
 *
 * Omitting a key disables that feature of the plugin.
 */
export interface SplitDatabaseFilenames {
  /** Filename for the memory/learning database. Omit to disable memory feature. */
  memory?: string;

  /** Filename for the history/chunking database. Omit to disable history feature. */
  history?: string;
}

/**
 * Database filename configuration.
 *
 * - `string`: Use a single shared database for both memory and history
 * - `object`: Use separate databases (or disable features by omitting keys)
 */
export type DatabaseFilenameConfig = string | SplitDatabaseFilenames;

/**
 * Separate gitignore settings for memory and history databases.
 */
export interface SplitGitignoreConfig {
  /** Whether to add memory database to .gitignore (default: true) */
  memory?: boolean;

  /** Whether to add history database to .gitignore (default: true) */
  history?: boolean;
}

/**
 * Gitignore management configuration.
 *
 * - `boolean`: Apply to all databases
 * - `object`: Configure per-database
 */
export type GitignoreConfig = boolean | SplitGitignoreConfig;

/**
 * Storage configuration
 */
export interface StorageConfig {
  /**
   * Storage directory location.
   *
   * Can be:
   * - `"auto"` (default): Detect based on OpenCode installation
   * - `"local"`: Use `<repo>/.opencode/memoir/`
   * - `"global"`: Use `~/.local/share/opencode/project/<projectId>/memoir/`
   * - A custom path (absolute or relative to repo root)
   */
  directory: StorageDirectoryKeyword | string;

  /**
   * Database filename(s).
   *
   * - `string`: Single shared database for both memory and history (default: 'memory.db')
   * - `object`: Separate databases. Omit a key to disable that feature.
   *
   * @example
   * // Shared database (default)
   * filename: 'memory.db'
   *
   * @example
   * // Separate databases
   * filename: { memory: 'memories.db', history: 'history.db' }
   *
   * @example
   * // Disable history, only use memory
   * filename: { memory: 'memory.db' }
   */
  filename: DatabaseFilenameConfig;

  /**
   * Automatically add database path(s) to .gitignore when using local storage.
   *
   * - `boolean`: Apply to all databases (default: true)
   * - `object`: Configure per-database
   *
   * @example
   * // Manage gitignore for all (default)
   * gitignore: true
   *
   * @example
   * // Don't manage gitignore (commit databases)
   * gitignore: false
   *
   * @example
   * // Commit memory but not history
   * gitignore: { memory: false, history: true }
   */
  gitignore: GitignoreConfig;
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  /** Enable debug logging (default: false) */
  debug: boolean;

  /** Log file location relative to storage directory (default: null) */
  file: string | null;
}

/**
 * Complete Memoir configuration with all sections optional for partial configs.
 * Matches the schema defined in schema/config.schema.json.
 */
export interface MemoirConfig {
  /** JSON Schema reference for editor support */
  $schema?: string;

  /** Memory system configuration */
  memory?: Partial<MemoryConfig>;

  /** Chunk/session history configuration */
  chunks?: Partial<ChunksConfig>;

  /** Search configuration */
  search?: Partial<SearchConfig>;

  /** Storage configuration */
  storage?: Partial<StorageConfig>;

  /** Logging configuration */
  logging?: Partial<LoggingConfig>;
}

/**
 * Fully resolved configuration with all values present
 */
export interface ResolvedMemoirConfig {
  /** Memory system configuration with all defaults applied */
  memory: MemoryConfig;

  /** Chunk/session history configuration with all defaults applied */
  chunks: ChunksConfig;

  /** Search configuration with all defaults applied */
  search: SearchConfig;

  /** Storage configuration with all defaults applied */
  storage: StorageConfig;

  /** Logging configuration with all defaults applied */
  logging: LoggingConfig;
}

/**
 * Configuration resolution result
 */
export interface ResolvedConfig {
  /** The resolved configuration with defaults applied */
  config: ResolvedMemoirConfig;

  /** Source of the configuration */
  source: 'local' | 'global' | 'default';

  /** Path to the configuration file (if not default) */
  path?: string;
}

// =============================================================================
// STORAGE TYPES
// =============================================================================

/**
 * Resolved path for a single database.
 */
export interface ResolvedDatabasePath {
  /** Full path to the database file */
  path: string;

  /** Directory containing the database */
  directory: string;

  /** Whether this database is within the repository */
  isLocal: boolean;

  /** Whether to manage this path in .gitignore */
  manageGitignore: boolean;
}

/**
 * Storage path resolution result
 */
export interface StoragePaths {
  /** Default root directory for memoir storage */
  root: string;

  /** Whether default storage is local to the repository */
  isLocal: boolean;

  /**
   * Resolved path for the memory database.
   * Null if memory feature is disabled.
   */
  memoryDb: ResolvedDatabasePath | null;

  /**
   * Resolved path for the history database.
   * Null if history feature is disabled.
   */
  historyDb: ResolvedDatabasePath | null;

  /**
   * Whether memory and history use the same database file.
   * When true, only one database connection is needed.
   * False if either feature is disabled.
   */
  sharedDatabase: boolean;

  /**
   * All unique database paths that need gitignore management.
   * Relative paths from repository root.
   */
  gitignorePaths: string[];
}
