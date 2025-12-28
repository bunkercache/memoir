/**
 * Storage Path Resolution
 *
 * Handles determining where Memoir stores its data based on
 * configuration and OpenCode installation type.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, isAbsolute, relative, normalize } from 'node:path';
import { homedir } from 'node:os';
import type {
  ResolvedMemoirConfig,
  StoragePaths,
  StorageDirectoryKeyword,
  ResolvedDatabasePath,
  DatabaseFilenameConfig,
  GitignoreConfig,
} from '../types.ts';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Keywords that map to specific storage locations */
const STORAGE_KEYWORDS: StorageDirectoryKeyword[] = ['auto', 'local', 'global'];

/** Subdirectory name within .opencode for local storage */
const LOCAL_SUBDIR = 'memoir';

/** Gitignore entry comment marker */
const GITIGNORE_MARKER = '# Memoir plugin databases';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if OpenCode is installed locally in the repository.
 *
 * A local install is detected by:
 * - Presence of an OpenCode config file (.opencode/opencode.json, opencode.json, or .jsonc variants)
 * - MEMOIR_FORCE_LOCAL=1 environment variable (for local development)
 *
 * @param worktree - The repository root path
 * @returns True if OpenCode is installed locally
 */
export function isLocalInstall(worktree: string): boolean {
  // Check environment variable first (for local dev)
  if (process.env.MEMOIR_FORCE_LOCAL === '1' || process.env.MEMOIR_FORCE_LOCAL === 'true') {
    return true;
  }

  const localConfigPaths = [
    join(worktree, '.opencode', 'opencode.json'),
    join(worktree, '.opencode', 'opencode.jsonc'),
    join(worktree, 'opencode.json'),
    join(worktree, 'opencode.jsonc'),
  ];

  return localConfigPaths.some((path) => existsSync(path));
}

/**
 * Check if a directory string is a storage keyword.
 *
 * @param directory - The directory string to check
 * @returns True if it's a recognized keyword
 */
function isStorageKeyword(directory: string): directory is StorageDirectoryKeyword {
  return STORAGE_KEYWORDS.includes(directory as StorageDirectoryKeyword);
}

/**
 * Resolve a directory keyword or path to an absolute path.
 *
 * @param directory - Directory keyword or path
 * @param worktree - Repository root path
 * @param projectId - OpenCode project identifier
 * @returns Resolved absolute path and whether it's local
 */
function resolveDirectory(
  directory: StorageDirectoryKeyword | string,
  worktree: string,
  projectId: string
): { path: string; isLocal: boolean } {
  // Handle keywords
  if (isStorageKeyword(directory)) {
    switch (directory) {
      case 'local':
        return {
          path: join(worktree, '.opencode', LOCAL_SUBDIR),
          isLocal: true,
        };

      case 'global':
        return {
          path: join(homedir(), '.local', 'share', 'opencode', 'project', projectId, LOCAL_SUBDIR),
          isLocal: false,
        };

      case 'auto':
      default:
        // Auto-detect based on OpenCode installation
        if (isLocalInstall(worktree)) {
          return {
            path: join(worktree, '.opencode', LOCAL_SUBDIR),
            isLocal: true,
          };
        }
        return {
          path: join(homedir(), '.local', 'share', 'opencode', 'project', projectId, LOCAL_SUBDIR),
          isLocal: false,
        };
    }
  }

  // Handle custom path
  const resolvedPath = isAbsolute(directory) ? directory : join(worktree, directory);

  // Check if the path is within the worktree
  const relativePath = relative(worktree, resolvedPath);
  const isLocal = !relativePath.startsWith('..') && !isAbsolute(relativePath);

  return {
    path: resolvedPath,
    isLocal,
  };
}

/**
 * Parse the filename config to get individual database filenames.
 *
 * @param filename - Filename configuration (string or object)
 * @returns Object with memory and history filenames (null if disabled)
 */
function parseFilenameConfig(filename: DatabaseFilenameConfig): {
  memory: string | null;
  history: string | null;
} {
  if (typeof filename === 'string') {
    // Shared database
    return { memory: filename, history: filename };
  }

  // Split databases - omitted keys mean disabled
  return {
    memory: filename.memory ?? null,
    history: filename.history ?? null,
  };
}

/**
 * Parse the gitignore config to get per-database settings.
 *
 * @param gitignore - Gitignore configuration (boolean or object)
 * @returns Object with memory and history gitignore settings
 */
function parseGitignoreConfig(gitignore: GitignoreConfig): {
  memory: boolean;
  history: boolean;
} {
  if (typeof gitignore === 'boolean') {
    return { memory: gitignore, history: gitignore };
  }

  // Per-database settings, default to true if not specified
  return {
    memory: gitignore.memory ?? true,
    history: gitignore.history ?? true,
  };
}

