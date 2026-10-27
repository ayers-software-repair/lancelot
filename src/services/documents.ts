// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Turns a folder of .md, .txt and .html files into rows for lancelot-index. Nothing here
 * touches LanceDB: the one write lives in src/bin/lancelot-index.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import { INDEX_DEFAULTS } from '../config/constants.js';

// A type alias, not an interface: LanceDB takes Record<string, unknown> rows.
export type DocumentRow = {
  id: string;
  path: string;
  title: string;
  text: string;
};

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

const BLOCK_END = /<\/(p|div|section|article|li|ul|ol|tr|table|h[1-6]|blockquote|pre)\s*>|<br\s*\/?>/gi;

/**
 * Text from HTML, by regular expressions. Script, style and comment content goes; the end of
 * a block tag becomes a paragraph break so chunks can still split on paragraphs. It is for
 * indexing prose, not for parsing hostile markup.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(BLOCK_END, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The last space or newline at or before `size`, or `size` when the text has none. */
function cutPoint(text: string, size: number): number {
  const cut = Math.max(text.lastIndexOf(' ', size), text.lastIndexOf('\n', size));
  return cut > 0 ? cut : size;
}

/**
 * Chunks of about `size` characters. Paragraphs (blank-line separated) are packed together
 * until the next one would pass `size`; a paragraph longer than `size` is cut at a space.
 */
export function chunkText(text: string, size: number = INDEX_DEFAULTS.CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of text.split(/\n\s*\n/)) {
    let rest = paragraph.trim();
    while (rest.length > 0) {
      let piece = rest;
      if (rest.length > size) {
        piece = rest.slice(0, cutPoint(rest, size)).trim();
      }
      rest = rest.slice(piece.length).trim();
      if (current && current.length + 2 + piece.length > size) {
        chunks.push(current);
        current = '';
      }
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

/** The first markdown heading, else the file name without its extension. */
export function titleOf(fileName: string, text: string): string {
  const heading = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(text)?.[1];
  return heading?.trim() || basename(fileName, extname(fileName));
}

/** Rows for one file: `id` is `<path>#<chunk number>`. */
export function rowsFor(path: string, raw: string): DocumentRow[] {
  const text = extname(path).toLowerCase() === '.html' ? stripHtml(raw) : raw;
  const title = titleOf(path, text);
  return chunkText(text).map((chunk, index) => ({
    id: `${path}#${index}`,
    path,
    title,
    text: chunk,
  }));
}

const WANTED = new Set<string>(INDEX_DEFAULTS.EXTENSIONS);

function files(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) =>
      entry.isDirectory() ? files(join(folder, entry.name)) : [join(folder, entry.name)],
    )
    .filter((file) => WANTED.has(extname(file).toLowerCase()));
}

/** Rows for every .md, .txt and .html file under a folder. Paths are relative to it. */
export function readFolder(folder: string): DocumentRow[] {
  return files(folder).flatMap((file) =>
    rowsFor(relative(folder, file).split(sep).join('/'), readFileSync(file, 'utf8')),
  );
}

export interface IndexArgs {
  folder: string;
  dbPath: string;
  table: string;
}

/** `<folder> <dbPath> [--table <name>]` */
export function parseIndexArgs(argv: string[], defaultTable: string): IndexArgs {
  const positional: string[] = [];
  let table = defaultTable;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--table') {
      const name = argv[++i];
      if (!name || name.startsWith('-')) {
        throw new Error('--table needs a table name');
      }
      table = name;
    } else if (arg.startsWith('--table=')) {
      table = arg.slice('--table='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const [folder, dbPath] = positional;
  if (!folder || !dbPath || positional.length > 2) {
    throw new Error('Usage: lancelot-index <folder> <dbPath> [--table documents]');
  }
  return { folder, dbPath, table };
}
