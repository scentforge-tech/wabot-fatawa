import { draftAnswer } from '../services/gemini.service';
import type { ScoringResult } from './scoring';
import logger from '../config/logger';

export const FLAG_FOR_MANUAL_REVIEW = 'FLAG_FOR_SHAIKH_MANUAL_REVIEW';

export interface DraftOutput {
  text: string;
  type: 'DIRECT' | 'LIKELY_MATCH' | 'FLAG_FOR_MANUAL_REVIEW';
  compositeScore: number;
}

/**
 * Gate the answer drafting process based on composite score tier.
 *
 * HIGH   (>= 0.85): Calls Gemini with direct-answer prompt using Shaikh's wording
 * MEDIUM (0.60-0.84): Calls Gemini with disclaimer-prefixed prompt
 * LOW    (< 0.60):  Returns the FLAG sentinel without calling Gemini
 */
export async function generateDraft(
  userQuestion: string,
  scoring: ScoringResult,
): Promise<DraftOutput> {
  const { compositeScore, tier, allMatches } = scoring;

  logger.info(
    {
      tier,
      compositeScore: compositeScore.toFixed(3),
      matchCount: allMatches.length,
      breakdown: scoring.breakdown,
    },
    'Generating draft answer',
  );

  if (tier === 'LOW') {
    logger.info('Score below 0.60 — flagging for manual Shaikh review');
    return {
      text: FLAG_FOR_MANUAL_REVIEW,
      type: 'FLAG_FOR_MANUAL_REVIEW',
      compositeScore,
    };
  }

  try {
    const result = await draftAnswer(userQuestion, allMatches, compositeScore);

    if (result.type === 'FLAG_FOR_MANUAL_REVIEW') {
      return { text: FLAG_FOR_MANUAL_REVIEW, type: 'FLAG_FOR_MANUAL_REVIEW', compositeScore };
    }

    return {
      text: result.answer,
      type: result.type,
      compositeScore,
    };
  } catch (err) {
    logger.error({ err }, 'Draft generation threw an exception — flagging for manual review');
    return {
      text: FLAG_FOR_MANUAL_REVIEW,
      type: 'FLAG_FOR_MANUAL_REVIEW',
      compositeScore,
    };
  }
}
