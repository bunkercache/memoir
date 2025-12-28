/**
 * ID Generation Utilities for Memoir Database
 *
 * Generates URL-safe base62 IDs with prefixes for different entity types.
 * Uses crypto.getRandomValues for secure random number generation.
 */

/**
 * Base62 character set for URL-safe ID generation.
 * Contains digits, uppercase letters, and lowercase letters.
 */
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generates a unique ID with the specified prefix and length.
 *
 * @param prefix - The prefix to prepend to the ID (e.g., 'mem', 'ch')
 * @param length - The number of random characters to generate (default: 12)
 * @returns A unique ID in the format `{prefix}_{randomChars}`
 *
 * @example
 * ```typescript
 * const id = generateId('mem'); // 'mem_7xKj9mN2pQ4r'
 * const longId = generateId('custom', 16); // 'custom_7xKj9mN2pQ4rAbCd'
 * ```
 */
export function generateId(prefix: string, length: number = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);

  let id = prefix + '_';
  for (const byte of bytes) {
    id += BASE62[byte % 62];
  }

  return id;
}

/**
 * Generates a unique memory ID with the 'mem' prefix.
 *
 * @returns A unique memory ID (e.g., 'mem_7xKj9mN2pQ4r')
 *
 * @example
 * ```typescript
 * const memoryId = generateMemoryId(); // 'mem_7xKj9mN2pQ4r'
 * ```
 */
export function generateMemoryId(): string {
  return generateId('mem');
}

/**
 * Generates a unique chunk ID with the 'ch' prefix.
 *
 * @returns A unique chunk ID (e.g., 'ch_3bF8kL1nR5tY')
 *
 * @example
 * ```typescript
 * const chunkId = generateChunkId(); // 'ch_3bF8kL1nR5tY'
 * ```
 */
export function generateChunkId(): string {
  return generateId('ch');
}
