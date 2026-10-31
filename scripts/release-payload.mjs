// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releasePayload } from './release.mjs';

const repository = 'ayers-software-repair/lancelot';
const prefix = `repos/${repository}/actions`;
const limit = 1024 * 1024;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const decode = (bytes) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

// Same bounded in-memory archive protocol as Company's archive-observations.mjs; never extract paths.
const readZip = `import io,json,stat,sys,zipfile
data=sys.stdin.buffer.read(1048577)
assert len(data)<=1048576
with zipfile.ZipFile(io.BytesIO(data)) as z:
 members=z.infolist()
 assert 1<=len(members)<=2
 names=[m.filename for m in members]
 assert len(set(names))==len(names)
 assert set(names)<=set(['producer.json','completion.json'])
 result={}
 for m in members:
  assert not m.is_dir() and not stat.S_ISLNK(m.external_attr>>16)
  assert not (m.flag_bits & 1) and 0<m.file_size<=8192
  assert m.compress_type in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED)
  with z.open(m) as f: raw=f.read(8193)
  assert len(raw)==m.file_size and len(raw)<=8192
  def unique(pairs):
   out={}
   for k,v in pairs:
    assert k not in out
    out[k]=v
   return out
  result[m.filename]=json.loads(raw.decode('utf-8'),object_pairs_hook=unique)
 print(json.dumps(result,allow_nan=False))
`;

/** Read-only claims preparation. The receiver independently verifies provenance and all claims. */
export function selectReleasePayload(env, options) {
  try {
    return collectReleasePayload(env, options);
  } catch {
    throw new Error('Release payload preparation refused');
  }
}

