// All $vectorSearch stages are built here (Atlas Automated Embedding: the server embeds the
// query text, so we pass a plain string). Documented shape:
// https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/
import type { Document } from 'mongodb';

export type VectorSearchOptions = {
  index: string;
  path: string;
  text: string;
  limit: number;
  /** MQL pre-filter; fields must be declared as `filter` fields in the index. */
  filter?: Document;
};

export function vectorSearchStage({ index, path, text, limit, filter }: VectorSearchOptions): Document {
  return {
    $vectorSearch: {
      index,
      path,
      query: text,
      numCandidates: Math.max(50, limit * 10),
      limit,
      ...(filter ? { filter } : {}),
    },
  };
}
