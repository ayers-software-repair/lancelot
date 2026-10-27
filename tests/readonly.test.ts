// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// The one file that writes: the command that builds a database for the server to read.
const INDEX_BIN = join(SRC, 'bin', 'lancelot-index.ts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

// LanceDB calls that change a database, named so that no other library shares them.
const WRITES = [
  'createTable',
  'createEmptyTable',
  'dropTable',
  'dropAllTables',
  'createIndex',
  'dropIndex',
  'mergeInsert',
  'addColumns',
  'alterColumns',
  'dropColumns',
];

// Names other libraries use too (conf, crypto). Checked in the one file that touches LanceDB.
const GENERIC_WRITES = ['.add(', '.update(', '.delete(', '.overwrite(', 'optimize(', 'restore('];

const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    .join('\n');

describe('read-only', () => {
  it('has no LanceDB write call anywhere in src but the index bin', () => {
    const files = sourceFiles(SRC).filter((file) => file !== INDEX_BIN);
    expect(files.length).toBeGreaterThan(10);

    const found: string[] = [];
    for (const file of files) {
      const text = code(file);
      const calls = file.endsWith('lancedb-service.ts') ? [...WRITES, ...GENERIC_WRITES] : WRITES;
      for (const call of calls) {
        if (text.includes(call)) {
          found.push(`${file}: ${call}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('reaches LanceDB only through the lancedb service, and the index bin', () => {
    const importers = sourceFiles(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes("'@lancedb/lancedb'"),
    );
    expect(importers.map((file) => file.split('/').pop()).sort()).toEqual([
      'lancedb-service.ts',
      'lancelot-index.ts',
    ]);
  });

  it('keeps the exclusion real: the index bin writes, and nothing else imports it', () => {
    expect(code(INDEX_BIN)).toContain('createTable');
    const others = sourceFiles(SRC).filter((file) => file !== INDEX_BIN);
    const importing = others.filter((file) =>
      readFileSync(file, 'utf8').includes("lancelot-index.js'"),
    );
    expect(importing).toEqual([]);
  });

  it.todo('opens a real database, runs every tool, and finds the folder byte-identical (needs LanceDB)');
});
