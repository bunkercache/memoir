/**
 * Embedded SQL Migrations for Memoir
 *
 * This module imports SQL migration files using Bun's text import feature.
 * During bundling, Bun inlines the file contents as string literals.
 *
 * To add a new migration:
 * 1. Create a new .sql file in the appropriate subsystem directory
 * 2. Add an import statement below with { type: "text" }
 * 3. Add the migration to the MIGRATIONS object
 *
 * Migration files must follow the naming convention: NNNN_description.sql
 * where NNNN is a 4-digit version number (e.g., 0001, 0002, etc.)
 */

// =============================================================================
// MEMORY SUBSYSTEM MIGRATIONS
// =============================================================================

import memory_0001 from './memory/0001_initial_memories_table.sql' with { type: 'text' };

// =============================================================================
// HISTORY SUBSYSTEM MIGRATIONS
// =============================================================================

import history_0001 from './history/0001_initial_chunks_table.sql' with { type: 'text' };

// =============================================================================
// TYPES
// =============================================================================

/**
 * Available migration subsystems.
 */
export type MigrationSubsystem = 'memory' | 'history';

/**
 * Type for embedded migrations structure.
 * Maps filename to SQL content for each subsystem.
 */
export type EmbeddedMigrations = Record<MigrationSubsystem, Record<string, string>>;

// =============================================================================
// MIGRATION REGISTRY
// =============================================================================

/**
 * All embedded SQL migrations indexed by subsystem and filename.
 *
 * When adding new migrations:
 * 1. Import the SQL file above using: import name from './path.sql' with { type: 'text' };
 * 2. Add an entry here with the exact filename as the key
 */
export const EMBEDDED_MIGRATIONS: EmbeddedMigrations = {
  memory: {
    '0001_initial_memories_table.sql': memory_0001,
  },
  history: {
    '0001_initial_chunks_table.sql': history_0001,
  },
};
