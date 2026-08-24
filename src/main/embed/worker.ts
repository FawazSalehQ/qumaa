/**
 * Embedding utility process. Owns the ONNX model and does all inference, so a
 * 500-file bulk import never blocks the main process or freezes the UI.
 *
 * Forked by src/main/embed/client.ts. Model directory arrives via CV_FILTER_MODEL_DIR
 * because Electron's `app` API is not available inside a utilityProcess.
 */
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'
import { EMBEDDING_DIM, MODEL_ID, type FromWorker, type ToWorker } from './protocol.js'

const modelDir = process.env.CV_FILTER_MODEL_DIR
if (!modelDir) throw new Error('CV_FILTER_MODEL_DIR not set')

// Hard-offline. Without this, transformers.js silently falls back to the HF hub
// on any cache miss, which would break the app's core promise.
env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = modelDir

function send(msg: FromWorker): void {
  process.parentPort.postMessage(msg)
}

let extractor: FeatureExtractionPipeline

/** Texts longer than the model's 512-token window are truncated by the tokenizer;
 *  chunking upstream keeps us well under that. */
async function embed(texts: string[]): Promise<Float32Array> {
  const out = await extractor(texts, { pooling: 'mean', normalize: true })
  // `out.data` is a flat Float32Array of [texts.length, EMBEDDING_DIM].
  return new Float32Array(out.data as Float32Array)
}

async function main(): Promise<void> {
  extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' })
  send({ type: 'ready', dimensions: EMBEDDING_DIM })

  process.parentPort.on('message', (e) => {
    const msg = e.data as ToWorker
    if (msg.type === 'shutdown') {
      process.exit(0)
    }
    if (msg.type === 'embed') {
      // Serialised implicitly: each handler awaits before the next runs to
      // completion is not guaranteed, but ORT sessions are re-entrant-safe here.
      embed(msg.texts)
        .then((vectors) => send({ type: 'result', id: msg.id, vectors, count: msg.texts.length }))
        .catch((err: unknown) =>
          send({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
        )
    }
  })
}

main().catch((err: unknown) => {
  send({ type: 'error', id: null, message: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})
