# Lancelot

Lancelot is an MCP server that answers search and retrieval queries against a local LanceDB
database. It uses OpenAI embeddings for vector search when an API key is set, and plain text
matching when it is not.

It reads the database folder and never writes to it. It speaks MCP over stdio only.

## Tools

| Tool | What it does |
| --- | --- |
| `lancedb_search` | Searches a table and returns ranked hits with short snippets. |
| `lancedb_query` | Retrieves chunks for a question and returns them as one block of context, cut to a character budget. |
| `lancedb_status` | Reports the connection, the tables with row counts, and whether embeddings are available. |
| `lancedb_version` | Reports the Lancelot version, the MCP protocol version of the SDK it is built on, and what is enabled. |

### `lancedb_search`

| Parameter | Type | Required | Meaning |
| --- | --- | --- | --- |
| `query` | string | yes | The search text. |
| `limit` | number | no | Maximum hits, 1 to 200. Default: `LANCEDB_DEFAULT_LIMIT`, which is 20. |
| `searchType` | `vector`, `text` or `auto` | no | `vector` embeds the query with OpenAI. `text` matches words in the text column. `auto` (the default) uses vector search when an API key is set and text search otherwise. |
| `table` | string | no | Table to search. Default: `LANCEDB_TABLE`. |
| `textColumn` | string | no | Column holding the text. Default: `LANCEDB_TEXT_COLUMN`. |
| `vectorColumn` | string | no | Column holding the vectors. Default: `LANCEDB_VECTOR_COLUMN`. |

The reply is JSON. Its `searchType` field is the search that produced the hits, `vector` or
`text`. When that is not the search you asked for, a `note` field says why: no API key, the vector
search failed, or (in `auto`) it found nothing. For vector hits `score` is the distance, so lower is
closer. For text hits `score` is the share of query words found in the hit, so higher is better.

Text search is a case-insensitive substring match on the words of the query. It does not use a
full-text index and does not stem words.

### `lancedb_query`

| Parameter | Type | Required | Meaning |
| --- | --- | --- | --- |
| `question` | string | yes | The question to retrieve context for. |
| `contextBudget` | number | no | Maximum characters of context. Default: `LANCEDB_CONTEXT_BUDGET`, which is 8000. |
| `warmStart` | boolean | no | Retrieve a general project overview instead of answering `question`. Default: false. |
| `table` | string | no | Table to query. Default: `LANCEDB_TABLE`. |
| `limit` | number | no | Maximum chunks to retrieve, 1 to 200. Default: `LANCEDB_DEFAULT_LIMIT`. |

The reply is a Markdown block: a header (mode, search type, query), then one section per chunk with
its title, source and text. Chunks that would pass the budget are left out and the block says how
many.

### `lancedb_status`

| Parameter | Type | Required | Meaning |
| --- | --- | --- | --- |
| `verbose` | boolean | no | Include the column names of each table. Default: false. |

### `lancedb_version`

No parameters.

### Table layout

Lancelot reads the text from the text column (`text` by default). It reads `title` for the title,
and `chunkSource` or `docSource` for the source, when a row has them; this is the layout AnythingLLM
writes. Other columns come back as `metadata`. Vector search needs vectors made with the same model
as `EMBEDDING_MODEL`.

## Install

Claude Code, using the stdio form from the
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp.md):

```bash
claude mcp add --env LANCEDB_PATH=/path/to/db --env OPENAI_API_KEY=... --transport stdio lancelot -- npx -y @ayersrepair/lancelot
```

`--transport stdio` sits between the last `--env` and the server name on purpose: the CLI reads a
name that follows `--env` directly as another variable. Everything after `--` runs the server.

Leave out `--env OPENAI_API_KEY=...` for text search only.

Other MCP clients take the same command in their `mcpServers` configuration:

```json
{
  "mcpServers": {
    "lancelot": {
      "command": "npx",
      "args": ["-y", "@ayersrepair/lancelot"],
      "env": {
        "LANCEDB_PATH": "/path/to/db",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### Setup command

`lancelot-init` asks for the database folder and an OpenAI API key, and stores them for later runs.
The key goes to the operating system keychain through keytar, or to an encrypted file when keytar
is not available. Run it with `npx -p @ayersrepair/lancelot lancelot-init`. Environment variables
override what it stored.

## Environment variables

Settings come from, in order: the environment, the file written by `lancelot-init`, the defaults.
A variable that is empty or only whitespace counts as not set. MCP clients that substitute a blank
optional value pass an empty string, and Lancelot then behaves as if the variable were absent: no
OpenAI client is created, search is text only, and nothing is logged as an error.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LANCEDB_PATH` | none | The LanceDB database folder. Required for the tools to work. It must exist; Lancelot does not create it. |
| `LANCEDB_TABLE` | `documents` | Table used when a call names none. |
| `LANCEDB_TEXT_COLUMN` | `text` | Column holding the text. |
| `LANCEDB_VECTOR_COLUMN` | `vector` | Column holding the vectors. |
| `LANCEDB_DEFAULT_LIMIT` | `20` | Hits returned when a call sets no `limit`. |
| `LANCEDB_CONTEXT_BUDGET` | `8000` | Characters of context `lancedb_query` returns when a call sets no `contextBudget`. |
| `OPENAI_API_KEY` | none | Enables vector search. When unset, the credential store is checked next. |
| `EMBEDDING_MODEL` | `text-embedding-ada-002` | The OpenAI model used to embed queries. |
| `EMBEDDING_DIMENSIONS` | `1536` | Reported by `lancedb_status`. It is not sent to OpenAI. |
| `LANCELOT_LOG_LEVEL` | `info` | One of `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`. |

## Standard output

The [MCP stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio.md)
says the server writes only valid MCP messages to stdout, and that it may write logs to stderr.
Lancelot follows that:

- Every log level goes to stderr. The logger has one transport, a winston Console transport with
  all seven levels listed in `stderrLevels`.
- The server entry point points `console.log`, `console.info` and `console.debug` at stderr, so
  a library that prints does not corrupt the stream.
- The server reads stdin until the client closes it, then exits.

`lancelot-init` is the one command that writes to stdout. It talks to a person at a terminal and
is never started as a server.

## Read-only

The four tools open a table and query it. No code in `src` creates a table, adds, updates or
deletes rows, or builds an index, and the server does not create the database folder if the path is
wrong. `tests/readonly.test.ts` scans the source for those calls.

Lancelot keeps its own settings and credentials in the per-user configuration directory, never in
the database folder.

## Development

```bash
npm ci
npm run check    # typecheck, lint, test, build
```

Node 20 or later. See `CONTRIBUTING.md`.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.

Published by Ayers Electronics.
