/**
 * Database Module for Memoir
 *
 * Provides database connection management and a singleton service
 * for accessing the SQLite database with sqlite-vec extension.
 *
 * Uses bun:sqlite for all database operations. On macOS, attempts to use
 * Homebrew's SQLite which supports extension loading for sqlite-vec.
 */

import { existsSync } from 'node:fs';
import * as sqliteVec from 'sqlite-vec';
import { runMigrations, runAllMigrations, type MigrationSubsystem } from './migrations/index.ts';
import { Database } from 'bun:sqlite';

// =============================================================================
// SQLITE CONFIGURATION
// =============================================================================

/**
 * Known paths to SQLite libraries that support extension loading.
 * macOS system SQLite is compiled with SQLITE_OMIT_LOAD_EXTENSION,
 * so we need to use Homebrew's SQLite instead.
 */
const SQLITE_PATHS = [
  '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib', // Apple Silicon Homebrew
  '/usr/local/opt/sqlite/lib/libsqlite3.dylib', // Intel Homebrew
];

/**
 * Track whether we've already configured custom SQLite.
 */
let sqliteConfigured = false;

/**
 * Configure Bun to use a custom SQLite library that supports extensions.
 * This must be called before creating any Database instances.
 */
function configureCustomSQLite(): void {
  if (sqliteConfigured) return;

  for (const path of SQLITE_PATHS) {
    if (existsSync(path)) {
      try {
        Database.setCustomSQLite(path);
        sqliteConfigured = true;
        return;
      } catch {
        // Failed to set custom SQLite, try next path
      }
    }
  }
  // No custom SQLite found, will use system default (may not support extensions)
}

// =============================================================================
// DATABASE CREATION
// =============================================================================

/**
 * Options for creating a database.
 */
export interface CreateDatabaseOptions {
  /**
   * Which subsystem migrations to run.
   * - 'all' - Run both memory and history migrations (default for shared database)
   * - 'memory' - Run only memory migrations
   * - 'history' - Run only history migrations
   * - 'none' - Don't run any migrations (useful for testing)
   */
  migrations?: 'all' | MigrationSubsystem | 'none';
}

/**
 * Creates and initializes a new database connection.
 *
 * Configures the database with:
 * - WAL mode for better concurrent access
 * - Foreign key enforcement
 * - sqlite-vec extension for vector search (when available)
 * - Specified migrations
 *
 * @param dbPath - Path to the SQLite database file
 * @param options - Optional configuration
 * @returns An initialized Database instance
 *
 * @example
 * ```typescript
 * // Shared database with all migrations
 * const db = createDatabase('/path/to/memory.db');
 *
 * // Separate databases with specific migrations
 * const memoryDb = createDatabase('/path/to/memories.db', { migrations: 'memory' });
 * const historyDb = createDatabase('/path/to/history.db', { migrations: 'history' });
 * ```
 */
export function createDatabase(dbPath: string, options: CreateDatabaseOptions = {}): Database {
  const { migrations = 'all' } = options;

  /* eslint-disable no-console */
  // Configure custom SQLite before creating database (for extension support)
  configureCustomSQLite();

  const db = new Database(dbPath);

  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA foreign_keys = ON;');

  // Try to load sqlite-vec extension
  try {
    sqliteVec.load(db);
  } catch {
    // Extension loading not supported, continue without vector search
    console.warn('[memoir] sqlite-vec extension not available, vector search disabled');
  }

  // Run migrations based on option
  if (migrations === 'all') {
    runAllMigrations(db);
  } else if (migrations !== 'none') {
    runMigrations(db, migrations);
  }

  return db;
  /* eslint-enable no-console */
}

/**
 * Default instance name for backward compatibility.
 */
const DEFAULT_INSTANCE = 'default';

/**
 * Options for initializing a DatabaseService instance.
 */
export interface DatabaseServiceOptions {
  /**
   * Which subsystem migrations to run on this database.
   * Defaults to 'all' for default instance, or the instance name for named instances.
   */
  migrations?: 'all' | MigrationSubsystem | 'none';
}

/**
 * Singleton service for managing database connections.
 *
 * Supports multiple named instances for separate memory and history databases.
 * Must be initialized before use with `DatabaseService.initialize()`.
 *
 * @example
 * ```typescript
 * // Single shared database (default) - runs all migrations
 * DatabaseService.initialize('/path/to/memory.db');
 * const db = DatabaseService.get().getDatabase();
 *
 * // Separate databases with specific migrations
 * DatabaseService.initialize('/path/to/memories.db', 'memory', { migrations: 'memory' });
 * DatabaseService.initialize('/path/to/history.db', 'history', { migrations: 'history' });
 * const memoryDb = DatabaseService.get('memory').getDatabase();
 * const historyDb = DatabaseService.get('history').getDatabase();
 *
 * // Clean up at shutdown
 * DatabaseService.reset();
 * ```
 */
