// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/** Builds the SQL filter that text search sends to LanceDB. Pure, so it is tested alone. */

/** A column name as the SQL filter wants it: backticks, with inner backticks doubled. */
export const quoteColumn = (name: string): string => `\`${name.replaceAll('`', '``')}\``;

/**
 * The lowercase words of a query. Quotes, percent signs, underscores and backslashes split
 * words, so a term can be placed inside a LIKE pattern without escaping.
 */
export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[\s%_\\'"`]+/).filter(Boolean))].slice(0, 8);
}

/** The SQL filter that keeps rows whose text column holds any of the terms. */
export function textFilter(column: string, terms: string[]): string {
  return terms.map((term) => `lower(${quoteColumn(column)}) LIKE '%${term}%'`).join(' OR ');
}
