// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { checkPublication, checkSource, checkRegistryRecord, registryVersion } from './release.mjs';

const workflow = readFileSync(new URL('../.github/workflows/registry.yml', import.meta.url), 'utf8');

test('company credentials are isolated after successful npm and registry publication', () => {
  const [publication, dispatch] = workflow.split('\n  dispatch:\n');
  assert.ok(dispatch, 'isolated dispatch job required');
  assert.match(publication, /publish:\n    needs: npm\n/);
  assert.match(dispatch, /^    needs: publish\n/);
  assert.match(dispatch, /    permissions: \{\}/);
  assert.doesNotMatch(publication, /RELEASE_APP_PRIVATE_KEY|SITE_DISPATCH_TOKEN/);
  assert.doesNotMatch(dispatch, /checkout@|npm |node |curl |always\(\)/);
  assert.match(dispatch, /repositories: ayers\.repair\n/);
  assert.match(dispatch, /permission-contents: write\n/);
  assert.match(dispatch, /skip-token-revoke: false\n/);
  assert.match(dispatch, /app-id: '5549557'/);
  assert.match(dispatch, /create-github-app-token@[a-f0-9]{40}/);
});

test('absent App credentials skip mint and dispatch without a PAT fallback', () => {
  const dispatch = workflow.split('\n  dispatch:\n')[1];
  assert.match(dispatch, /DISPATCH: \$\{\{ secrets\.RELEASE_APP_PRIVATE_KEY != '' \}\}/);
  const steps = dispatch.split(/\n      - name: /).slice(1);
  assert.equal(steps.length, 3);
  for (const step of steps.slice(0, 2)) {
    assert.match(step, /if: \$\{\{ env\.DISPATCH == 'true' \}\}/);
  }
  assert.match(steps[1], /GH_TOKEN: \$\{\{ steps\.app\.outputs\.token \}\}/);
  assert.match(steps[1], /event_type=mcp-release -f "client_payload\[ref\]=\$\{TAG\}"/);
  assert.match(steps[2], /if: \$\{\{ env\.DISPATCH != 'true' \}\}/);
  assert.match(steps[2], /hosted release was not dispatched/);
  assert.doesNotMatch(workflow, /SITE_DISPATCH_TOKEN|continue-on-error/);
});

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
