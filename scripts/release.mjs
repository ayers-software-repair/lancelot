// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkSource({ tag, ref, sha, head, pkg, lock, server, runs }) {
  assert.match(tag, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/);
  assert.equal(ref, `refs/tags/${tag}`, 'dispatch must run at the release tag');
  assert.equal(head, sha, 'checkout must match the event commit');
  assert.equal(tag, `v${pkg.version}`, 'tag must match package.json');
  assert.equal(lock.version, pkg.version, 'lockfile version must match');
  assert.equal(lock.packages[''].version, pkg.version, 'lockfile root must match');
  assert.equal(lock.name, pkg.name, 'lockfile package must match');
  assert.equal(pkg.name, '@ayerselectronics/lancelot');
  assert.equal(server.version, pkg.version);
  assert.equal(server.name, pkg.mcpName);
  assert.equal(server.packages.length, 1);
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.packages[0].version, pkg.version);
  assert.ok(
    runs.some(
      (run) =>
        run.headSha === sha &&
        run.headBranch === 'main' &&
        run.event === 'push' &&
        run.status === 'completed' &&
        run.conclusion === 'success',
    ),
    'release commit needs completed successful main-push ci.yml',
  );
  return pkg.version.includes('-') ? 'next' : 'latest';
}

export function checkPublication(data, pkg, integrity) {
  assert.equal(data.name, pkg.name, 'registry package mismatch');
  assert.equal(data.version, pkg.version, 'registry version mismatch');
  assert.equal(data.mcpName, pkg.mcpName, 'registry MCP identity mismatch');
  assert.equal(
    data.dist?.integrity,
    integrity,
    'published archive differs; never overwrite this version',
  );
}

export function archiveIntegrity(packed, pkg, bytes) {
  assert.equal(packed.length, 1, 'one package archive required');
  const archive = packed[0];
  assert.equal(archive.name, pkg.name);
  assert.equal(archive.version, pkg.version);
  assert.equal(archive.filename, `ayerselectronics-lancelot-${pkg.version}.tgz`);
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.equal(archive.integrity, integrity, 'packed archive checksum mismatch');
  return integrity;
}

export function archiveReceipt(role, pkg, integrity, env) {
  assert.ok(role === 'producer' || role === 'completion');
  assert.equal(pkg.name, '@ayerselectronics/lancelot');
  assert.equal(env.GITHUB_REPOSITORY, 'ayers-software-repair/lancelot');
  assert.equal(env.TAG, `v${pkg.version}`);
  assert.equal(env.GITHUB_REF, `refs/tags/${env.TAG}`);
  assert.match(env.GITHUB_SHA, /^[a-f0-9]{40}$/);
  assert.match(env.GITHUB_RUN_ID, /^[1-9][0-9]{0,19}$/);
  assert.match(env.GITHUB_RUN_ATTEMPT, /^[1-9][0-9]{0,5}$/);
  assert.match(integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  return {
    schema: 1,
    repository: env.GITHUB_REPOSITORY,
    package: pkg.name,
    version: pkg.version,
    tag: env.TAG,
    commit: env.GITHUB_SHA,
    integrity,
    observation: {
      role,
      runId: env.GITHUB_RUN_ID,
      runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    },
  };
}

export function checkRegistryRecord(record, expected) {
  const actual = record.server;
  assert.equal(actual?.name, expected.name, 'registry server identity mismatch');
  assert.equal(actual.version, expected.version, 'registry server version mismatch');
  assert.equal(record._meta?.['io.modelcontextprotocol.registry/official']?.status, 'active');
  assert.equal(actual.packages?.length, expected.packages.length);
  for (const pkg of expected.packages) {
    assert.ok(
      actual.packages.some(
        (value) =>
          value.registryType === pkg.registryType &&
          value.identifier === pkg.identifier &&
          value.version === pkg.version &&
          value.transport?.type === pkg.transport.type,
      ),
      'registry package or transport mismatch',
    );
  }
  assert.equal((actual.remotes || []).length, (expected.remotes || []).length);
  for (const remote of expected.remotes || []) {
    assert.ok(
      actual.remotes.some((value) => value.type === remote.type && value.url === remote.url),
      'registry hosted remote mismatch',
    );
  }
}

export async function registryVersion(pkg, fetcher = fetch) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return null;
  assert.ok(response.ok, `npm registry HTTP ${response.status}; publication status is unknown`);
  return response.json();
}

async function main() {
  const json = (name) => JSON.parse(readFileSync(name, 'utf8'));
  const pkg = json('package.json');
  const mode = process.argv[2];
  if (mode === 'source') {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    const sha = process.env.GITHUB_SHA;
    const tag = process.env.TAG;
    assert.match(sha, /^[a-f0-9]{40}$/);
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main']);
    assert.equal(
      git('rev-parse', `${tag}^{commit}`),
      sha,
      'tag moved or does not identify this source',
    );
    const runs = JSON.parse(
      execFileSync(
        'gh',
        [
          'run',
          'list',
          '--repo',
          process.env.GITHUB_REPOSITORY,
          '--workflow',
          'ci.yml',
          '--commit',
          sha,
          '--branch',
          'main',
          '--event',
          'push',
          '--json',
          'headSha,headBranch,event,status,conclusion',
        ],
        { encoding: 'utf8' },
      ),
    );
    const channel = checkSource({
      tag,
      ref: process.env.GITHUB_REF,
      sha,
      head: git('rev-parse', 'HEAD'),
      pkg,
      lock: json('package-lock.json'),
      server: json('server.json'),
      runs,
    });
    appendFileSync(process.env.GITHUB_OUTPUT, `channel=${channel}\n`);
    return;
  }
  if (mode === 'registry') {
    const server = json('server.json');
    const url = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(server.name)}/versions/${encodeURIComponent(server.version)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    assert.ok(response.ok, `MCP Registry HTTP ${response.status}`);
    checkRegistryRecord(await response.json(), server);
    return;
  }
  assert.ok(
    mode === 'inspect' || mode === 'published' || mode === 'producer',
    'expected source, inspect, published, producer or registry',
  );
  const packed = json(process.argv[3]);
  assert.equal(packed.length, 1, 'one package archive required');
  const archive = packed[0];
  assert.equal(basename(archive.filename), archive.filename, 'archive must be in this repository');
  const bytes = readFileSync(archive.filename);
  const integrity = archiveIntegrity(packed, pkg, bytes);
  const receipt = (role) => {
    const value = archiveReceipt(role, pkg, integrity, process.env);
    assert.ok(process.env.RELEASE_RECEIPT_DIR, 'receipt directory required');
    mkdirSync(process.env.RELEASE_RECEIPT_DIR, { recursive: true });
    writeFileSync(
      join(process.env.RELEASE_RECEIPT_DIR, `${role}.json`),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
  };
  if (mode === 'producer') {
    receipt('producer');
    return;
  }
  const published = await registryVersion(pkg);
  if (published) checkPublication(published, pkg, integrity);
  if (mode === 'published') {
    assert.ok(published, 'npm has not returned the published version');
    receipt('completion');
  } else {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `archive=${archive.filename}\nintegrity=${integrity}\nexists=${published !== null}\n`,
    );
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
