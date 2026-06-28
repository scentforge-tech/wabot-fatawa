import { embedBatch, cosineSimilarity } from '../services/embeddings.service';
import type { CategorizedRecord } from '../services/gemini.service';
import logger from '../config/logger';
import { env } from '../config/env';

export interface DeduplicatedRecord extends CategorizedRecord {
  embedding: number[];
  historical_frequency_count: number;
}

/**
 * Embeds all records, clusters near-duplicates by cosine similarity,
 * and merges them into single canonical records.
 *
 * Merge strategy:
 *  - Prefer the longest raw_question as the canonical form
 *  - Prefer the longest shaikh_answer as the canonical form
 *  - Sum frequency counts across all merged duplicates
 *  - Use the centroid embedding (average) of all merged embeddings
 *
 * @param records    - Categorized records to deduplicate
 * @param threshold  - Cosine similarity above which two records are treated as duplicates
 * @param dryRun     - If true, skip embedding API calls (returns records with zero vectors)
 */
export async function deduplicateRecords(
  records: CategorizedRecord[],
  threshold: number = env.DEDUP_SIMILARITY_THRESHOLD,
  dryRun: boolean = false,
): Promise<DeduplicatedRecord[]> {
  if (records.length === 0) return [];

  logger.info({ count: records.length, threshold }, 'Starting deduplication');

  // Step 1: Generate embeddings for all questions
  const texts = records.map((r) => r.raw_question);
  let embeddings: number[][];

  if (dryRun) {
    logger.info('[DRY RUN] Skipping embedding generation — using zero vectors');
    embeddings = texts.map(() => new Array(1536).fill(0) as number[]);
  } else {
    embeddings = await embedBatch(texts);
  }

  // Step 2: Union-Find to cluster duplicates
  const parent: number[] = records.map((_, i) => i);

  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }

  function union(x: number, y: number): void {
    parent[find(x)] = find(y);
  }

  logger.debug('Computing pairwise similarities for deduplication');

  // Compare each pair — O(n²) but acceptable for seed batch sizes (<5000 records)
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const sim = dryRun ? 0 : cosineSimilarity(embeddings[i], embeddings[j]);
      if (sim >= threshold) {
        union(i, j);
      }
    }
  }

  // Step 3: Group records by their cluster root
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < records.length; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(i);
  }

  logger.info(
    {
      inputCount: records.length,
      clusterCount: clusters.size,
      reduction: records.length - clusters.size,
    },
    'Clustering complete',
  );

  // Step 4: Merge each cluster into a single canonical record
  const merged: DeduplicatedRecord[] = [];

  for (const [, indices] of clusters) {
    const clusterRecords = indices.map((i) => records[i]);
    const clusterEmbeddings = indices.map((i) => embeddings[i]);

    // Pick longest question and answer as canonical
    const canonicalQuestion = clusterRecords.reduce((a, b) =>
      b.raw_question.length > a.raw_question.length ? b : a,
    ).raw_question;

    const canonicalAnswer = clusterRecords.reduce((a, b) =>
      b.shaikh_answer.length > a.shaikh_answer.length ? b : a,
    ).shaikh_answer;

    // Use most common category in the cluster
    const categoryCounts = clusterRecords.reduce<Record<string, number>>(
      (acc, r) => {
        acc[r.category] = (acc[r.category] ?? 0) + 1;
        return acc;
      },
      {},
    );
    const canonicalCategory = Object.entries(categoryCounts).sort(
      ([, a], [, b]) => b - a,
    )[0][0];

    // Centroid embedding (average across cluster)
    const centroid = clusterEmbeddings[0].map((_, dim) => {
      const sum = clusterEmbeddings.reduce((acc, e) => acc + e[dim], 0);
      return sum / clusterEmbeddings.length;
    });

    merged.push({
      category: canonicalCategory,
      raw_question: canonicalQuestion,
      shaikh_answer: canonicalAnswer,
      source: clusterRecords[0].source,
      embedding: centroid,
      historical_frequency_count: indices.length, // cluster size = historical frequency
    });
  }

  logger.info({ mergedCount: merged.length }, 'Deduplication and merge complete');
  return merged;
}
