import { batchUpsertFataawa } from '../services/firestore.service';
import type { DeduplicatedRecord } from './deduplicator';
import logger from '../config/logger';

/**
 * Calculate the initial confidence score for a record.
 *
 * Formula: confidence = min(1.0, 0.70 + 0.30 * log10(frequency + 1))
 *
 * Intuition:
 *  - A question asked once starts at 0.70 (verified but infrequent)
 *  - A question asked 10x approaches 0.97
 *  - A question asked 100x caps at 1.0
 *  - Historical data from the Shaikh is always high-confidence by default
 */
function calculateConfidenceScore(frequencyCount: number): number {
  const score = 0.7 + 0.3 * Math.log10(frequencyCount + 1);
  return Math.min(1.0, Math.max(0.0, score));
}

/**
 * Seeds the Supabase database with deduped, categorized, embedded records.
 *
 * @param records - Fully processed records from the deduplicator
 * @param dryRun  - If true, print records to console without writing to DB
 */
export async function seedDatabase(
  records: DeduplicatedRecord[],
  dryRun: boolean = false,
): Promise<void> {
  if (records.length === 0) {
    logger.warn('Seeder received 0 records — nothing to insert');
    return;
  }

  // Attach confidence scores
  const fataawa = records.map((r) => ({
    category: r.category,
    raw_question: r.raw_question,
    shaikh_answer: r.shaikh_answer,
    embedding: r.embedding,
    historical_frequency_count: r.historical_frequency_count,
    confidence_score: calculateConfidenceScore(r.historical_frequency_count),
  }));

  if (dryRun) {
    logger.info('[DRY RUN] Would insert the following records:');
    fataawa.forEach((f, i) => {
      console.log(`\n[${i + 1}/${fataawa.length}]`);
      console.log(`  Category:    ${f.category}`);
      console.log(`  Question:    ${f.raw_question.slice(0, 100)}...`);
      console.log(`  Frequency:   ${f.historical_frequency_count}`);
      console.log(`  Confidence:  ${f.confidence_score.toFixed(3)}`);
      console.log(`  Embedding:   [${f.embedding.length} dimensions]`);
    });
    return;
  }

  logger.info({ count: fataawa.length }, 'Seeding database');
  await batchUpsertFataawa(fataawa);
  logger.info({ count: fataawa.length }, '✅  Database seeding complete');
}
