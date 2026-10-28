// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/** MCP tool names, as clients see them. */
export const TOOL_NAMES = {
  SEARCH: 'lancedb_search',
  QUERY: 'lancedb_query',
  STATUS: 'lancedb_status',
  VERSION: 'lancedb_version',
} as const;

/** Values for the `searchType` argument of lancedb_search. */
export const SEARCH_TYPES = ['vector', 'text', 'auto'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const LANCEDB_DEFAULTS = {
  TABLE: 'documents',
  TEXT_COLUMN: 'text',
  VECTOR_COLUMN: 'vector',
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 200,
  /** Characters of context lancedb_query returns. */
  CONTEXT_BUDGET: 8000,
  /** Characters of each hit lancedb_search returns. */
  SNIPPET_LENGTH: 500,
} as const;

export const EMBEDDING_DEFAULTS = {
  PROVIDER: 'openai',
  MODEL: 'text-embedding-ada-002',
  DIMENSIONS: 1536,
} as const;

export const MISC = {
  SERVICE_NAME: 'lancelot',
  VENDOR_NAME: 'Ayers Electronics',
  PACKAGE_NAME: '@ayersrepair/lancelot',
  DEFAULT_VERSION: '0.0.0',
  UNKNOWN_ERROR: 'Unknown error',
  KEYTAR_BACKEND: 'keytar',
  CONF_BACKEND: 'conf',
  CREDENTIALS_CONFIG_NAME: 'credentials',
  CREDENTIALS_META_CONFIG_NAME: 'credentials-meta',
  DEFAULT_HOSTNAME: 'localhost',
  DEFAULT_USERNAME: 'user',
} as const;

export const ERROR_MESSAGES = {
  TOOL_NOT_FOUND: 'Tool not found: ',
  INVALID_ARGUMENTS: 'Invalid arguments: ',
  LANCEDB_NOT_INITIALIZED: 'LanceDB service not initialized',
  LANCEDB_NOT_CONFIGURED: 'LanceDB path not configured',
  LANCEDB_NOT_CONNECTED: 'LanceDB not connected',
  LANCEDB_CONNECTION_FAILED: 'Failed to connect to LanceDB',
  LANCEDB_PATH_MISSING: 'LanceDB path does not exist: ',
  NO_TABLE: 'No table specified and no default table configured',
} as const;

export const CREDENTIALS_LOG_MESSAGES = {
  KEYTAR_LOADED: 'Credential store: keytar loaded',
  KEYTAR_NOT_AVAILABLE: 'Credential store: keytar not available, using encrypted config file',
} as const;

/** The HTTP transport: the local server (`--http`) and the Lambda handler. */
export const HTTP_DEFAULTS = {
  PORT: 3000,
  /** Loopback only. The spec says a local server should not bind all interfaces. */
  HOST: '127.0.0.1',
  /** The MCP endpoint path of the local server. */
  PATH: '/mcp',
  /** Largest request body, in bytes. Every Lancelot request is a few hundred bytes. */
  MAX_BODY_BYTES: 64 * 1024,
} as const;

/** Environment variables of the HTTP transport. Lists are comma separated. */
export const HTTP_ENV = {
  ALLOWED_ORIGINS: 'LANCELOT_ALLOWED_ORIGINS',
  ALLOWED_HOSTS: 'LANCELOT_ALLOWED_HOSTS',
  /** Lambda only: the path the endpoint is served under, such as /lancelot. */
  BASE_PATH: 'LANCELOT_BASE_PATH',
} as const;

/** What lancelot-index reads and writes. */
export const INDEX_DEFAULTS = {
  /** Characters per chunk. A chunk ends at a paragraph boundary at or before this. */
  CHUNK_SIZE: 1200,
  EXTENSIONS: ['.md', '.txt', '.html'],
} as const;
