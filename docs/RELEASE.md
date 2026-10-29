# Lancelot release

The owner retains account-creation submissions and final directory submissions. Agents may
prepare and push authorized source changes, run hosted checks and use approved deployment
workflows. Product releases, new tags and account/permission changes still require their
applicable explicit authorization. Do not use an API or CLI to bypass an owner-operated
submission or authentication step.

## Prepare

1. Choose a new version. An npm version cannot be overwritten. The current source contains
   unreleased changes; do not publish it again as 0.3.1.
2. Update `package.json`, `package-lock.json`, `server.json` (both version fields), and CHANGELOG. Keep public installation commands and editor links versionless;
   exact versions belong in release metadata and tested consumer manifests. Keep the npm scope
   `@ayerselectronics` and MCP identity `io.github.ayers-software-repair/lancelot`.
3. Run `npm run check`, `npm audit --omit=dev`, `bash scripts/identity-gate.sh --self-test`,
   `bash scripts/identity-gate.sh` and `node scripts/check-headers.mjs`.
4. Inspect `npm pack --dry-run`. Confirm the README, runtime entry points, license and notice.
   The pack step does not publish. Real stdio/database/Lambda checks are part of `npm test`;
   OpenAI requests use local fixtures and do not contact a model.
5. Push the authorized source commit for hosted checks. Read the complete CI run at that SHA:
   Node 20, Node 24 and the arm64 Lambda image must pass. A local Node 24 pass is not that proof.

## Tag-driven publication

`registry.yml` publishes npm through OIDC, verifies the public archive, then publishes MCP
metadata. It runs on an owner-approved `vX.Y.Z` tag. It does not create commits, pull requests,
versions or tags, so downstream website updates cannot recursively publish another version.

Before the first trusted release, the owner configures the existing npm package:

| Field             | Value                        |
| ----------------- | ---------------------------- |
| Package           | `@ayerselectronics/lancelot` |
| GitHub owner      | `ayers-software-repair`      |
| Repository        | `lancelot`                   |
| Workflow filename | `registry.yml`               |
| Environment       | `release`                    |
| Allowed action    | Direct `npm publish`         |

Use the actual package settings, not a scope-wide assumption. The owner reviews and saves the
mapping and any GitHub `release` environment protections; agents do not submit those settings.
Do not reuse the problem-reporting App or add a long-lived npm token. Read existing publisher
connections before changing them. The first successful trusted publish must occur within two
days of creating its configuration, according to [npm's current rules](https://docs.npmjs.com/trusted-publishers/).

1. Prepare a new version with all metadata matching and successful **main-push** `ci.yml` at
   that exact source. The release refuses PR-only, failed, incomplete or other-commit CI.
2. The owner authorizes the matching tag. The workflow checks its event ref, checked-out
   commit, main ancestry, package, lockfile and registry versions before installing anything.
3. On a hosted Node24 runner, build and pack once. The workflow publishes that inspected
   archive with provenance. A prerelease uses npm's `next` tag; a stable version uses `latest`.
4. Read back npm's package identity and SHA512 archive integrity. An existing version is
   reusable only when those bytes and identities agree. A registry outage is not permission
   to publish, and a different existing archive is never overwritten.
5. Only then does the MCP Registry job publish `server.json` with GitHub OIDC and verify the
   exact server identity, version, npm transport and hosted remote through its exact-version API.
6. Prepare and push tested marketplace/site adoption. Read back the hosted version separately:
   `SITE_DISPATCH_TOKEN` still controls the existing optional site dispatch. A logged skip is
   unfinished deployment, even if registry publication succeeds. Never hand-copy the bucket.
7. Refresh directory drafts with the exact artifact and evidence. The owner submits them;
   directory acceptance is separate from submission and source validation.

The workflow and npm mapping use **the same filename**, even though its historical name is
`registry.yml`. npm requires Node22.14+ and npm11.5.1+; this workflow uses Node24 and an npm11
version supporting the trust-management commands. No product version is changed by installing
or editing this workflow. Never publish the unreleased changes again as 0.3.1.

## Retry without creating another release

A failed npm or registry step keeps the immutable tag. Re-run its failed jobs after fixing the
external cause. For a manual dispatch, select the **tag ref**, not main:

```bash
gh workflow run registry.yml --ref vX.Y.Z -f tag=vX.Y.Z
```

A dispatch from main with a tag input is refused before publication: provenance must identify
the source actually checked out. The owner authorizes dispatches that publish. An already
published matching archive is verified and skipped, then metadata/deployment can continue.
Do not move a released tag or change a published archive to repair a retry.

Read-only checks:

```bash
npm view @ayerselectronics/lancelot version dist.integrity --json
gh run list --workflow ci.yml --commit COMMIT_SHA --event push --branch main
gh run list --workflow registry.yml --limit 5
```

`node --test scripts/release.test.mjs` checks the release refusals without authentication,
publication or a provider call. Hosted `ci.yml` runs it on both supported Node versions.

## Consumer automation still to complete

The company runbook is `ayers.repair/docs/RUNBOOK-mcp-release.md`. The tag-driven npm/registry
source does not replace the missing scoped company release/adoption App. Its account setup
and permissions remain owner-operated. Consumer changes must use the shared generators and
verify the exact published identity/integrity before existing deployment workflows run.
A website push must not generate a package version or release tag.

## Publisher migration

The replacement `@ayerselectronics/lancelot@0.3.1` and hosted 0.3.1 are verified. A fresh public
registry read on 29 October 2026 still lists `@ayersrepair/lancelot` versions `0.0.0-stage` and
`0.3.0`; removal is not complete. The owner must finish it and the result must be read back.
Do not mark a security-key authorization as proof of deletion. Existing old-scope lockfiles
will stop resolving after unpublication; the replacement scope and consumer references must
remain available.
