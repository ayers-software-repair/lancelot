// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import {
  archiveIntegrity,
  archiveReceipt,
  checkPublication,
  checkSource,
  checkRegistryRecord,
  registryVersion,
} from './release.mjs';

const bytes = Buffer.from('synthetic archive bytes');
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const receiptEnv = {
  GITHUB_REPOSITORY: 'ayers-software-repair/lancelot',
  TAG: 'v0.3.2',
  GITHUB_REF: 'refs/tags/v0.3.2',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '123456',
  GITHUB_RUN_ATTEMPT: '1',
};

const pkg = {
  name: '@ayerselectronics/lancelot',
  version: '0.3.2',
  mcpName: 'io.github.ayers-software-repair/lancelot',
};
const source = () => ({
  tag: 'v0.3.2',
  ref: 'refs/tags/v0.3.2',
  sha: 'a'.repeat(40),
  head: 'a'.repeat(40),
  pkg,
  lock: { name: pkg.name, version: pkg.version, packages: { '': { version: pkg.version } } },
  server: {
    name: pkg.mcpName,
    version: pkg.version,
    packages: [{ identifier: pkg.name, version: pkg.version }],
  },
  runs: [
    {
      headSha: 'a'.repeat(40),
      headBranch: 'main',
      event: 'push',
      status: 'completed',
      conclusion: 'success',
    },
  ],
});

test('receipt integrity comes from exact archive bytes and matching package metadata', () => {
  const packed = [
    {
      name: pkg.name,
      version: pkg.version,
      filename: 'ayerselectronics-lancelot-0.3.2.tgz',
      integrity,
    },
  ];
  assert.equal(archiveIntegrity(packed, pkg, bytes), integrity);
  assert.throws(() => archiveIntegrity(packed, pkg, Buffer.from('changed archive bytes')));
  for (const change of [
    { name: 'other' },
    { version: '0.3.1' },
    { filename: '../archive.tgz' },
    { integrity: 'sha512-other' },
  ]) {
    assert.throws(() => archiveIntegrity([{ ...packed[0], ...change }], pkg, bytes));
  }
  assert.throws(() => archiveIntegrity([], pkg, bytes));
});

test('later completion observes its own attempt without replacing the original producer', () => {
  const producer = archiveReceipt('producer', pkg, integrity, receiptEnv);
  const completion = archiveReceipt('completion', pkg, integrity, {
    ...receiptEnv,
    GITHUB_RUN_ATTEMPT: '2',
  });
  assert.deepEqual(producer.observation, { role: 'producer', runId: '123456', runAttempt: 1 });
  assert.deepEqual(completion.observation, { role: 'completion', runId: '123456', runAttempt: 2 });
  assert.equal(completion.integrity, producer.integrity);
  assert.equal(completion.commit, producer.commit);
  assert.equal(Object.hasOwn(completion, 'producer'), false);
  for (const change of [
    { GITHUB_REPOSITORY: 'other/repo' },
    { TAG: 'v0.3.1' },
    { GITHUB_REF: 'refs/heads/main' },
    { GITHUB_SHA: 'wrong' },
    { GITHUB_RUN_ID: '0' },
    { GITHUB_RUN_ATTEMPT: '0' },
    { GITHUB_RUN_ATTEMPT: '1.5' },
  ])
    assert.throws(() => archiveReceipt('completion', pkg, integrity, { ...receiptEnv, ...change }));
  assert.throws(() => archiveReceipt('unknown', pkg, integrity, receiptEnv));
  assert.throws(() => archiveReceipt('producer', pkg, 'sha512-invalid', receiptEnv));
});

test('producer receipts follow actual publication and attempt artifacts survive later failure', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/registry.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /if: steps\.pack\.outputs\.exists != 'true'/);
  assert.match(workflow, /npm publish[^\n]+\n          node scripts\/release\.mjs producer/);
  assert.match(workflow, /Retain archive observations for this attempt\n        if: always\(\)/);
  assert.match(
    workflow,
    /name: lancelot-archive-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/lancelot-archive-receipts\/\*\.json/);
  assert.doesNotMatch(workflow, /overwrite: true/);
});

