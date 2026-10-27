# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/).

## 0.3.0

### Added

- HTTP mode: `lancelot --http [port]` serves the Streamable HTTP transport of MCP 2025-06-18,
  stateless, at `/mcp`, bound to 127.0.0.1 unless `--host` says otherwise. `LANCELOT_ALLOWED_ORIGINS`
  and `LANCELOT_ALLOWED_HOSTS` set the Origin and Host allow lists. A foreign Origin is 403, GET
  and DELETE are 405, a body over 64 KB is 413. Without `--http` the server is stdio as before.
- `dist/lambda.js` exports `handler(event)` for an API Gateway HTTP API (payload format 2.0), with
  `LANCELOT_BASE_PATH` for the path it is served under, and a `Dockerfile` for the Lambda Node.js 24
  arm64 base image. CI builds the image.
- `lancelot-index <folder> <dbPath> [--table documents]`: builds the table the server reads from
  `.md`, `.txt` and `.html` files, in chunks of about 1,200 characters.
- `createServer` and `createHttpHandler` are exported from the package.

### Changed

- `lancedb_version` reports the transport it is running on, `stdio` or `http`.
- A row's `path` column is read as its source when it has no `chunkSource` or `docSource`.
- `tests/readonly.test.ts` allows writes in `src/bin/lancelot-index.ts` only.

## 0.2.0

A clean-room release under the new name and owner.

### Added

- Registry metadata: `mcpName` in `package.json`, `server.json` for the official MCP Registry and
  `glama.json`, with install links for VS Code and Cursor in the README.
- Tests for the constants, the tool registry and tool input schemas, the logger and server
  output, the API key and settings, and the read-only rule.
- CI on Node 20 and 24: install, identity gate, header check, typecheck, lint, tests, build and a
  pack dry run.

### Changed

- The package is `@ayersrepair/lancelot`, licensed Apache-2.0, published by Ayers Electronics.
- `lancedb_search` and `lancedb_query` report the search that ran. A `note` field says why when it
  was not the one asked for.
- `lancedb_version` reports the protocol version of the MCP SDK instead of a fixed string.
- Text search now filters rows for the words of the query. It used to return the first rows of the
  table.
- Vector search uses the configured vector column. It used to ignore it.
- `LANCEDB_DEFAULT_LIMIT` and `LANCEDB_CONTEXT_BUDGET` apply to tool calls that set no value.
- Environment variables override the file written by `lancelot-init`. They used to apply only
  before that file existed.
- A blank environment variable, such as `OPENAI_API_KEY=""`, counts as not set.
- The log level variable is `LANCELOT_LOG_LEVEL`.
- Tool arguments are checked with zod. A wrong type is an MCP invalid-params error.

### Fixed

- Standard output carries MCP messages only. Every log level goes to stderr, and no code calls
  `console.log`.
- `src/config/constants.ts` is back in the repository. The old ignore rule `config/` matched
  `src/config`, and the file was missing from the tree.
- The server reads its version from the package, from the right folder.
- The server exits when the client closes stdin.
- Status reports the real column names of each table.
- The server no longer creates a database folder for a mistyped `LANCEDB_PATH`.
- keytar loads under native ESM.

### Removed

- The dashboard, its HTTP and WebSocket servers, and the `lancedb_dashboard` tool.
- Conversation memory and monitoring, which only the dashboard used.
- The setup splash screen and the dependencies behind it.
- The decorator-based tool registration and its `reflect-metadata` dependency.
- Dependencies: express, cors, socket.io, open, nanoid, reflect-metadata, oh-my-logo and dotenv.
- CommonJS output. The package is ESM only.
