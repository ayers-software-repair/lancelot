// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Read-only access to a LanceDB database. This file connects, opens tables and queries them.
 * It never creates a table, adds, updates or deletes rows, or builds an index.
 * tests/readonly.test.ts holds the whole of src to that.
 */
import { existsSync } from 'node:fs';
import * as lancedb from '@lancedb/lancedb';
import type { Connection, Table } from '@lancedb/lancedb';
import type { LoggerService } from './logger.js';
import type { ConfigurationService } from './config.js';
import { ERROR_MESSAGES } from '../config/constants.js';
import { queryTerms, textFilter } from './text-query.js';

export interface SearchResult {
  text: string;
  title?: string;
  source?: string;
  /** Vector search: the distance, lower is closer. Text search: the share of query terms matched. */
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface TableInfo {
  name: string;
  rowCount: number;
  columns: string[];
}

type Row = Record<string, unknown>;

/** The most rows text search reads per query, whatever the limit asked for. */
const TEXT_SCAN_ROWS = 1000;

const asString = (value: unknown): string =>
  typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);

const hasScheme = (path: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(path);

export class LanceDBService {
  private connection?: Connection;
  private logger?: LoggerService;
  private configService: ConfigurationService;
  private dbPath: string;
  private tables = new Map<string, Table>();

  constructor(configService: ConfigurationService, logger?: LoggerService) {
    this.configService = configService;
    this.logger = logger;
    this.dbPath = configService.getConfig().lancedb.path;
  }

  async initialize(): Promise<void> {
    if (!this.dbPath) {
      throw new Error(ERROR_MESSAGES.LANCEDB_NOT_CONFIGURED);
    }
    // connect() is asked only for a folder that exists, so a typo in the path cannot create one.
    if (!hasScheme(this.dbPath) && !existsSync(this.dbPath)) {
      throw new Error(`${ERROR_MESSAGES.LANCEDB_PATH_MISSING}${this.dbPath}`);
    }

    try {
      this.connection = await lancedb.connect(this.dbPath);
      this.logger?.info('LanceDB connection established', { path: this.dbPath });
    } catch (error) {
      this.logger?.error('Failed to connect to LanceDB', { error, path: this.dbPath });
      throw new Error(
        `${ERROR_MESSAGES.LANCEDB_CONNECTION_FAILED}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getTable(tableName: string): Promise<Table> {
    if (!this.connection) {
      throw new Error(ERROR_MESSAGES.LANCEDB_NOT_CONNECTED);
    }

    const cached = this.tables.get(tableName);
    if (cached) {
      return cached;
    }

    try {
      const table = await this.connection.openTable(tableName);
      this.tables.set(tableName, table);
      return table;
    } catch (error) {
      this.logger?.error(`Failed to open table: ${tableName}`, { error });
      throw error;
    }
  }

  /** The rows nearest to an embedding. */
  async vectorSearch(
    tableName: string,
    embedding: number[],
    limit: number,
    vectorColumn?: string,
  ): Promise<SearchResult[]> {
    const table = await this.getTable(tableName);
    const column = vectorColumn ?? this.configService.getConfig().lancedb.vectorColumn;

    try {
      const rows = (await table
        .query()
        .nearestTo(embedding)
        .column(column)
        .limit(limit)
        .toArray()) as Row[];
      return rows.map((row) => this.toResult(row));
    } catch (error) {
      this.logger?.error('Vector search failed', { error, tableName });
      throw error;
    }
  }

  /**
   * Rows whose text column holds any word of the query, best match first. This is a
   * case-insensitive substring match, not a ranked full-text index.
   */
  async textSearch(
    tableName: string,
    query: string,
    limit: number,
    textColumn?: string,
  ): Promise<SearchResult[]> {
    const terms = queryTerms(query);
    if (terms.length === 0) {
      return [];
    }

    const table = await this.getTable(tableName);
    const column = textColumn ?? this.configService.getConfig().lancedb.textColumn;

    try {
      const rows = (await table
        .query()
        .where(textFilter(column, terms))
        .limit(Math.min(limit * 5, TEXT_SCAN_ROWS))
        .toArray()) as Row[];

      return rows
        .map((row) => {
          const result = this.toResult(row, column);
          const lowered = result.text.toLowerCase();
          const matched = terms.filter((term) => lowered.includes(term)).length;
          return { ...result, score: matched / terms.length };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (error) {
      this.logger?.error('Text search failed', { error, tableName });
      throw error;
    }
  }

  /** Rows from an AnythingLLM-style table: text, title, chunkSource or docSource. Others work too. */
  private toResult(row: Row, textColumn?: string): SearchResult {
    const config = this.configService.getConfig().lancedb;
    const column = textColumn ?? config.textColumn;
    const source = asString(row.chunkSource ?? row.docSource ?? 'unknown').replace(
      /^localfile:\/\//,
      '',
    );

    const skip = new Set([
      column,
      config.textColumn,
      config.vectorColumn,
      'text',
      'vector',
      'title',
      'source',
      'chunkSource',
      'docSource',
      '_distance',
      '_score',
    ]);
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!skip.has(key) && value !== undefined && value !== null) {
        metadata[key] = value;
      }
    }

    const distance = row._distance;
    const score = row._score;
    return {
      text: asString(row[column] ?? row.text ?? ''),
      title: asString(row.title ?? 'unknown'),
      source,
      score: typeof distance === 'number' ? distance : typeof score === 'number' ? score : undefined,
      metadata,
    };
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  isConnected(): boolean {
    return this.connection !== undefined;
  }

  async getStatus(): Promise<{ connected: boolean; path: string; tables: TableInfo[] }> {
    if (!this.connection) {
      return { connected: false, path: this.dbPath, tables: [] };
    }

    const tables: TableInfo[] = [];
    for (const name of await this.connection.tableNames()) {
      try {
        const table = await this.getTable(name);
        const schema = (await table.schema()) as { fields?: { name: string }[] };
        tables.push({
          name,
          rowCount: await table.countRows(),
          columns: schema.fields?.map((field) => field.name) ?? [],
        });
      } catch (error) {
        this.logger?.warn(`Failed to read table: ${name}`, { error });
      }
    }
    return { connected: true, path: this.dbPath, tables };
  }

  async close(): Promise<void> {
    this.connection?.close();
    this.connection = undefined;
    this.tables.clear();
  }
}
