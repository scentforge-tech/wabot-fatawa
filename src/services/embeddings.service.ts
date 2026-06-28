import OpenAI from 'openai';
import { env } from '../config/env';
import logger from '../config/logger';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

export { EMBEDDING_DIMENSIONS };

/**
 * Generate a single embedding vector for a text string.
 */
export async function embedText(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.trim(),
  });
  return response.data[0].embedding;
}

/**
 * Batch-embed an array of strings with concurrency control and
 * exponential-backoff retry on rate-limit errors (429).
 *
 * @param texts      - Array of strings to embed
 * @param batchSize  - How many to send per API call (max 2048 per OpenAI docs)
 */
export async function embedBatch(
  texts: string[],
  batchSize: number = 100,
): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const chunk = texts.slice(i, i + batchSize);
    logger.debug(
      { batchStart: i, batchEnd: i + chunk.length, total: texts.length },
      'Embedding batch',
    );

    let attempt = 0;
    while (true) {
      try {
        const response = await openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: chunk.map((t) => t.trim()),
        });
        const embeddings = response.data
          .sort((a, b) => a.index - b.index)
          .map((d) => d.embedding);
        results.push(...embeddings);
        break;
      } catch (err: unknown) {
        attempt++;
        const isRateLimit =
          err instanceof Error && err.message.includes('429');
        if (!isRateLimit || attempt > 5) throw err;
        const delay = Math.min(1000 * 2 ** attempt, 32000);
        logger.warn({ attempt, delay }, 'Rate limited on embeddings — retrying');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  return results;
}

/**
 * Compute the cosine similarity between two equal-length vectors.
 * Returns a value between -1.0 and 1.0.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
