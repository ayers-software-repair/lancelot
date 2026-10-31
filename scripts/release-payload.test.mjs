// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { archiveReceipt } from './release.mjs';
import { selectReleasePayload } from './release-payload.mjs';

const env = {
  PATH: process.env.PATH,
  GH_TOKEN: 'synthetic-read-only-token',
  GITHUB_REPOSITORY: 'ayers-software-repair/lancelot',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/tags/v0.3.3',
  TAG: 'v0.3.3',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '123456',
  GITHUB_RUN_ATTEMPT: '2',
};
const pkg = { name: '@ayerselectronics/lancelot', version: '0.3.3' };
const integrity = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;
const prefix = `repos/${env.GITHUB_REPOSITORY}/actions`;
const sha256 = (b) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
const zip = (files) =>
  execFileSync(
    'python3',
    [
      '-I',
      '-c',
      'import io,json,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n for k,v in json.load(sys.stdin).items(): z.writestr(k,v)\nsys.stdout.buffer.write(b.getvalue())',
    ],
    {
      input: JSON.stringify(
        Object.fromEntries(
          Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
        ),
      ),
      env: { PATH: process.env.PATH },
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );

function fixture(attempt = 2) {
  const context = { ...env, GITHUB_RUN_ATTEMPT: String(attempt) };
  const producer = archiveReceipt('producer', pkg, integrity, { ...env, GITHUB_RUN_ATTEMPT: '1' });
  const completion = archiveReceipt('completion', pkg, integrity, context);
  const passed = (name) => ({
    name,
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-10-31T00:00:00Z',
    completed_at: '2026-10-31T00:00:02Z',
  });
  const artifacts = [],
    responses = new Map(),
    calls = [];
  responses.set(`${prefix}/workflows/registry.yml`, {
    id: 123,
    path: '.github/workflows/registry.yml',
  });
  for (const n of attempt === 1 ? [1] : [1, 2]) {
    const members = n === 1 ? { 'producer.json': producer } : { 'completion.json': completion };
    if (attempt === 1) members['completion.json'] = completion;
    const bytes = zip(members);
    artifacts.push({
      id: n,
      name: `lancelot-archive-123456-${n}`,
      expired: false,
      size_in_bytes: bytes.length,
      digest: sha256(bytes),
      created_at: '2026-10-31T00:00:01Z',
      workflow_run: {
        id: 123456,
        head_sha: env.GITHUB_SHA,
        head_branch: 'v0.3.3',
        repository_id: 1436325534,
        head_repository_id: 1436325534,
      },
    });
    responses.set(`${prefix}/artifacts/${n}/zip`, bytes);
    responses.set(`${prefix}/runs/123456/attempts/${n}`, {
      id: 123456,
      run_attempt: n,
      workflow_id: 123,
      path: '.github/workflows/registry.yml',
      event: 'push',
      head_sha: env.GITHUB_SHA,
      head_branch: 'v0.3.3',
      repository: { id: 1436325534, full_name: env.GITHUB_REPOSITORY },
      head_repository: { id: 1436325534 },
      status: n === attempt ? 'in_progress' : 'completed',
      conclusion: n === attempt ? null : 'failure',
    });
    const jobs = [
      {
        name: 'npm',
        run_id: 123456,
        run_attempt: n,
        head_sha: env.GITHUB_SHA,
        status: 'completed',
        conclusion: n === attempt ? 'success' : 'failure',
        steps: [
          passed('Retain archive observations for this attempt'),
          {
            ...passed('Publish the inspected archive'),
            conclusion: n === 1 ? 'success' : 'skipped',
          },
          {
            ...passed('Verify public identity and archive integrity'),
            conclusion: n === attempt ? 'success' : 'failure',
          },
        ],
      },
    ];
    if (n === attempt)
      jobs.push({
        name: 'publish',
        run_id: 123456,
        head_sha: env.GITHUB_SHA,
        status: 'completed',
        conclusion: 'success',
        steps: [passed('Registry lists the exact server, package and remote')],
      });
    responses.set(`${prefix}/runs/123456/attempts/${n}/jobs?per_page=100`, {
      total_count: jobs.length,
      jobs,
    });
  }
  responses.set(`${prefix}/runs/123456/artifacts?per_page=100`, {
    total_count: artifacts.length,
    artifacts,
  });
  function execute(command, args, options) {
    if (command === 'python3') {
      assert.equal(options.env.GH_TOKEN, undefined);
      return execFileSync(command, args, options);
    }
    assert.equal(command, 'gh');
    assert.deepEqual(args.slice(0, 8), [
      'api',
      '--hostname',
      'github.com',
      '--method',
      'GET',
      '-H',
      'Accept: application/vnd.github+json',
      args[7],
    ]);
    assert.equal(options.env.GH_TOKEN, env.GH_TOKEN);
    assert.deepEqual(
      Object.keys(options.env).sort(),
      ['PATH', 'GH_HOST', 'GH_TOKEN', 'GH_DEBUG', 'GH_PROMPT_DISABLED'].sort(),
    );
    calls.push(args[7]);
    assert.ok(responses.has(args[7]), `unexpected API selector ${args[7]}`);
    const value = responses.get(args[7]);
    return Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  }
  return { context, producer, completion, artifacts, responses, calls, execute };
}

test('current run selection emits original producer identity for first publish and later completion', () => {
  for (const attempt of [1, 2]) {
    const f = fixture(attempt);
    const payload = selectReleasePayload(f.context, f);
    assert.deepEqual(Object.keys(payload), ['schema', 'release']);
    assert.equal(Object.keys(payload.release).length, 8);
    assert.equal(payload.release.publicationRunId, '123456');
    assert.equal(payload.release.publicationRunAttempt, 1);
    assert.equal(payload.release.integrity, integrity);
    assert.ok(f.calls.every((path) => path.startsWith(prefix)));
  }
});

test('missing, ambiguous, corrupt or foreign receipt evidence refuses', () => {
  const cases = [
    (f) => {
      f.context.GITHUB_EVENT_NAME = 'workflow_dispatch';
    },
    (f) => {
      f.context.GITHUB_SHA = 'b'.repeat(40);
    },
    (f) => {
      f.context.GITHUB_RUN_ID = '654321';
    },
    (f) => {
      f.artifacts.pop();
      f.responses.get(`${prefix}/runs/123456/artifacts?per_page=100`).total_count--;
    },
    (f) => {
      f.artifacts.push(f.artifacts[0]);
      f.responses.get(`${prefix}/runs/123456/artifacts?per_page=100`).total_count++;
    },
    (f) => {
      f.responses.get(`${prefix}/runs/123456/artifacts?per_page=100`).total_count++;
    },
    (f) => {
      f.artifacts[0].expired = true;
    },
    (f) => {
      f.artifacts[0].digest = `sha256:${'0'.repeat(64)}`;
    },
    (f) => {
      f.artifacts[0].workflow_run.repository_id = 1;
    },
    (f) => {
      f.artifacts[0].created_at = '2026-10-31T00:00:03Z';
    },
    (f) => {
      f.responses.get(`${prefix}/runs/123456/attempts/1`).workflow_id = 999;
    },
    (f) => {
      f.responses.get(
        `${prefix}/runs/123456/attempts/1/jobs?per_page=100`,
      ).jobs[0].steps[1].conclusion = 'failure';
    },
    (f) => {
      f.responses.get(
        `${prefix}/runs/123456/attempts/2/jobs?per_page=100`,
      ).jobs[0].steps[0].conclusion = 'failure';
    },
    (f) => {
      f.responses.get(
        `${prefix}/runs/123456/attempts/2/jobs?per_page=100`,
      ).jobs[0].steps[2].conclusion = 'failure';
    },
    (f) => {
      f.responses.get(`${prefix}/runs/123456/attempts/2/jobs?per_page=100`).jobs[1].conclusion =
        'failure';
    },
    (f) => {
      f.responses.get(
        `${prefix}/runs/123456/attempts/2/jobs?per_page=100`,
      ).jobs[1].steps[0].conclusion = 'failure';
    },
  ];
  for (const mutate of cases) {
    const f = fixture();
    mutate(f);
    assert.throws(() => selectReleasePayload(f.context, f));
  }
  const malformed = [
    { 'foreign.json': {} },
    { '../producer.json': {} },
    { 'producer.json': '{"schema":1,"schema":1}' },
    { 'producer.json': ' '.repeat(8193) },
    { 'completion.json': {} },
  ];
  for (const members of malformed) {
    const f = fixture(),
      bytes = zip(members);
    Object.assign(f.artifacts[0], { size_in_bytes: bytes.length, digest: sha256(bytes) });
    f.responses.set(`${prefix}/artifacts/1/zip`, bytes);
    assert.throws(() => selectReleasePayload(f.context, f));
  }
});
