# Lancelot release

The owner performs external submissions and settings changes. Agents prepare code, checks,
artifacts and forms, then inspect the results. Do not substitute an API or CLI write for an
owner-operated Publish, Submit, Save, tag push or workflow dispatch.

## Prepare

1. Choose a new version. An npm version cannot be overwritten. The current source contains
   unreleased changes; do not publish it again as 0.3.1.
2. Update `package.json`, `package-lock.json`, `server.json` (both version fields), the pinned
   VS Code/Cursor install links in README, and CHANGELOG. Keep the npm scope
   `@ayerselectronics` and MCP identity `io.github.ayers-software-repair/lancelot`.
3. Run `npm run check`, `npm audit --omit=dev`, `bash scripts/identity-gate.sh --self-test`,
   `bash scripts/identity-gate.sh` and `node scripts/check-headers.mjs`.
4. Inspect `npm pack --dry-run`. Confirm the README, runtime entry points, license and notice.
   The pack step does not publish. Real stdio/database/Lambda checks are part of `npm test`;
   OpenAI requests use local fixtures and do not contact a model.
5. Prepare the exact commit for the owner's push. Read the complete CI run at that SHA:
   Node 20, Node 24 and the arm64 Lambda image must pass. A local Node 24 pass is not that proof.

## Current publication sequence

Trusted npm publication is not wired into this repository yet. `registry.yml` publishes MCP
metadata; it does **not** publish npm. Do not configure an npm trusted publisher against it
until the workflow is updated to perform and verify npm publication.

1. The owner publishes from the actual repository with `npm publish --access public`.
2. Verify the exact public npm version and integrity, and a fresh install/search.
3. The owner pushes the matching `vX.Y.Z` tag. `registry.yml` checks npm and package/registry
   version agreement, then publishes `server.json` using GitHub OIDC. Read the exact registry
   identity/version back, including the npm identifier and hosted remote.
4. Prepare tested marketplace and company-site pin updates for owner submission. Generate
   their manifests through their existing builders; preserve the package identity.
5. Verify the hosted endpoint's deployed version. The current workflow only dispatches the
   site deployment if `SITE_DISPATCH_TOKEN` exists. A logged skip is unfinished work even if
   the registry job is green. Never hand-copy the bucket or bypass the deployment workflow.
6. Refresh directory drafts and retain their submission/review IDs. The owner submits them;
   a submitted listing is not an approved listing.

Read-only inspection commands:

```bash
npm view @ayerselectronics/lancelot version dist.integrity --json
gh run list --workflow ci.yml --commit COMMIT_SHA
gh run list --workflow registry.yml --limit 5
```

## Automation still to complete

The company runbook is `ayers.repair/docs/RUNBOOK-mcp-release.md`. Coordinate its implementation
with the AssembleJS release owner: npm OIDC per package, exact workflow/environment mapping,
tested source and artifact checks, then registry, consumer adoption and hosted deployment.
The approved company GitHub App must have only the repository permissions those events need.
No downstream website change may create another package version or release tag. Account and
permission changes remain owner-operated. Do not reuse the problem-reporting App.

## Publisher migration

The replacement `@ayerselectronics/lancelot@0.3.1` and hosted 0.3.1 are verified. A fresh public
registry read on 28 October 2026 still lists `@ayersrepair/lancelot` versions `0.0.0-stage` and
`0.3.0`; removal is not complete. The owner must finish it and the result must be read back.
Do not mark a security-key authorization as proof of deletion. Existing old-scope lockfiles
will stop resolving after unpublication; the replacement scope and consumer references must
remain available.
