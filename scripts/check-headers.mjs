#!/usr/bin/env node
// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
// Every source file carries the two-line header in its first four lines.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED = [
  '// Copyright Ayers Electronics Inc. All rights reserved.',
  '// SPDX-License-Identifier: Apache-2.0',
];
const SKIP = new Set(['node_modules', 'dist', 'coverage']);
const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const failures = [];
let checked = 0;

function check(path) {
  if (!CODE.test(path) || path.endsWith('.d.ts')) {
    return;
  }
  checked++;
  const head = readFileSync(path, 'utf8').split('\n').slice(0, 4).join('\n');
  if (!REQUIRED.every((line) => head.includes(line))) {
    failures.push(path);
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else {
      check(path);
    }
  }
}

for (const dir of ['src', 'tests', 'scripts']) {
  walk(dir);
}
for (const entry of readdirSync('.')) {
  if (statSync(entry).isFile()) {
    check(entry);
  }
}

if (checked < 10) {
  console.error(`header check: only ${checked} file(s) found, which is a broken scan`);
  process.exit(1);
}
if (failures.length > 0) {
  console.error(`Missing header in ${failures.length} file(s):`);
  for (const file of failures) {
    console.error(`  ${file}`);
  }
  process.exit(1);
}
console.log(`header check: clean (${checked} files)`);
