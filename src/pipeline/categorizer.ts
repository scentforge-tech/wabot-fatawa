import { categorizeBatch } from '../services/gemini.service';
import type { RawRecord, CategorizedRecord } from '../services/gemini.service';
import logger from '../config/logger';

export type { RawRecord, CategorizedRecord };

/**
 * Categorizes raw Q&A records into Hajj/Umrah sub-topics using Gemini 1.5 Pro.
 * Handles chunking, parse errors, and retry logic internally.
 *
 * @param records  - Raw ingested records
 * @param dryRun   - If true, assigns a placeholder category without API calls
 */
export async function categorize(
  records: RawRecord[],
  dryRun: boolean = false,
): Promise<CategorizedRecord[]> {
  if (records.length === 0) {
    logger.warn('Categorizer received 0 records — nothing to do');
    return [];
  }

  if (dryRun) {
    logger.info('[DRY RUN] Skipping Gemini categorization');
    return records.map((r) => ({ ...r, category: 'DRY_RUN_PLACEHOLDER' }));
  }

  logger.info({ count: records.length }, 'Starting Gemini categorization');
  const categorized = await categorizeBatch(records);
  logger.info(
    { inputCount: records.length, outputCount: categorized.length },
    'Categorization complete',
  );

  // Log category distribution
  const distribution = categorized.reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] ?? 0) + 1;
    return acc;
  }, {});
  logger.debug({ distribution }, 'Category distribution');

  return categorized;
}
