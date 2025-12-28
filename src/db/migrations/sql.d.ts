/**
 * TypeScript declaration for SQL file imports.
 *
 * Allows importing .sql files as text using Bun's import attributes:
 * import sql from './migration.sql' with { type: 'text' };
 */
declare module '*.sql' {
  const content: string;
  export default content;
}
