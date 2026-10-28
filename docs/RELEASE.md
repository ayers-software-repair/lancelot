# Release

Replace `X.Y.Z` with the version.

1. Bump the version in `package.json`, `server.json` (`version` and `packages[0].version`) and `CHANGELOG.md`: `npm version X.Y.Z --no-git-tag-version`, then edit the other two.
2. CI green on main: `gh run list --branch main --limit 1` shows `completed success`.
3. The owner publishes `@ayerselectronics/lancelot` to npm: `npm publish --access public`.
4. The seat tags and pushes: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. The `registry` workflow publishes `server.json` to the MCP Registry with GitHub OIDC; watch it with `gh run watch -R ayers-software-repair/lancelot`. If npm was not ready, publish npm and re-run it: `gh workflow run registry.yml -f tag=vX.Y.Z`.
6. The marketplace and website pins follow: update the version they pin to `X.Y.Z`.
7. The same `registry` run then sends `repository_dispatch` `mcp-release` (payload `ref` = the tag) to `ayers-software-repair/ayers.repair`, which redeploys the hosted endpoint at that tag. It needs the secret `SITE_DISPATCH_TOKEN` (fine-grained token on that repository, Contents: Read and write); without it the step logs a skip. Watch it: `gh run list -R ayers-software-repair/ayers.repair --workflow 'deploy mcp platform' --limit 1`.

## Publisher migration (0.3.1)

Publish and verify `@ayerselectronics/lancelot@0.3.1` before retiring the old scope.
The GitHub repository and MCP Registry identity do not change.

1. Verify the new package installs and answers MCP initialization and tool calls.
2. Publish the v0.3.1 registry entry and verify its npm identifier.
3. Deploy the marketplace and website updates; verify their install commands use the new name.
4. Only then unpublish `@ayersrepair/lancelot`, as approved by the owner. This is irreversible;
   old install commands and lockfiles will no longer resolve from npm.
