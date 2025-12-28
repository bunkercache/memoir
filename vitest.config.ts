import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

/**
 * Vitest configuration for Memoir.
 *
 * IMPORTANT: Run tests with `bun --bun run vitest` to ensure Bun's
 * module resolution is used (required for @opencode-ai/plugin).
 */
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  plugins: [
    {
      name: 'sql-loader',
      transform(code, id) {
        if (id.endsWith('.sql')) {
          const content = readFileSync(id, 'utf-8');
          return {
            code: `export default ${JSON.stringify(content)};`,
            map: null,
          };
        }
      },
    },
  ],
});
