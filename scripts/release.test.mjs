// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPublication, checkSource, checkRegistryRecord, registryVersion } from './release.mjs';

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