test('CLI refuses mismatched public integrity without writing completion evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lancelot-receipt-'));
  const receipts = join(dir, 'receipts');
  const filename = `ayerselectronics-lancelot-${pkg.version}.tgz`;
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(dir, filename), bytes);
  writeFileSync(
    join(dir, 'pack.json'),
    JSON.stringify([{ name: pkg.name, version: pkg.version, filename, integrity }]),
  );
  const run = (mode, publicIntegrity, attempt) =>
    execFileSync(
      process.execPath,
      [
        '--import',
        `data:text/javascript,globalThis.fetch=async()=>Response.json(${JSON.stringify({ ...pkg, dist: { integrity: publicIntegrity } })})`,
        fileURLToPath(new URL('./release.mjs', import.meta.url)),
        mode,
        'pack.json',
      ],
      {
        cwd: dir,
        env: { ...receiptEnv, GITHUB_RUN_ATTEMPT: attempt, RELEASE_RECEIPT_DIR: receipts },
        stdio: 'pipe',
        timeout: 10000,
      },
    );
  try {
    assert.throws(() => run('published', 'sha512-mismatch', '2'), /published archive differs/);
    assert.equal(existsSync(receipts), false);
    run('producer', integrity, '1');
    assert.equal(existsSync(join(receipts, 'completion.json')), false);
    run('published', integrity, '2');
    const producer = JSON.parse(readFileSync(join(receipts, 'producer.json')));
    const completion = JSON.parse(readFileSync(join(receipts, 'completion.json')));
    assert.equal(producer.observation.runAttempt, 1);
    assert.equal(completion.observation.runAttempt, 2);
    assert.equal(completion.integrity, integrity);
    assert.throws(() => run('published', integrity, '2'), /EEXIST/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only exact tagged source with successful main CI can publish', () => {
  assert.equal(checkSource(source()), 'latest');
  for (const change of [
    { tag: 'v0.3.1' },
    { ref: 'refs/heads/main' },
    { head: 'b'.repeat(40) },
    { runs: [] },
    ...['headSha', 'headBranch', 'event', 'status', 'conclusion'].map((key) => ({
      runs: [{ ...source().runs[0], [key]: 'wrong' }],
    })),
    { lock: { ...source().lock, version: '0.3.1' } },
    { server: { ...source().server, version: '0.3.1' } },
    {
      server: {
        ...source().server,
        packages: [{ identifier: 'another-package', version: pkg.version }],
      },
    },
  ])
    assert.throws(() => checkSource({ ...source(), ...change }));
});

test('prerelease metadata selects next only when every version agrees', () => {
  const input = source();
  const version = '0.3.2-next.1';
  input.pkg = { ...pkg, version };
  input.lock = { ...input.lock, version, packages: { '': { version } } };
  input.server = { ...input.server, version, packages: [{ identifier: pkg.name, version }] };
  input.tag = `v${version}`;
  input.ref = `refs/tags/v${version}`;
  assert.equal(checkSource(input), 'next');
});

test('an existing version is reusable only for the same archive and identity', () => {
  const data = { ...pkg, dist: { integrity: 'sha512-tested' } };
  checkPublication(data, pkg, 'sha512-tested');
  for (const changed of [
    { name: 'other' },
    { version: '0.3.1' },
    { mcpName: 'other' },
    { dist: { integrity: 'sha512-other' } },
  ]) {
    assert.throws(() => checkPublication({ ...data, ...changed }, pkg, 'sha512-tested'));
  }
});

test('only an explicit registry 404 permits a first publication', async () => {
  assert.equal(await registryVersion(pkg, async () => new Response('', { status: 404 })), null);
  await assert.rejects(
    registryVersion(pkg, async () => new Response('', { status: 503 })),
    /status is unknown/,
  );
  await assert.rejects(
    registryVersion(pkg, async () => {
      throw new Error('offline');
    }),
    /offline/,
  );
  await assert.rejects(
    registryVersion(pkg, async () => new Response('invalid json')),
    SyntaxError,
  );
  assert.deepEqual(await registryVersion(pkg, async () => Response.json(pkg)), pkg);
});

test('registry readback verifies exact identity, transport and hosted remote', () => {
  const expected = {
    ...source().server,
    packages: [
      { ...source().server.packages[0], registryType: 'npm', transport: { type: 'stdio' } },
    ],
    remotes: [{ type: 'streamable-http', url: 'https://mcp.ayers.repair/lancelot' }],
  };
  const record = {
    server: expected,
    _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } },
  };
  checkRegistryRecord(record, expected);
  for (const changed of [
    { name: 'different-server' },
    { version: '0.3.1' },
    { packages: [] },
    { packages: [{ ...expected.packages[0], transport: { type: 'other' } }] },
    { remotes: [] },
    { remotes: [{ ...expected.remotes[0], url: 'https://invalid.example/' }] },
  ]) {
    assert.throws(() =>
      checkRegistryRecord({ ...record, server: { ...expected, ...changed } }, expected),
    );
  }
  assert.throws(() => checkRegistryRecord({ ...record, _meta: {} }, expected));
});
