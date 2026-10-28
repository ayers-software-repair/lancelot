# Release

Replace `X.Y.Z` with the version.

1. Bump the version in `package.json`, `server.json` (`version` and `packages[0].version`) and `CHANGELOG.md`: `npm version X.Y.Z --no-git-tag-version`, then edit the other two.
2. CI green on main: `gh run list --branch main --limit 1` shows `completed success`.
3. The owner publishes to npm: `npm publish --access public`.
4. The seat tags and pushes: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. The `registry` workflow publishes `server.json` to the MCP Registry with GitHub OIDC; watch it with `gh run watch -R ayers-software-repair/lancelot`. If npm was not ready, publish npm and re-run it: `gh workflow run registry.yml -f tag=vX.Y.Z`.
6. The marketplace and website pins follow: update the version they pin to `X.Y.Z`.
7. The same `registry` run then sends `repository_dispatch` `mcp-release` (payload `ref` = the tag) to `ayers-software-repair/ayers.repair`, which redeploys the hosted endpoint at that tag. It needs the secret `SITE_DISPATCH_TOKEN` (fine-grained token on that repository, Contents: Read and write); without it the step logs a skip. Watch it: `gh run list -R ayers-software-repair/ayers.repair --workflow 'deploy mcp platform' --limit 1`.