export class DatabaseService {
  private static instances: Map<string, DatabaseService> = new Map();
  private db: Database;
  private dbPath: string;
  private name: string;
  private subsystems: MigrationSubsystem[];

  private constructor(dbPath: string, name: string, options: DatabaseServiceOptions = {}) {
    this.dbPath = dbPath;
    this.name = name;

    // Determine which migrations were run
    const migrations = options.migrations ?? 'all';
    if (migrations === 'all') {
      this.subsystems = ['memory', 'history'];
    } else if (migrations === 'none') {
      this.subsystems = [];
    } else {
      this.subsystems = [migrations];
    }

    this.db = createDatabase(dbPath, { migrations });
  }

  /**
   * Initializes a database service instance with the specified path.
   *
   * If an instance with the given name already exists, returns the existing instance.
   * Call `reset()` first if you need to reinitialize with a different path.
   *
   * @param dbPath - Path to the SQLite database file
   * @param name - Optional instance name (default: 'default')
   * @param options - Optional configuration for migrations
   * @returns The initialized DatabaseService instance
   */
  static initialize(
    dbPath: string,
    name: string = DEFAULT_INSTANCE,
    options: DatabaseServiceOptions = {}
  ): DatabaseService {
    if (!DatabaseService.instances.has(name)) {
      DatabaseService.instances.set(name, new DatabaseService(dbPath, name, options));
    }
    return DatabaseService.instances.get(name)!;
  }

  /**
   * Gets a DatabaseService instance by name.
   *
   * @param name - Instance name (default: 'default')
   * @returns The DatabaseService instance
   * @throws Error if the instance has not been initialized
   */
  static get(name: string = DEFAULT_INSTANCE): DatabaseService {
    const instance = DatabaseService.instances.get(name);
    if (!instance) {
      throw new Error(`DatabaseService '${name}' not initialized. Call initialize() first.`);
    }
    return instance;
  }

  /**
   * Checks if a named instance exists.
   *
   * @param name - Instance name to check
   * @returns True if the instance exists
   */
  static has(name: string = DEFAULT_INSTANCE): boolean {
    return DatabaseService.instances.has(name);
  }

  /**
   * Resets one or all database service instances.
   *
   * @param name - Optional instance name. If not provided, resets all instances.
   */
  static reset(name?: string): void {
    if (name !== undefined) {
      const instance = DatabaseService.instances.get(name);
      if (instance) {
        instance.close();
        DatabaseService.instances.delete(name);
      }
    } else {
      // Reset all instances
      for (const instance of DatabaseService.instances.values()) {
        instance.close();
      }
      DatabaseService.instances.clear();
    }
  }

  /**
   * Gets the underlying Database instance for direct queries.
   *
   * @returns The Database instance
   */
  getDatabase(): Database {
    return this.db;
  }

  /**
   * Gets the path to the database file.
   *
   * @returns The database file path
   */
  getPath(): string {
    return this.dbPath;
  }

  /**
   * Gets the name of this instance.
   *
   * @returns The instance name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Gets the subsystems that have migrations applied to this database.
   *
   * @returns Array of subsystem names
   */
  getSubsystems(): MigrationSubsystem[] {
    return [...this.subsystems];
  }

  /**
   * Checks if this database has a specific subsystem's schema.
   *
   * @param subsystem - The subsystem to check
   * @returns True if the subsystem's migrations have been applied
   */
  hasSubsystem(subsystem: MigrationSubsystem): boolean {
    return this.subsystems.includes(subsystem);
  }

  /**
   * Closes the database connection.
   *
   * Note: Prefer using `DatabaseService.reset()` to ensure the singleton
   * state is properly cleared.
   */
  close(): void {
    this.db.close();
  }
}

// Re-export types from bun:sqlite for backwards compatibility
export type { Database as DatabaseLike, Statement as StatementLike } from 'bun:sqlite';

// Re-export utilities from submodules
export { generateId, generateMemoryId, generateChunkId } from './ids.ts';

// Re-export from new migrations module
export {
  getCurrentVersion,
  runMigrations,
  runAllMigrations,
  getMigrations,
  getPendingMigrations,
  getAppliedMigrations,
  validateMigrations,
  getMigrationTableName,
  parseFilename,
  computeChecksum,
} from './migrations/index.ts';
export type { Migration, MigrationSubsystem, AppliedMigration } from './migrations/index.ts';
