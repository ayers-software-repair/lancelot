// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  chunkText,
  parseIndexArgs,
  readFolder,
  rowsFor,
  stripHtml,
  titleOf,
} from '../src/services/documents.js';

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('chunkText', () => {
  it('keeps short text as one chunk', () => {
    expect(chunkText('one\n\ntwo')).toEqual(['one\n\ntwo']);
  });

  it('packs paragraphs and starts a new chunk before one would pass the size', () => {
    const paragraph = 'word '.repeat(50).trim(); // 249 characters
    const chunks = chunkText([paragraph, paragraph, paragraph, paragraph].join('\n\n'), 600);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(`${paragraph}\n\n${paragraph}`);
    expect(chunks.every((chunk) => chunk.length <= 600)).toBe(true);
  });

  it('cuts a paragraph longer than the size at a space', () => {
    const chunks = chunkText('alpha '.repeat(500).trim(), 1200);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1200);
      expect(chunk.startsWith('alpha')).toBe(true);
      expect(chunk.endsWith('alpha')).toBe(true);
    }
    expect(chunks.join(' ').split(' ')).toHaveLength(500);
  });

  it('cuts a paragraph with no spaces at the size', () => {
    const chunks = chunkText('x'.repeat(2500), 1200);
    expect(chunks.map((chunk) => chunk.length)).toEqual([1200, 1200, 100]);
  });

  it('returns nothing for empty text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('\n\n  \n\n')).toEqual([]);
  });

  it('uses about 1,200 characters by default', () => {
    const chunks = chunkText(('para '.repeat(100) + '\n\n').repeat(10));
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(1200);
    expect(chunks.length).toBeGreaterThan(3);
  });
});

describe('stripHtml', () => {
  it('drops tags, scripts, styles and comments', () => {
    const html =
      '<html><head><title>T</title><style>p{color:red}</style><script>alert(1)</script></head>' +
      '<body><!-- note --><h1>Head</h1><p>Hello <b>world</b></p></body></html>';
    const text = stripHtml(html);
    expect(text).not.toMatch(/[<>]|alert|color|note/);
    expect(text).toContain('Head');
    expect(text).toContain('Hello world');
  });

  it('turns the end of a block into a paragraph break', () => {
    expect(stripHtml('<p>one</p><p>two</p>')).toBe('one\n\ntwo');
    expect(stripHtml('a<br>b')).toBe('a\n\nb');
  });

  it('decodes the common entities', () => {
    expect(stripHtml('<p>a &amp; b &lt;c&gt; &quot;d&quot; it&#39;s&nbsp;e</p>')).toBe(
      'a & b <c> "d" it\'s e',
    );
  });
});

describe('titleOf and rowsFor', () => {
  it('uses the first markdown heading, else the file name', () => {
    expect(titleOf('guide/intro.md', 'text\n\n## Second\n\n# Later')).toBe('Second');
    expect(titleOf('guide/intro.md', '# Intro ##\nbody')).toBe('Intro');
    expect(titleOf('guide/notes.txt', 'no heading here')).toBe('notes');
  });

  it('numbers the chunks of a file and strips HTML before chunking', () => {
    const rows = rowsFor('a/page.html', '<h1>Hi</h1><p>one</p>');
    expect(rows).toEqual([
      { id: 'a/page.html#0', path: 'a/page.html', title: 'page', text: 'Hi\n\none' },
    ]);
    const long = rowsFor('doc.md', `# Doc\n\n${'text '.repeat(600)}`);
    expect(long.length).toBeGreaterThan(1);
    expect(long.map((row) => row.id)).toEqual(long.map((_, index) => `doc.md#${index}`));
    expect(new Set(long.map((row) => row.title))).toEqual(new Set(['Doc']));
  });
});

describe('readFolder', () => {
  it('reads .md, .txt and .html below the folder, with relative paths, and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lancelot-docs-'));
    scratch.push(dir);
    mkdirSync(join(dir, 'sub'));
    mkdirSync(join(dir, '.hidden'));
    writeFileSync(join(dir, 'a.md'), '# A\n\nalpha');
    writeFileSync(join(dir, 'sub', 'b.txt'), 'beta');
    writeFileSync(join(dir, 'sub', 'c.html'), '<p>gamma</p>');
    writeFileSync(join(dir, 'image.png'), 'not text');
    writeFileSync(join(dir, '.hidden', 'd.md'), 'delta');

    expect(readFolder(dir).map((row) => [row.path, row.title, row.text])).toEqual([
      ['a.md', 'A', '# A\n\nalpha'],
      ['sub/b.txt', 'b', 'beta'],
      ['sub/c.html', 'c', 'gamma'],
    ]);
  });
});

describe('parseIndexArgs', () => {
  it('takes a folder, a database path and an optional table', () => {
    expect(parseIndexArgs(['docs', 'db'], 'documents')).toEqual({
      folder: 'docs',
      dbPath: 'db',
      table: 'documents',
    });
    expect(parseIndexArgs(['docs', 'db', '--table', 'faq'], 'documents').table).toBe('faq');
    expect(parseIndexArgs(['--table=faq', 'docs', 'db'], 'documents').table).toBe('faq');
  });

  it('refuses a missing path, an extra one, a bare --table and an unknown option', () => {
    for (const argv of [[], ['docs'], ['a', 'b', 'c'], ['a', 'b', '--table'], ['a', 'b', '--x']]) {
      expect(() => parseIndexArgs(argv, 'documents')).toThrow();
    }
  });

});
