// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as constants from '../src/config/constants.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe('constants', () => {
  it('names the four tools', () => {
    expect(constants.TOOL_NAMES).toEqual({
      SEARCH: 'lancedb_search',
      QUERY: 'lancedb_query',
      STATUS: 'lancedb_status',
      VERSION: 'lancedb_version',
    });
  });

  it('keeps the documented defaults', () => {
    expect(constants.LANCEDB_DEFAULTS.DEFAULT_LIMIT).toBe(20);
    expect(constants.LANCEDB_DEFAULTS.CONTEXT_BUDGET).toBe(8000);
    expect(constants.LANCEDB_DEFAULTS.TEXT_COLUMN).toBe('text');
    expect(constants.LANCEDB_DEFAULTS.VECTOR_COLUMN).toBe('vector');
    expect(constants.EMBEDDING_DEFAULTS.MODEL).toBe('text-embedding-ada-002');
    expect(constants.EMBEDDING_DEFAULTS.DIMENSIONS).toBe(1536);
    expect(constants.SEARCH_TYPES).toEqual(['vector', 'text', 'auto']);
  });

  it('names the service and vendor for Ayers', () => {
    expect(constants.MISC.SERVICE_NAME).toBe('lancelot');
    expect(constants.MISC.VENDOR_NAME).toBe('Ayers Electronics');
  });

  it('has every GROUP.KEY the source reads', () => {
    const groups = Object.entries(constants).filter(
      ([, value]) => typeof value === 'object' && !Array.isArray(value),
    );
    expect(groups.length).toBeGreaterThan(0);

    const missing: string[] = [];
    let reads = 0;
    for (const file of sourceFiles(SRC)) {
      if (file.endsWith('constants.ts')) {
        continue;
      }
      const text = readFileSync(file, 'utf8');
      for (const [name, group] of groups) {
        for (const match of text.matchAll(new RegExp(`\\b${name}\\.([A-Z][A-Z_]*)\\b`, 'g'))) {
          reads++;
          const key = match[1] as string;
          if (!(key in (group as object))) {
            missing.push(`${file}: ${name}.${key}`);
          }
        }
      }
    }
    expect(reads).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  it('is imported only for names it exports', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/import \{([^}]*)\} from '[./]+\/config\/constants\.js'/g)) {
        for (const raw of (match[1] as string).split(',')) {
          const name = raw.trim().replace(/^type /, '');
          if (name && !(name in constants) && !['SearchType'].includes(name)) {
            missing.push(`${file}: ${name}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
