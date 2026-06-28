import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import { env } from '../config/env';
import logger from '../config/logger';
import type { FatwaMatch } from './firestore.service';

// ─── Client Setup ─────────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

function getModel(modelName: string = 'gemini-2.5-flash') {
  return genAI.getGenerativeModel({
    model: modelName,
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
    ],
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawRecord {
  raw_question: string;
  shaikh_answer: string;
  source?: string;
}

export interface CategorizedRecord extends RawRecord {
  category: string;
}

// ─── Phase 1: Categorization ─────────────────────────────────────────────────

const CATEGORIZATION_SYSTEM_PROMPT = `You are an expert Islamic scholar's assistant specializing in Hajj and Umrah jurisprudence (fiqh). Your task is to categorize question-answer pairs from a Shaikh's historical fatawa (religious rulings).

For each record, assign ONE category from the following list (or invent a precise sub-category if none fit):
- Ihram Violations
- Tawaf Rules
- Sa'i Rules
- Meeqat Boundaries
- Medical Conditions
- Dam (Penalty/Sacrifice)
- Permitted Actions in Ihram
- Prohibited Actions in Ihram
- Wuquf at Arafat
- Muzdalifah & Mina
- Rami (Stoning the Jamarat)
- Hajj-e-Badal (Proxy Hajj)
- Umrah Procedure
- Ziyarat (Visiting Holy Sites)
- General Islamic Rulings
- Menstruation & Ritual Purity
- Group/Family Logistics

Return ONLY a valid JSON array with no markdown wrapping. Each element must have: "category", "raw_question", "shaikh_answer".`;

/**
 * Feeds a batch of raw Q&A records to Gemini 1.5 Pro for categorization.
 * Processes in chunks of 20 to stay within context limits.
 */
export async function categorizeBatch(
  records: RawRecord[],
): Promise<CategorizedRecord[]> {
  const model = getModel();
  const results: CategorizedRecord[] = [];
  const CHUNK_SIZE = 20;

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    logger.debug(
      { chunkStart: i, chunkSize: chunk.length, total: records.length },
      'Categorizing chunk with Gemini',
    );

    const prompt = `${CATEGORIZATION_SYSTEM_PROMPT}

Here are the ${chunk.length} records to categorize:
${JSON.stringify(chunk, null, 2)}`;

    let attempt = 0;
    while (true) {
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();

        // Strip any accidental markdown code fences
        const jsonText = text.startsWith('```')
          ? text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
          : text;

        const parsed: CategorizedRecord[] = JSON.parse(jsonText);
        results.push(...parsed);
        break;
      } catch (err) {
        attempt++;
        if (attempt > 3) {
          logger.error({ err, chunkStart: i }, 'Gemini categorization failed after 3 attempts');
          // Fall back: assign 'General Islamic Rulings' to uncategorized items
          chunk.forEach((r) => results.push({ ...r, category: 'General Islamic Rulings' }));
          break;
        }
        const delay = 2000 * attempt;
        logger.warn({ attempt, delay }, 'Gemini parse error — retrying');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  return results;
}

// ─── Phase 2: Answer Drafting ─────────────────────────────────────────────────

export type DraftResult =
  | { type: 'DIRECT'; answer: string }
  | { type: 'LIKELY_MATCH'; answer: string }
  | { type: 'FLAG_FOR_MANUAL_REVIEW' };

/**
 * Conditionally drafts an answer for a live user question using the
 * Shaikh's historical wording as context, gated by composite score.
 *
 * Scoring thresholds:
 *   >= 0.85 → Direct answer using Shaikh's exact past phrasing
 *   0.60–0.84 → Drafted answer with verification disclaimer
 *   < 0.60 → FLAG_FOR_SHAIKH_MANUAL_REVIEW (no draft generated)
 */
export async function draftAnswer(
  userQuestion: string,
  matches: FatwaMatch[],
  compositeScore: number,
): Promise<DraftResult> {
  if (compositeScore < 0.60) {
    return { type: 'FLAG_FOR_MANUAL_REVIEW' };
  }

  const model = getModel();

  const matchContext = matches
    .map(
      (m, idx) =>
        `[Match ${idx + 1}] Category: ${m.category}\n` +
        `Question: ${m.raw_question}\n` +
        `Shaikh's Answer: ${m.shaikh_answer}\n` +
        `Similarity: ${m.similarity.toFixed(3)}, Frequency: ${m.historical_frequency_count}`,
    )
    .join('\n\n---\n\n');

  const isHighConfidence = compositeScore >= 0.85;

  const systemInstructions = isHighConfidence
    ? `You are the assistant of Shaikh (an Islamic scholar specializing in Hajj/Umrah jurisprudence).
A pilgrim has asked a question that closely matches verified historical answers from the Shaikh.
Your task: Draft a response in the Shaikh's voice using his EXACT historical phrasing wherever possible.
- Do not add opinions not present in the provided matches.
- Write in a warm, scholarly tone mixing Urdu, English, or Hinglish naturally as the Shaikh does.
- DO NOT include markdown formatting, bullet points, or headers — this will be read aloud via TTS.
- Speak directly to the pilgrim (e.g., "Aap ka sawaal yeh hai...").`
    : `You are the assistant of Shaikh (an Islamic scholar specializing in Hajj/Umrah jurisprudence).
A pilgrim has asked a question that PARTIALLY matches historical answers from the Shaikh.
Your task: Draft a tentative answer based on the available matches, but clearly note it needs Shaikh verification.
- Begin the answer with this exact phrase: "Yeh jawab tasdeek ke liye Shaikh ko bheeja ja raha hai —"
- Then provide the best possible answer drawing from the matches.
- Do not claim certainty. Use phrases like "generally", "in most cases", "based on available rulings".
- No markdown, bullets, or headers — TTS output only.`;

  const prompt = `${systemInstructions}

USER QUESTION: "${userQuestion}"

HISTORICAL MATCHES FROM SHAIKH'S DATABASE:
${matchContext}

Draft the response now:`;

  try {
    const result = await model.generateContent(prompt);
    const answer = result.response.text().trim();
    return isHighConfidence
      ? { type: 'DIRECT', answer }
      : { type: 'LIKELY_MATCH', answer };
  } catch (err) {
    logger.error({ err, userQuestion }, 'Gemini draft generation failed');
    throw err;
  }
}
