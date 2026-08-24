/** Message contract between the main process and the embedding utility process. */

export const EMBEDDING_DIM = 384
export const MODEL_ID = 'multilingual-e5-small'

/**
 * e5 requires an explicit prefix on BOTH sides: "query: " for the search text and
 * "passage: " for indexed text. This differs from BGE, which prefixed only the
 * query. Getting it wrong does not error, it just quietly degrades every result,
 * so both live here as the single source of truth.
 */
export const QUERY_PREFIX = 'query: '
export const PASSAGE_PREFIX = 'passage: '

export type ToWorker =
  | { type: 'embed'; id: number; texts: string[] }
  | { type: 'shutdown' }

export type FromWorker =
  | { type: 'ready'; dimensions: number }
  | { type: 'error'; id: number | null; message: string }
  /** `vectors` is a flat Float32Array of texts.length * EMBEDDING_DIM. */
  | { type: 'result'; id: number; vectors: Float32Array; count: number }
