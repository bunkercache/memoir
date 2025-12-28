#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * Docs Generator
 *
 * Generates documentation site from:
 * - schema/config.schema.json - Configuration reference
 * - src/types.ts - TypeScript types
 * - README.md - Main documentation
 * - package.json - Version info
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// =============================================================================
// Configuration
// =============================================================================

const ROOT = join(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'dist-docs');
const SCHEMA_PATH = join(ROOT, 'schema', 'config.schema.json');
const README_PATH = join(ROOT, 'README.md');
const PACKAGE_PATH = join(ROOT, 'package.json');

const BASE_URL = process.env.DOCS_BASE_URL || 'https://bunkercache.github.io/memoir';
const VERSION = process.env.DOCS_VERSION || 'dev';

// =============================================================================
// Helpers
// =============================================================================

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =============================================================================
// Schema Documentation Generator
// =============================================================================

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  oneOf?: JsonSchemaProperty[];
  $ref?: string;
}

interface JsonSchema {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  definitions?: Record<string, JsonSchemaProperty>;
}

function generateSchemaTable(
  properties: Record<string, JsonSchemaProperty>,
  definitions: Record<string, JsonSchemaProperty> = {},
  prefix = ''
): string {
  const rows: string[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const fullName = prefix ? `${prefix}.${name}` : name;
    let type = prop.type || 'any';

    // Handle arrays
    if (type === 'array' && prop.items) {
      const itemType = prop.items.type || 'any';
      type = `${itemType}[]`;
    }

    // Handle oneOf
    if (prop.oneOf) {
      type = prop.oneOf.map((o) => o.type || 'object').join(' | ');
    }

    // Handle enums
    if (prop.enum) {
      type = prop.enum.map((e) => `"${e}"`).join(' | ');
    }

    const defaultVal = prop.default !== undefined ? JSON.stringify(prop.default) : '-';
    const description = prop.description || '';

    rows.push(`
      <tr>
        <td><code>${escapeHtml(fullName)}</code></td>
        <td><code>${escapeHtml(String(type))}</code></td>
        <td><code>${escapeHtml(defaultVal)}</code></td>
        <td>${escapeHtml(description)}</td>
      </tr>
    `);

    // Recurse into nested objects
    if (prop.properties) {
      rows.push(generateSchemaTable(prop.properties, definitions, fullName));
    }
  }

  return rows.join('\n');
}

function generateSchemaDoc(schema: JsonSchema): string {
  const properties = schema.properties || {};
  const definitions = schema.definitions || {};

  return `
    <section id="configuration">
      <h2>Configuration Reference</h2>
      <p>${escapeHtml(schema.description || '')}</p>
      
      <h3>Schema URL</h3>
      <pre><code>{
  "$schema": "${BASE_URL}/${VERSION}/schema/config.schema.json"
}</code></pre>

      <h3>Properties</h3>
      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Type</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${generateSchemaTable(properties, definitions)}
        </tbody>
      </table>
    </section>
  `;
}

// =============================================================================
// HTML Template
// =============================================================================

