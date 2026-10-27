#!/usr/bin/env node
// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Builds the table the server reads. This is the only place in the package that writes to a
 * LanceDB database: the server never does (tests/readonly.test.ts holds that). It talks to a
 * person at a terminal, so it uses stdout, as lancelot-init does; the server never does.
 *
 * lancelot-index <folder> <dbPath> [--table documents]
 */
import { existsSync, statSync } from 'node:fs';
import * as lancedb from '@lancedb/lancedb';
import { LANCEDB_DEFAULTS } from '../config/constants.js';
import { parseIndexArgs, readFolder } from '../services/documents.js';

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

async function main(): Promise<void> {
  const { folder, dbPath, table } = parseIndexArgs(process.argv.slice(2), LANCEDB_DEFAULTS.TABLE);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new Error(`Not a folder: ${folder}`);
  }

  const rows = readFolder(folder);
  if (rows.length === 0) {
    throw new Error(`No .md, .txt or .html text found under ${folder}`);
  }

  const db = await lancedb.connect(dbPath);
  // "overwrite" replaces the table, so running the command again rebuilds it from the folder.
  await db.createTable(table, rows, { mode: 'overwrite' });
  db.close();
  say(`Wrote ${rows.length} chunks to table "${table}" in ${dbPath}.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`lancelot-index: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
