import { env } from '../config/env';
import logger from '../config/logger';

// ─── Gemini Embeddings via REST ───────────────────────────────────────────────
// Uses gemini-embedding-001 (768-dim, multilingual) — confirmed available on
// this API key via: GET /v1beta/models?key=...

const EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Generate a single 768-dim embedding vector via gemini-embedding-001.
 */
export async function embedText(text: string): Promise<number[]> {
  const url = `${GEMINI_BASE}/models/${EMBEDDING_MODEL}:embedContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text: text.trim() }] },
      outputDimensionality: 768,   // Firestore max is 2048; keep 768 for efficiency
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini embed error ${res.status}: ${err}`);
  }
  const json = await res.json() as { embedding: { values: number[] } };
  return json.embedding.values;
}

/**
 * Batch-embed an array of strings (sequential with rate-limit retry).
 */
export async function embedBatch(
  texts: string[],
  batchSize: number = 20,
): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const chunk = texts.slice(i, i + batchSize);
    logger.debug({ batchStart: i, total: texts.length }, 'Embedding batch');

    let attempt = 0;
    while (true) {
      try {
        const embeddings = await Promise.all(chunk.map((t) => embedText(t)));
        results.push(...embeddings);
        break;
      } catch (err: unknown) {
        attempt++;
        const isRateLimit =
          err instanceof Error &&
          (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED'));
        if (!isRateLimit || attempt > 5) throw err;
        const delay = Math.min(1000 * 2 ** attempt, 32000);
        logger.warn({ attempt, delay }, 'Rate limited — retrying');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  return results;
}

// ─── Cosine Similarity ────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