function collectReleasePayload(env, { execute = execFileSync } = {}) {
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(env.GITHUB_EVENT_NAME, 'push');
  assert.match(env.GITHUB_SHA, /^[a-f0-9]{40}$/);
  assert.match(
    env.GITHUB_REF,
    /^refs\/tags\/v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/,
  );
  assert.match(env.GITHUB_RUN_ID, /^[1-9][0-9]{0,14}$/);
  assert.match(env.GITHUB_RUN_ATTEMPT, /^[1-9][0-9]{0,5}$/);
  assert.equal(typeof env.GH_TOKEN, 'string');
  assert.ok(env.GH_TOKEN.length > 0 && !/[\r\n]/.test(env.GH_TOKEN), 'read-only GH_TOKEN required');
  const runId = env.GITHUB_RUN_ID;
  const currentAttempt = Number(env.GITHUB_RUN_ATTEMPT);
  const tag = env.GITHUB_REF.slice('refs/tags/'.length);
  function get(path, binary = false) {
    let bytes;
    try {
      bytes = Buffer.from(
        execute(
          'gh',
          [
            'api',
            '--hostname',
            'github.com',
            '--method',
            'GET',
            '-H',
            'Accept: application/vnd.github+json',
            path,
          ],
          {
            env: {
              PATH: env.PATH,
              GH_HOST: 'github.com',
              GH_TOKEN: env.GH_TOKEN,
              GH_DEBUG: '',
              GH_PROMPT_DISABLED: '1',
            },
            timeout: 15000,
            maxBuffer: limit,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      );
    } catch {
      throw new Error(`GitHub receipt read failed: ${path}`);
    }
    assert.ok(bytes.length <= limit, 'receipt response exceeds limit');
    return binary ? bytes : decode(bytes);
  }
  const workflow = get(`${prefix}/workflows/registry.yml`);
  assert.ok(positive(workflow.id));
  assert.equal(workflow.path, '.github/workflows/registry.yml');
  const listing = get(`${prefix}/runs/${runId}/artifacts?per_page=100`);
  assert.ok(
    Array.isArray(listing.artifacts) &&
      listing.total_count === listing.artifacts.length &&
      listing.artifacts.length <= 100,
    'incomplete artifact listing',
  );
  const candidates = listing.artifacts.filter(
    (a) => typeof a.name === 'string' && a.name.startsWith(`lancelot-archive-${runId}-`),
  );
  assert.ok(candidates.length > 0, 'missing archive observations');
  const observations = new Map();
  for (const artifact of candidates) {
    const suffix = artifact.name.slice(`lancelot-archive-${runId}-`.length);
    assert.match(suffix, /^[1-9][0-9]{0,5}$/);
    const attempt = Number(suffix);
    assert.ok(
      attempt <= currentAttempt && !observations.has(attempt),
      'foreign or ambiguous attempt',
    );
    const run = get(`${prefix}/runs/${runId}/attempts/${attempt}`);
    assert.equal(run.id, Number(runId));
    assert.equal(run.run_attempt, attempt);
    assert.equal(run.workflow_id, workflow.id);
    assert.equal(run.path, workflow.path);
    assert.equal(run.event, 'push');
    assert.equal(run.head_sha, env.GITHUB_SHA);
    assert.equal(run.head_branch, tag);
    assert.equal(run.repository?.id, 1436325534);
    assert.equal(run.repository?.full_name, repository);
    assert.equal(run.head_repository?.id, 1436325534);
    assert.ok(
      attempt === currentAttempt
        ? run.status === 'in_progress' ||
            (run.status === 'completed' && run.conclusion === 'success')
        : run.status === 'completed' && ['success', 'failure'].includes(run.conclusion),
      'invalid attempt status',
    );
    assert.ok(
      positive(artifact.id) &&
        artifact.expired === false &&
        positive(artifact.size_in_bytes) &&
        artifact.size_in_bytes <= limit,
      'invalid archive artifact',
    );
    assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
    const origin = artifact.workflow_run;
    assert.ok(
      origin?.id === Number(runId) &&
        origin.head_sha === env.GITHUB_SHA &&
        origin.head_branch === tag &&
        origin.repository_id === 1436325534 &&
        origin.head_repository_id === 1436325534,
      'foreign artifact origin',
    );
    const page = get(`${prefix}/runs/${runId}/attempts/${attempt}/jobs?per_page=100`);
    assert.ok(
      Array.isArray(page.jobs) && page.total_count === page.jobs.length && page.jobs.length <= 100,
      'incomplete job listing',
    );
    const jobs = page.jobs.filter((j) => j.name === 'npm');
    assert.equal(jobs.length, 1, 'ambiguous npm job');
    const job = jobs[0];
    assert.equal(job.run_id, Number(runId));
    assert.equal(job.head_sha, env.GITHUB_SHA);
    assert.equal(job.status, 'completed');
    if (job.run_attempt !== undefined) assert.equal(job.run_attempt, attempt);
    function passed(name) {
      const steps = job.steps?.filter((s) => s.name === name);
      assert.ok(
        steps?.length === 1 && steps[0].status === 'completed' && steps[0].conclusion === 'success',
        `required step failed: ${name}`,
      );
      return steps[0];
    }
    const upload = passed('Retain archive observations for this attempt');
    const created = Date.parse(artifact.created_at),
      started = Date.parse(upload.started_at),
      ended = Date.parse(upload.completed_at);
    assert.ok(
      Number.isFinite(created) &&
        Number.isFinite(started) &&
        Number.isFinite(ended) &&
        started <= created &&
        created <= ended,
      'artifact upload attempt differs',
    );
    const bytes = get(`${prefix}/artifacts/${artifact.id}/zip`, true);
    assert.equal(bytes.length, artifact.size_in_bytes, 'artifact size differs');
    assert.equal(digest(bytes), artifact.digest, 'artifact digest differs');
    let members;
    try {
      members = decode(
        execute('python3', ['-I', '-c', readZip], {
          input: bytes,
          env: { PATH: env.PATH },
          timeout: 5000,
          maxBuffer: 32768,
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      );
    } catch {
      throw new Error('invalid receipt archive');
    }
    for (const [file, receipt] of Object.entries(members)) {
      const role = file === 'producer.json' ? 'producer' : 'completion';
      assert.deepEqual(
        receipt.observation,
        { role, runId, runAttempt: attempt },
        'receipt invocation differs',
      );
      assert.equal(receipt.commit, env.GITHUB_SHA);
      assert.equal(receipt.tag, tag);
      if (role === 'producer') passed('Publish the inspected archive');
      else passed('Verify public identity and archive integrity');
    }
    if (attempt === currentAttempt) {
      assert.equal(job.conclusion, 'success', 'current npm job failed');
      const registryJobs = page.jobs.filter((j) => j.name === 'publish');
      assert.ok(
        registryJobs.length === 1 &&
          registryJobs[0].run_id === Number(runId) &&
          registryJobs[0].head_sha === env.GITHUB_SHA &&
          registryJobs[0].status === 'completed' &&
          registryJobs[0].conclusion === 'success',
        'registry publication job failed',
      );
      const registrySteps = registryJobs[0].steps?.filter(
        (s) => s.name === 'Registry lists the exact server, package and remote',
      );
      assert.ok(
        registrySteps?.length === 1 &&
          registrySteps[0].status === 'completed' &&
          registrySteps[0].conclusion === 'success',
        'registry readback failed',
      );
    }
    observations.set(attempt, members);
  }
  const completion = observations.get(currentAttempt)?.['completion.json'];
  assert.ok(completion, 'current completion receipt missing');
  const producers = [...observations.values()].flatMap((m) =>
    m['producer.json'] ? [m['producer.json']] : [],
  );
  assert.equal(producers.length, 1, 'missing or ambiguous original producer');
  const producer = producers[0];
  // Validate all retained observations, including roles not selected for the payload.
  for (const members of observations.values())
    for (const receipt of Object.values(members)) {
      releasePayload(producer, {
        ...receipt,
        observation: { ...receipt.observation, role: 'completion' },
      });
    }
  return releasePayload(producer, completion);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert.equal(
      process.argv.length,
      2,
      'no release selectors accepted; use the current GitHub invocation',
    );
    process.stdout.write(JSON.stringify(selectReleasePayload(process.env)) + '\n');
  } catch {
    console.error('Release payload preparation refused');
    process.exitCode = 1;
  }
}
