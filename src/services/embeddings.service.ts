import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import logger from '../config/logger';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// Google's text-embedding-004 produces 768-dimensional vectors
const EMBEDDING_MODEL = 'text-embedding-004';
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Generate a single embedding vector for a text string.
 * Uses Gemini text-embedding-004 (768 dims, multilingual).
 */
export async function embedText(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(text.trim());
  return result.embedding.values;
}

/**
 * Batch-embed an array of strings.
 * Processes in chunks with exponential-backoff retry on rate-limit errors.
 *
 * @param texts     - Array of strings to embed
 * @param batchSize - Chunk size per API call (Gemini supports up to 100 per batch call)
 */
export async function embedBatch(
  texts: string[],
  batchSize: number = 50,
): Promise<number[][]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
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
        // Use batchEmbedContents for efficiency
        const requests = chunk.map((t) => ({ content: { parts: [{ text: t.trim() }], role: 'user' } }));
        const batchResult = await model.batchEmbedContents({ requests });
        const embeddings = batchResult.embeddings.map((e) => e.values);
        results.push(...embeddings);
        break;
      } catch (err: unknown) {
        attempt++;
        const isRateLimit =
          err instanceof Error && (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED'));
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
