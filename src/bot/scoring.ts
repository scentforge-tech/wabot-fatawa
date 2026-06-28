import type { FatwaMatch } from '../services/firestore.service';

/**
 * Composite Scoring Formula
 * ═══════════════════════════════════════════════════════════
 *
 * compositeScore = (
 *   vectorSimilarity  * 0.50 +   ← Direct semantic match weight
 *   normalizedFreq    * 0.30 +   ← Historical importance weight
 *   confidenceScore   * 0.20     ← Database record quality weight
 * )
 *
 * normalizedFreq = min(1.0, log10(historical_frequency_count + 1) / 3)
 *
 * The log10 normalization caps frequency contribution at 1000 queries
 * (log10(1000+1) / 3 ≈ 1.0), preventing extreme outliers from
 * dominating and making the system robust to "famous" questions.
 *
 * Thresholds:
 *   >= 0.85 → HIGH CONFIDENCE: draft using Shaikh's exact wording
 *   0.60–0.84 → MEDIUM CONFIDENCE: draft with verification disclaimer
 *   < 0.60  → LOW CONFIDENCE: FLAG_FOR_SHAIKH_MANUAL_REVIEW
 */

export const WEIGHT = {
  VECTOR_SIMILARITY: 0.50,
  HISTORICAL_FREQUENCY: 0.30,
  CONFIDENCE_SCORE: 0.20,
} as const;

export const THRESHOLD = {
  HIGH: 0.85,
  MEDIUM: 0.60,
} as const;

export type ScoreTier = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ScoringResult {
  compositeScore: number;
  tier: ScoreTier;
  topMatch: FatwaMatch | null;
  allMatches: FatwaMatch[];
  breakdown: {
    vectorSimilarity: number;
    normalizedFrequency: number;
    confidenceScore: number;
  };
}

/**
 * Normalize historical frequency count to [0, 1] using log10 scaling.
 */
function normalizeFrequency(count: number): number {
  return Math.min(1.0, Math.log10(count + 1) / 3);
}

/**
 * Determine score tier from a composite score value.
 */
export function scoreTier(compositeScore: number): ScoreTier {
  if (compositeScore >= THRESHOLD.HIGH) return 'HIGH';
  if (compositeScore >= THRESHOLD.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

/**
 * Compute the composite score for a set of database matches.
 * Uses the top-scoring match (by vector similarity) as the primary signal,
 * but blends frequency and confidence from a weighted average of top-3 matches
 * to reduce noise from a single outlier match.
 *
 * @param matches - Array of FatwaMatch objects from Supabase RPC (sorted by similarity desc)
 */
export function computeCompositeScore(matches: FatwaMatch[]): ScoringResult {
  if (matches.length === 0) {
    return {
      compositeScore: 0,
      tier: 'LOW',
      topMatch: null,
      allMatches: [],
      breakdown: { vectorSimilarity: 0, normalizedFrequency: 0, confidenceScore: 0 },
    };
  }

  // Top match provides the primary vector similarity signal
  const topMatch = matches[0];

  // Blend frequency and confidence across top-3 (or fewer if < 3 matches)
  const blendWindow = matches.slice(0, 3);
  const blendedFreq =
    blendWindow.reduce((sum, m) => sum + normalizeFrequency(m.historical_frequency_count), 0) /
    blendWindow.length;
  const blendedConfidence =
    blendWindow.reduce((sum, m) => sum + m.confidence_score, 0) / blendWindow.length;

  const vectorSim = topMatch.similarity;
  const compositeScore =
    vectorSim * WEIGHT.VECTOR_SIMILARITY +
    blendedFreq * WEIGHT.HISTORICAL_FREQUENCY +
    blendedConfidence * WEIGHT.CONFIDENCE_SCORE;

  return {
    compositeScore: Math.min(1.0, compositeScore),
    tier: scoreTier(compositeScore),
    topMatch,
    allMatches: matches,
    breakdown: {
      vectorSimilarity: vectorSim,
      normalizedFrequency: blendedFreq,
      confidenceScore: blendedConfidence,
    },
  };
}
