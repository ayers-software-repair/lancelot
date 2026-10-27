// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import type { ToolContext } from '../core/tool-base.js';
import type { SearchResult } from '../services/lancedb-service.js';
import type { SearchType } from '../config/constants.js';
import { ERROR_MESSAGES } from '../config/constants.js';

export interface Retrieval {
  results: SearchResult[];
  /** The search that produced the results. */
  searchType: 'vector' | 'text';
  /** Why the search was not the one asked for, when it was not. */
  note?: string;
}

export interface RetrieveOptions {
  table: string;
  query: string;
  limit: number;
  searchType: SearchType;
  textColumn?: string;
  vectorColumn?: string;
}

/**
 * Vector search when asked for, or when "auto" and an embeddings client exists. Text search
 * otherwise, and as the fallback when the vector search cannot run or finds nothing in "auto".
 */
export async function retrieve(context: ToolContext, options: RetrieveOptions): Promise<Retrieval> {
  const { lancedb, embeddings, logger } = context;
  if (!lancedb) {
    throw new Error(ERROR_MESSAGES.LANCEDB_NOT_INITIALIZED);
  }

  let note: string | undefined;
  const wantsVector =
    options.searchType === 'vector' ||
    (options.searchType === 'auto' && embeddings?.isAvailable() === true);

  if (wantsVector) {
    const embedding = await embeddings?.generateEmbedding(options.query);
    if (embedding) {
      try {
        const results = await lancedb.vectorSearch(
          options.table,
          embedding,
          options.limit,
          options.vectorColumn,
        );
        if (results.length > 0 || options.searchType === 'vector') {
          return { results, searchType: 'vector' };
        }
        note = 'vector search found nothing; text search used';
      } catch (error) {
        logger?.warn('Vector search failed, using text search', { error });
        note = 'vector search failed; text search used';
      }
    } else {
      note = 'no embedding available (set OPENAI_API_KEY); text search used';
    }
  }

  const results = await lancedb.textSearch(
    options.table,
    options.query,
    options.limit,
    options.textColumn,
  );
  return { results, searchType: 'text', ...(note ? { note } : {}) };
}