/**
 * Ensure a directory exists, creating it if necessary.
 *
 * @param dirPath - Directory path to ensure exists
 */
function ensureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Calculate the relative path from worktree for gitignore.
 *
 * @param fullPath - Full path to the file
 * @param worktree - Repository root path
 * @returns Relative path suitable for .gitignore, or null if outside worktree
 */
function getGitignoreRelativePath(fullPath: string, worktree: string): string | null {
  const relativePath = relative(worktree, fullPath);

  // If path goes outside worktree, skip it
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null;
  }

  // Normalize path separators for gitignore (always use forward slashes)
  return relativePath.replace(/\\/g, '/');
}

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

/**
 * Resolve storage paths for Memoir data.
 *
 * Resolves both memory and history database paths based on configuration.
 * Handles keywords ('auto', 'local', 'global') and custom paths.
 * Features can be disabled by omitting keys from the filename config.
 *
 * @param worktree - The repository root path
 * @param projectId - The OpenCode project identifier
 * @param config - The resolved Memoir configuration
 * @returns Storage paths including both database files
 */
export function resolveStoragePaths(
  worktree: string,
  projectId: string,
  config: ResolvedMemoirConfig
): StoragePaths {
  const { directory, filename, gitignore } = config.storage;

  // Resolve the storage directory
  const resolvedDir = resolveDirectory(directory, worktree, projectId);

  // Parse filename and gitignore configs
  const filenames = parseFilenameConfig(filename);
  const gitignoreSettings = parseGitignoreConfig(gitignore);

  // Ensure directory exists if any database is enabled
  if (filenames.memory || filenames.history) {
    ensureDirectory(resolvedDir.path);
  }

  // Build database paths
  let memoryDb: ResolvedDatabasePath | null = null;
  let historyDb: ResolvedDatabasePath | null = null;

  if (filenames.memory) {
    memoryDb = {
      path: join(resolvedDir.path, filenames.memory),
      directory: resolvedDir.path,
      isLocal: resolvedDir.isLocal,
      manageGitignore: gitignoreSettings.memory,
    };
  }

  if (filenames.history) {
    historyDb = {
      path: join(resolvedDir.path, filenames.history),
      directory: resolvedDir.path,
      isLocal: resolvedDir.isLocal,
      manageGitignore: gitignoreSettings.history,
    };
  }

  // Check if databases share the same file
  const sharedDatabase =
    memoryDb !== null &&
    historyDb !== null &&
    normalize(memoryDb.path) === normalize(historyDb.path);

  // Calculate gitignore paths (only for local databases with gitignore enabled)
  const gitignorePaths: string[] = [];

  if (memoryDb?.isLocal && memoryDb.manageGitignore) {
    const relativePath = getGitignoreRelativePath(memoryDb.path, worktree);
    if (relativePath) {
      gitignorePaths.push(relativePath);
    }
  }

  if (historyDb?.isLocal && historyDb.manageGitignore && !sharedDatabase) {
    const relativePath = getGitignoreRelativePath(historyDb.path, worktree);
    if (relativePath && !gitignorePaths.includes(relativePath)) {
      gitignorePaths.push(relativePath);
    }
  }

  return {
    root: resolvedDir.path,
    isLocal: resolvedDir.isLocal,
    memoryDb,
    historyDb,
    sharedDatabase,
    gitignorePaths,
  };
}

/**
 * Update .gitignore to include Memoir database paths.
 *
 * Only updates if there are local database paths with gitignore enabled
 * that aren't already in .gitignore.
 *
 * @param worktree - The repository root path
 * @param paths - Resolved storage paths
 */
export function updateGitignore(worktree: string, paths: StoragePaths): void {
  // Skip if no paths to add
  if (paths.gitignorePaths.length === 0) {
    return;
  }

  const gitignorePath = join(worktree, '.gitignore');

  // Read existing gitignore or start fresh
  let content = '';
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf-8');
  }

  // Check which paths need to be added
  const pathsToAdd = paths.gitignorePaths.filter((p) => {
    // Check if path is already in gitignore (exact match or with leading /)
    const patterns = [p, `/${p}`, `${p}/`, `/${p}/`];
    return !patterns.some((pattern) => content.includes(pattern));
  });

  if (pathsToAdd.length === 0) {
    return;
  }

  // Build the new entries
  const newEntries = ['', GITIGNORE_MARKER, ...pathsToAdd].join('\n');

  // Append to gitignore
  const updatedContent = content.endsWith('\n')
    ? content + newEntries + '\n'
    : content + '\n' + newEntries + '\n';

  writeFileSync(gitignorePath, updatedContent, 'utf-8');
}
