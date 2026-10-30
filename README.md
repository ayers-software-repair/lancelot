# Lancelot

Search your documents from any MCP-compatible assistant. Lancelot connects an agent to a local
[LanceDB](https://lancedb.com/) database and returns matching passages with their sources.

- **Local text search** works without an API key.
- **Vector search** uses OpenAI embeddings when configured, with text search as a fallback.
- **Read-only tools** retrieve documents and report database status. Indexing is a separate command.
- **Stdio and Streamable HTTP** support local clients, shared servers and AWS Lambda.

[Quickstart](#quickstart) · [Install](#install) · [Index documents](#index-your-documents) · [Tools](#tools) ·
[HTTP hosting](#http-mode) · [Privacy](#privacy)

## Quickstart

Requires **Node.js 20 or later**. First, create a local LanceDB database from your documents
(replace `./docs` with a folder containing `.md`, `.txt` or `.html` files):

```bash
npx -y --package @ayerselectronics/lancelot lancelot-index ./docs ./lancelot-db
```

This creates the `documents` table in `./lancelot-db` for local text search; no API key is needed.
Running it again **replaces that table** with the folder's current contents.

Then, from the same directory, add the server to Claude Code using that database's absolute path:

```bash
claude mcp add --env LANCEDB_PATH="$PWD/lancelot-db" --transport stdio lancelot -- npx -y @ayerselectronics/lancelot
```

Ask Claude to search your documents with `lancedb_search`. For other MCP clients, see
[Install](#install); for table options, see [Index your documents](#index-your-documents).

## Try the hosted server

Connect an MCP client to **`https://mcp.ayers.repair/lancelot`** to search the public Ayers
documentation. This hosted instance does not read your files. To search your own documents,
run the local server below.

## Install

Requires **Node.js 20 or later** and a LanceDB database folder. If you do not have a database,
[index a folder of documents](#index-your-documents) first. Use the database's absolute path in
your client configuration.

Claude Code, using the stdio form from the
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp.md):

```bash
claude mcp add --env LANCEDB_PATH=/path/to/db --transport stdio lancelot -- npx -y @ayerselectronics/lancelot
```

`--transport stdio` sits between the last `--env` and the server name on purpose: the CLI reads a
name that follows `--env` directly as another variable. Everything after `--` runs the server.

For vector search, add `--env OPENAI_API_KEY=YOUR_KEY` before `--transport`. Your table must contain
vectors created with the configured embedding model. Query text is then sent to OpenAI.

Other MCP clients take the same command in their `mcpServers` configuration:

```json
{
  "mcpServers": {
    "lancelot": {
      "command": "npx",
      "args": ["-y", "@ayerselectronics/lancelot"],
      "env": {
        "LANCEDB_PATH": "/path/to/db"
      }
    }
  }
}
```

### Install links

Open one of these in a browser or on the command line to add the server to the editor. Set
`LANCEDB_PATH` to your database folder afterwards.

- VS Code: `vscode:mcp/install?%7B%22name%22%3A%22lancelot%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40ayerselectronics%2Flancelot%22%5D%2C%22env%22%3A%7B%22LANCEDB_PATH%22%3A%22%2Fpath%2Fto%2Fdb%22%7D%7D`
- Cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=lancelot&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBheWVyc2VsZWN0cm9uaWNzL2xhbmNlbG90Il0sImVudiI6eyJMQU5DRURCX1BBVEgiOiIvcGF0aC90by9kYiJ9fQ==`

The link formats are from the
[VS Code MCP guide](https://code.visualstudio.com/api/extension-guides/ai/mcp#create-an-mcp-installation-url)
and the [Cursor install links documentation](https://cursor.com/docs/mcp/install-links.md).

### Registry

MCP Registry identity: `io.github.ayers-software-repair/lancelot`.

### Setup command

`lancelot-init` asks for the database folder and an OpenAI API key, and stores them for later runs.
The key goes to the operating system keychain through keytar, or to an encrypted file when keytar
is not available. Run it with `npx -p @ayerselectronics/lancelot lancelot-init`. Environment variables
override what it stored.

## Index your documents

`lancelot-index` builds the table the server reads from a folder of `.md`, `.txt` and `.html`
files:

```bash
npx -p @ayerselectronics/lancelot lancelot-index ./docs ./db
npx -p @ayerselectronics/lancelot lancelot-index ./docs ./db --table documents
```

**Rebuilding replaces the named table.** Keep the original documents and choose a separate
database folder for each collection you want to manage independently.

It walks the folder and its subfolders (skipping names that start with a dot), strips HTML to
text, and splits each file into chunks of about 1,200 characters on paragraph boundaries. A
paragraph longer than that is cut at a space. Each chunk becomes a row `{ id, path, title, text }`:
`id` is the relative path and chunk number, `path` is the relative path, and `title` is the first
Markdown heading of the file, or the file name. There are no vectors, so search is text search.

`--table` names the table (default `documents`). The command replaces that table if it exists, so
running it again rebuilds the table from the folder. It is the only part of the package that writes
to a database; the server never does. Point `LANCEDB_PATH` at the database folder afterwards.

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
and `chunkSource`, `docSource` or `path` for the source, when a row has them; the first two are the
layout AnythingLLM writes, and `path` is what `lancelot-index` writes. Other columns come back as `metadata`. Vector search needs vectors made with the same model
as `EMBEDDING_MODEL`.

## HTTP mode

```bash
npx -y @ayerselectronics/lancelot --http                      # http://127.0.0.1:3000/mcp
npx -y @ayerselectronics/lancelot --http 8080
npx -y @ayerselectronics/lancelot --http 8080 --host 0.0.0.0  # all interfaces
```

Without `--http` the server uses stdio. With it, the server uses MCP
[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
The SDK negotiates the protocol version with each client. `--http` takes an optional
port (default 3000). The server binds `127.0.0.1` unless `--host` names another address, as the
specification advises for a local server. The endpoint is `/mcp`; any other path is 404.

- **Origin.** The specification says the server must validate the `Origin` header. A request that
  carries an `Origin` not listed in `LANCELOT_ALLOWED_ORIGINS` gets 403. With the variable unset,
  every request that carries an `Origin` gets 403. A request with no `Origin` header is allowed; an absent header is not an authentication check; the SDK's own origin check refuses those, so Lancelot does the check
  itself.
- **Host.** `LANCELOT_ALLOWED_HOSTS` lists the `Host` header values that may call, for DNS
  rebinding protection. Left unset on a loopback bind, it defaults to `127.0.0.1:<port>`,
  `localhost:<port>` and `[::1]:<port>`. Left unset with `--host 0.0.0.0`, the Host header is not
  checked and a warning goes to stderr. A request with a Host not listed gets 403.
- **Stateless.** No session id is issued. Each POST gets its own MCP server and transport, closed
  when the response ends, and answers with one JSON object. `GET` (the optional event stream) and
  `DELETE` (ending a session) answer 405 with `Allow: POST`, which the specification permits.
- **Limits.** A body over 64 KB is 413. A body that is not JSON is 400.
- **Protocol version.** The `MCP-Protocol-Version` header is checked by the SDK: a version it does
  not support is 400, and a missing header is taken as 2025-03-26, as the specification says.

Both variables take comma-separated lists, for example
`LANCELOT_ALLOWED_ORIGINS=https://app.example,https://other.example`. HTTP mode has no
authentication; the tools are read-only, and a server open to a network should sit behind
something that has it.

### AWS Lambda

`dist/lambda.js` exports `handler(event)` for an API Gateway HTTP API with
[payload format 2.0](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html).
It turns the event into the request the SDK's transport expects and returns
`{ statusCode, headers, body }`. It reads `LANCEDB_PATH`, `LANCELOT_BASE_PATH` (the path the
endpoint is served under, such as `/lancelot`; unset serves every path) and the two allow-list
variables. The database connection is opened on the first invocation and reused on warm ones. The
function may write only to `/tmp`, where Lancelot keeps its own settings file.

The `Dockerfile` builds the
[container image](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-image.html) on the AWS
Node.js 24 base image for arm64, with the handler `dist/lambda.handler`. Build `dist` first:

```bash
docker buildx build --platform linux/arm64 --provenance=false -t lancelot-lambda .
```

## Environment variables

Settings come from, in order: the environment, the file written by `lancelot-init`, the defaults.
A variable that is empty or only whitespace counts as not set; the stored value is checked next.
Text search is used when no OpenAI key is available from either source.

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
| `LANCELOT_ALLOWED_ORIGINS` | none | HTTP mode: comma-separated `Origin` values that may call. See [HTTP mode](#http-mode). |
| `LANCELOT_ALLOWED_HOSTS` | loopback names on the port | HTTP mode: comma-separated `Host` header values that may call. |
| `LANCELOT_BASE_PATH` | any path | Lambda only: the path the endpoint is served under, such as `/lancelot`. |

## Standard output

The [MCP stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio.md)
says the server writes only valid MCP messages to stdout, and that it may write logs to stderr.
Lancelot follows that:

- Every log level goes to stderr. The logger has one transport, a winston Console transport with
  all seven levels listed in `stderrLevels`.
- The server entry point points `console.log`, `console.info` and `console.debug` at stderr, so
  a library that prints does not corrupt the stream.
- The server reads stdin until the client closes it, then exits.

HTTP mode keeps the same rule: it writes nothing to stdout either.

`lancelot-init` and `lancelot-index` write to stdout. They talk to a person at a terminal and
are never started as a server.

## Read-only

The four tools open a table and query it. No code the server runs creates a table, adds, updates or
deletes rows, or builds an index, and the server does not create the database folder if the path is
wrong. The one exception in `src` is `src/bin/lancelot-index.ts`, a separate command that builds a
table (see [Index your documents](#index-your-documents)); the server never imports it.
`tests/readonly.test.ts` scans the rest of the source for those calls, and
`tests/integration.test.ts` compares every database file before and after all four tools run.

Lancelot keeps its own settings and credentials in the per-user configuration directory, never in
the database folder.

## Privacy

Local text search runs on your machine. When an OpenAI key is available from the environment or
your saved credentials, vector search sends query text to OpenAI to compute embeddings. Database
contents are returned to the MCP client you connected; that client controls how it uses them.
The public hosted endpoint receives the queries you send to it.

[Privacy policy](https://ayers.repair/legal/lancelot/privacy.html) and
[terms](https://ayers.repair/legal/lancelot/terms.html): the full statement, including what the
hosted endpoint receives.

## Development

```bash
npm ci
npm run check    # typecheck, lint, build, unit and integration tests
```

Node 20 or later. See `CONTRIBUTING.md`.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.

Published by Ayers Electronics.