function generateHtml(content: {
  title: string;
  version: string;
  schemaDoc: string;
  readme: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(content.title)}</title>
  <style>
    :root {
      --bg: #0d1117;
      --fg: #c9d1d9;
      --accent: #58a6ff;
      --border: #30363d;
      --code-bg: #161b22;
      --success: #3fb950;
      --warning: #d29922;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.6;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 2rem;
    }
    header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
      margin-bottom: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    header h1 { margin: 0; color: #fff; }
    .version {
      background: var(--code-bg);
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.875rem;
      border: 1px solid var(--border);
    }
    nav {
      background: var(--code-bg);
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 2rem;
    }
    nav a {
      color: var(--accent);
      text-decoration: none;
      margin-right: 1.5rem;
    }
    nav a:hover { text-decoration: underline; }
    h2, h3, h4 { color: #fff; margin-top: 2rem; }
    h2 { border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    a { color: var(--accent); }
    code {
      background: var(--code-bg);
      padding: 0.2em 0.4em;
      border-radius: 4px;
      font-size: 0.9em;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    }
    pre {
      background: var(--code-bg);
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      border: 1px solid var(--border);
    }
    pre code { background: none; padding: 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
    }
    th, td {
      text-align: left;
      padding: 0.75rem;
      border: 1px solid var(--border);
    }
    th {
      background: var(--code-bg);
      color: #fff;
    }
    tr:nth-child(even) { background: rgba(255,255,255,0.02); }
    section { margin-bottom: 3rem; }
    .card {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      margin: 1rem 0;
    }
    footer {
      border-top: 1px solid var(--border);
      padding-top: 1rem;
      margin-top: 3rem;
      font-size: 0.875rem;
      color: #8b949e;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>@bunkercache/opencode-memoir</h1>
      <span class="version">${escapeHtml(content.version)}</span>
    </header>
    
    <nav>
      <a href="#overview">Overview</a>
      <a href="#installation">Installation</a>
      <a href="#configuration">Configuration</a>
      <a href="#tools">Tools</a>
      <a href="./schema/config.schema.json">JSON Schema</a>
      <a href="https://github.com/bunkercache/opencode-memoir">GitHub</a>
    </nav>

    <main>
      <section id="overview">
        <h2>Overview</h2>
        <p>A local-first, repo-scoped memory plugin for <a href="https://opencode.ai">OpenCode</a>.</p>
        
        <div class="card">
          <h4>Features</h4>
          <ul>
            <li><strong>Project Memory</strong> - Persistent storage for preferences, patterns, gotchas, and facts</li>
            <li><strong>Session History</strong> - Hierarchical chunk tree with compaction</li>
            <li><strong>Full-Text Search</strong> - SQLite FTS5 with BM25 ranking</li>
            <li><strong>Keyword Detection</strong> - Auto-triggers on phrases like "remember this"</li>
          </ul>
        </div>
      </section>

      <section id="installation">
        <h2>Installation</h2>
        <p>Add to your <code>opencode.json</code>:</p>
        <pre><code>{
  "plugin": ["@bunkercache/opencode-memoir"]
}</code></pre>
      </section>

      ${content.schemaDoc}

      <section id="tools">
        <h2>Tools</h2>
        
        <div class="card">
          <h4><code>memoir</code></h4>
          <p>Add, search, list, or forget project memories.</p>
          <pre><code>// Add a memory
memoir({ action: "add", content: "Use pnpm, not npm", type: "preference" })

// Search memories
memoir({ action: "search", query: "testing" })</code></pre>
        </div>

        <div class="card">
          <h4><code>memoir_expand</code></h4>
          <p>Expand a chunk reference to see full content.</p>
          <pre><code>// Preview chunk size first
memoir_expand({ chunk_id: "ch_abc123", preview_only: true })

// Expand with full content
memoir_expand({ chunk_id: "ch_abc123" })</code></pre>
        </div>

        <div class="card">
          <h4><code>memoir_history</code></h4>
          <p>Search session history for past work.</p>
          <pre><code>// Search all history
memoir_history({ query: "authentication" })

// Search specific session
memoir_history({ query: "bug fix", session_id: "ses_xxx" })</code></pre>
        </div>
      </section>
    </main>

    <footer>
      <p>Generated for version ${escapeHtml(content.version)} · 
         <a href="https://github.com/bunkercache/opencode-memoir">Source</a> · 
         <a href="https://www.npmjs.com/package/@bunkercache/opencode-memoir">npm</a>
      </p>
    </footer>
  </div>
</body>
</html>`;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log(`Generating docs for version: ${VERSION}`);
  console.log(`Output directory: ${OUT_DIR}`);

  // Read source files
  const schema = readJson(SCHEMA_PATH) as JsonSchema;
  const pkg = readJson(PACKAGE_PATH) as { name: string; version: string };
  const readme = readFileSync(README_PATH, 'utf-8');

  // Generate schema documentation
  const schemaDoc = generateSchemaDoc(schema);

  // Generate HTML
  const html = generateHtml({
    title: pkg.name,
    version: VERSION === 'latest' ? `v${pkg.version}` : VERSION,
    schemaDoc,
    readme,
  });

  // Create output directory
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(OUT_DIR, 'schema'), { recursive: true });

  // Write HTML
  writeFileSync(join(OUT_DIR, 'index.html'), html);
  console.log('  ✓ index.html');

  // Copy and update schema
  const schemaContent = readFileSync(SCHEMA_PATH, 'utf-8');
  const updatedSchema = schemaContent.replace(
    /"?\$id"?\s*:\s*"[^"]*"/,
    `"$id": "${BASE_URL}/${VERSION}/schema/config.schema.json"`
  );
  writeFileSync(join(OUT_DIR, 'schema', 'config.schema.json'), updatedSchema);
  console.log('  ✓ schema/config.schema.json');

  // Generate versions.json if this is a versioned build
  const versionsPath = join(OUT_DIR, 'versions.json');
  let versions: string[] = [];
  if (existsSync(versionsPath)) {
    versions = JSON.parse(readFileSync(versionsPath, 'utf-8'));
  }
  if (!versions.includes(VERSION)) {
    versions.push(VERSION);
    versions.sort((a, b) => {
      if (a === 'latest') return -1;
      if (b === 'latest') return 1;
      if (a === 'dev') return -1;
      if (b === 'dev') return 1;
      return b.localeCompare(a, undefined, { numeric: true });
    });
  }
  writeFileSync(versionsPath, JSON.stringify(versions, null, 2));
  console.log('  ✓ versions.json');

  console.log('\nDocs generated successfully!');
}

main().catch((err) => {
  console.error('Failed to generate docs:', err);
  process.exit(1);
});
