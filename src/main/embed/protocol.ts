/** Message contract between the main process and the embedding utility process. */

export const EMBEDDING_DIM = 384
export const MODEL_ID = 'bge-small-en-v1.5'

/**
 * BGE models are trained asymmetrically: the *query* side wants this instruction
 * prefix, the passage side wants none. Applying it to both (or neither) measurably
 * degrades retrieval, so it lives here as the single source of truth.
 */
export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '

export type ToWorker =
  | { type: 'embed'; id: number; texts: string[] }
  | { type: 'shutdown' }

export type FromWorker =
  | { type: 'ready'; dimensions: number }
  | { type: 'error'; id: number | null; message: string }
  /** `vectors` is a flat Float32Array of texts.length * EMBEDDING_DIM. */
  | { type: 'result'; id: number; vectors: Float32Array; count: number }
