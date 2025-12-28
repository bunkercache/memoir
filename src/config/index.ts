/**
 * Configuration Service
 *
 * Provides configuration resolution and access for the Memoir plugin.
 * Supports layered configuration with repo-local, global, and default values.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  MemoirConfig,
  ResolvedConfig,
  ResolvedMemoirConfig,
  MemoryConfig,
  ChunksConfig,
  SearchConfig,
  StorageConfig,
  LoggingConfig,
} from '../types.ts';
import { DEFAULT_CONFIG } from './defaults.ts';

export { DEFAULT_CONFIG } from './defaults.ts';
export { isLocalInstall, resolveStoragePaths } from './paths.ts';

/**
 * Merge storage configuration with proper handling of filename and gitignore.
 *
 * These fields can be either primitives or objects, so we need to handle
 * the override logic carefully.
 *
 * @param base - Base storage config
 * @param override - Override storage config (partial)
 * @returns Merged storage config
 */
function mergeStorageConfig(
  base: ResolvedMemoirConfig['storage'],
  override: MemoirConfig['storage']
): ResolvedMemoirConfig['storage'] {
  if (!override) {
    return base;
  }

  return {
    directory: override.directory ?? base.directory,
    filename: override.filename ?? base.filename,
    gitignore: override.gitignore ?? base.gitignore,
  };
}

/**
 * Deep merge two configuration objects.
 *
 * Override values take precedence over base values.
 * Nested objects are merged recursively.
 *
 * @param base - The base configuration (typically defaults)
 * @param override - The override configuration (user-provided)
 * @returns Merged configuration
 */
export function mergeConfig(
  base: ResolvedMemoirConfig,
  override: MemoirConfig
): ResolvedMemoirConfig {
  return {
    memory: { ...base.memory, ...override.memory },
    chunks: { ...base.chunks, ...override.chunks },
    search: { ...base.search, ...override.search },
    storage: mergeStorageConfig(base.storage, override.storage),
    logging: { ...base.logging, ...override.logging },
  };
}

/**
 * Resolve configuration from available sources.
 *
 * Configuration precedence (highest to lowest):
 * 1. Repo-local: `<worktree>/.opencode/memoir.json`
 * 2. Global: `~/.config/opencode/memoir.json`
 * 3. Internal defaults
 *
 * @param worktree - The repository root path
 * @returns Resolved configuration with source information
 */
export function resolveConfig(worktree: string): ResolvedConfig {
  // 1. Check for repo-local config
  const localPath = join(worktree, '.opencode', 'memoir.json');
  if (existsSync(localPath)) {
    const content = readFileSync(localPath, 'utf-8');
    const localConfig = JSON.parse(content) as MemoirConfig;
    return {
      config: mergeConfig(DEFAULT_CONFIG, localConfig),
      source: 'local',
      path: localPath,
    };
  }

  // 2. Check for global config
  const globalPath = join(homedir(), '.config', 'opencode', 'memoir.json');
  if (existsSync(globalPath)) {
    const content = readFileSync(globalPath, 'utf-8');
    const globalConfig = JSON.parse(content) as MemoirConfig;
    return {
      config: mergeConfig(DEFAULT_CONFIG, globalConfig),
      source: 'global',
      path: globalPath,
    };
  }

  // 3. Return defaults
  return {
    config: DEFAULT_CONFIG,
    source: 'default',
  };
}

/**
 * Singleton configuration service for runtime access.
 *
 * Must be initialized with a worktree path before use.
 * Provides typed access to all configuration sections.
 *
 * @example
 * ```typescript
 * // Initialize at plugin startup
 * ConfigService.initialize('/path/to/repo');
 *
 * // Access configuration anywhere
 * const config = ConfigService.get();
 * console.log(config.memory.maxInject);
 * ```
 */
export class ConfigService {
  private static instance: ConfigService | null = null;

  private readonly resolvedConfig: ResolvedMemoirConfig;
  private readonly configSource: 'local' | 'global' | 'default';
  private readonly configPath?: string;

  private constructor(
    config: ResolvedMemoirConfig,
    source: 'local' | 'global' | 'default',
    path?: string
  ) {
    this.resolvedConfig = config;
    this.configSource = source;
    this.configPath = path;
  }

  /**
   * Initialize the configuration service.
   *
   * Resolves configuration from available sources and creates the singleton.
   * If already initialized, returns the existing instance.
   *
   * @param worktree - The repository root path
   * @returns The initialized ConfigService instance
   */
  static initialize(worktree: string): ConfigService {
    if (ConfigService.instance) {
      return ConfigService.instance;
    }

    const resolved = resolveConfig(worktree);
    ConfigService.instance = new ConfigService(resolved.config, resolved.source, resolved.path);

    return ConfigService.instance;
  }

  /**
   * Get the configuration service instance.
   *
   * @throws Error if the service has not been initialized
   * @returns The ConfigService instance
   */
  static get(): ConfigService {
    if (!ConfigService.instance) {
      throw new Error('ConfigService not initialized. Call ConfigService.initialize() first.');
    }
    return ConfigService.instance;
  }

  /**
   * Reset the configuration service.
   *
   * Clears the singleton instance. Primarily used for testing.
   */
  static reset(): void {
    ConfigService.instance = null;
  }

  /**
   * Get the memory configuration section.
   */
  get memory(): MemoryConfig {
    return this.resolvedConfig.memory;
  }

  /**
   * Get the chunks configuration section.
   */
  get chunks(): ChunksConfig {
    return this.resolvedConfig.chunks;
  }

  /**
   * Get the search configuration section.
   */
  get search(): SearchConfig {
    return this.resolvedConfig.search;
  }

  /**
   * Get the storage configuration section.
   */
  get storage(): StorageConfig {
    return this.resolvedConfig.storage;
  }

  /**
   * Get the logging configuration section.
   */
  get logging(): LoggingConfig {
    return this.resolvedConfig.logging;
  }

  /**
   * Get the source of the current configuration.
   *
   * @returns 'local' if from repo config, 'global' if from user config, 'default' if using defaults
   */
  getSource(): 'local' | 'global' | 'default' {
    return this.configSource;
  }

  /**
   * Get the path to the configuration file.
   *
   * @returns The config file path, or undefined if using defaults
   */
  getPath(): string | undefined {
    return this.configPath;
  }
}
