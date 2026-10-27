# CLAUDE.md

Guidance for Claude Code and other agents working in this repository.

## What this is

`@ayersrepair/lancelot`: an MCP server that searches a local LanceDB database, over stdio and,
with `--http`, over stateless Streamable HTTP (also a Lambda handler, `src/lambda.ts`). Four
tools (`lancedb_search`, `lancedb_query`, `lancedb_status`, `lancedb_version`). No dashboard, no
other transport. `lancelot-index` builds the table the server reads.

## Commands

    npm ci
    npm run check                         # typecheck, lint, test, build: what CI runs
    bash scripts/identity-gate.sh         # identity rules
    bash scripts/identity-gate.sh --self-test
    node scripts/check-headers.mjs        # source headers

## Identity: hard law, enforced by CI

- Copyright holder: Ayers Electronics Inc. No year in any copyright line, ever.
- Publisher: Ayers Electronics, on every metadata surface and in the README footer.
- Author credit: Zachariah Ayers, in the root `package.json` `author` field only. No author line
  in source files.
- The company name "Ayers Software Repair" appears on no package metadata.
- The GitHub organization handle appears in `package.json` only on `repository.url`,
  `bugs.url`, `homepage` and `mcpName` (the MCP Registry requires `io.github.<organization>/<server>`).
- None of the legacy names and no personal mail address anywhere in the tree. The exact pattern
  lives in `scripts/identity-gate.sh` and is not repeated here, because a check that finds prose
  finds itself.
- Every `.ts`, `.mjs` and `.js` file opens with these two lines (after a shebang, if any):

      // Copyright Ayers Electronics Inc. All rights reserved.
      // SPDX-License-Identifier: Apache-2.0

- No emoji anywhere. No attribution to an AI tool in commits. Commits are Conventional Commits
  with `Signed-off-by`.

## The stdout rule

stdout belongs to the MCP transport. The server MUST NOT write anything to it that is not a valid
MCP message (MCP stdio transport specification). HTTP mode keeps the same rule. So:

- Log only through `LoggerService`. Its one transport sends all seven winston levels to stderr.
- Never call `console.log`, `console.info`, `console.debug` or `process.stdout.write` in code the
  server runs. `lancelot-init` and `lancelot-index` are the exceptions: they are commands for a
  person at a terminal, not servers.
- Do not add a logger transport, or a dependency that prints to stdout.

`tests/stdio.test.ts` holds this.

## Read-only rule

Nothing the server runs creates, adds, updates or deletes anything in the LanceDB database, or
builds an index. Only `src/services/lancedb-service.ts` imports `@lancedb/lancedb` there. The one
writer is `src/bin/lancelot-index.ts`, which no other file imports. `tests/readonly.test.ts` holds
this and excludes only that file.

## Layout

- `src/bin/lancelot.ts`: the server entry (stdio, or `--http`). `src/bin/lancelot-init.ts`: setup
  command. `src/bin/lancelot-index.ts`: builds a table from a folder of documents.
- `src/lambda.ts`: the API Gateway HTTP API (payload 2.0) handler. `Dockerfile`: the Lambda image.
- `src/core/`: the MCP server (`createServer`), the HTTP handler (`http.ts`), command-line
  options (`cli.ts`), the shared service setup (`runtime.ts`), the tool registry, the tool base
  class.
- `src/tools/`: one file per tool, and `retrieve.ts` (vector search with text fallback).
- `src/services/`: config, credentials, embeddings, LanceDB, logger, text filter, document chunker.
- `src/config/constants.ts`: every name and default. Read from here, do not repeat a literal.

Each tool has a zod schema that checks arguments and a JSON schema clients see.
`tests/tools.test.ts` keeps their properties and required lists equal.

## Settings

Environment, then the file `lancelot-init` wrote, then defaults. A blank variable counts as
unset (`OPENAI_API_KEY=""` means text search).
