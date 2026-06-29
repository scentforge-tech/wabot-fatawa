import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { embedText } from '../../services/embeddings.service';
import { matchFataawa } from '../../services/firestore.service';
import { computeCompositeScore } from '../scoring';
import { generateDraft } from '../draft';
import { textToSpeech } from '../../services/tts.service';
import { translateToEnglish } from '../../services/gemini.service';
import { env } from '../../config/env';
import logger from '../../config/logger';
import { pendingDrafts, PendingDraft, cleanExpiredDrafts } from './audio.handler';

// ─── Text Message Handler ─────────────────────────────────────────────────────

/**
 * Handles incoming TEXT messages from the public group.
 *
 * Accepts questions in:
 *   - Urdu script (Arabic)
 *   - Roman Urdu (Latin transliteration)
 *   - English
 *   - Hindi / mixed language
 *
 * Pipeline:
 *   Text → (translate to English if needed) → Embed → Supabase/Firestore
 *   similarity search → Composite scoring → Gemini draft → TTS → Admin
 *   group submission (same approval flow as audio)
 */
export async function handleTextMessage(
  sock: WASocket,
  msg: WAMessage,
): Promise<void> {
  cleanExpiredDrafts();

  const msgId   = msg.key.id ?? 'unknown';
  const senderJid = msg.key.participant ?? msg.key.remoteJid ?? '';
  const publicGroupJid = msg.key.remoteJid ?? '';

  // Extract text from both plain and extended text messages
  const rawText =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    '';

  if (!rawText || rawText.trim().length < 3) {
    logger.debug({ msgId }, 'Text too short — skipping');
    return;
  }

  // Ignore messages that look like commands or greetings (< 5 chars or
  // pure emoji / punctuation) to avoid noisy responses
  const textOnly = rawText.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  if (textOnly.length < 5) {
    logger.debug({ msgId, rawText }, 'Text is too short after stripping — skipping');
    return;
  }

  logger.info({ msgId, senderJid, rawText }, '💬 Received text message from public group');

  // ── 1. Translate to English for vector search ───────────────────────────────
  let searchText: string;
  try {
    searchText = await translateToEnglish(rawText);
    logger.info({ searchText, msgId }, 'Search text ready (translated/passed-through)');
  } catch (err) {
    logger.warn({ err, msgId }, 'Translation failed — using raw text for search');
    searchText = rawText;
  }

  // ── 2–6. Embed → Match → Score → Draft (with graceful fallback) ─────────────
  let draft: Awaited<ReturnType<typeof generateDraft>>;
  let scoring: ReturnType<typeof computeCompositeScore>;

  try {
    // ── 2. Generate embedding ──────────────────────────────────────────────────
    const embedding = await embedText(searchText);

    // ── 3. Query Firestore for similar historical answers ─────────────────────
    const matches = await matchFataawa(embedding);
    logger.info({ matchCount: matches.length, msgId }, 'Database matches retrieved');

    // ── 4. Compute composite score ────────────────────────────────────────────
    scoring = computeCompositeScore(matches);
    logger.info(
      { compositeScore: scoring.compositeScore.toFixed(3), tier: scoring.tier },
      'Composite score computed',
    );

    // ── 5. Generate draft ─────────────────────────────────────────────────────
    draft = await generateDraft(rawText, scoring);

  } catch (err) {
    // Firestore not set up yet, or embedding failed — send text to admin for manual review
    logger.warn({ err, msgId }, 'Pipeline error (embedding/DB) — falling back to manual review');
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text:
        `💬 *NEW TEXT QUESTION (Public Group)*\n\n` +
        `"${rawText}"\n\n` +
        `_Please reply with your answer — it will be forwarded to the pilgrim._`,
    });
    return;
  }

  // ── 6. Route based on draft type ────────────────────────────────────────────
  if (draft.type === 'FLAG_FOR_MANUAL_REVIEW') {
    logger.info({ msgId }, 'Sending FLAG_FOR_MANUAL_REVIEW to admin group');
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text:
        `🚩 *FLAG FOR MANUAL REVIEW (Text Question)*\n\n` +
        `*Question:*\n"${rawText}"\n\n` +
        `*Composite Score:* ${scoring!.compositeScore.toFixed(3)} (below 0.60 threshold)\n` +
        `_This question could not be matched confidently. Shaikh's direct response is required._`,
    });
    return;
  }

  // ── 7. Cache pending draft ──────────────────────────────────────────────────
  const draftCacheKey = `draft_${msgId}`;
  const pendingEntry: PendingDraft = {
    draftText: draft.text,
    draftType: draft.type,
    compositeScore: draft.compositeScore,
    originalQuestion: rawText,
    userJid: senderJid,
    publicGroupJid,
    publicMsgId: msg.key.id ?? undefined,
    timestamp: Date.now(),
  };
  pendingDrafts.set(draftCacheKey, pendingEntry);
  logger.info({ draftCacheKey }, 'Text draft cached');

  // ── 8. Convert draft text → TTS audio ──────────────────────────────────────
  let ttsBuffer: Buffer;
  try {
    ttsBuffer = await textToSpeech(draft.text);
    logger.debug({ bytes: ttsBuffer.length }, 'TTS audio generated');
  } catch (err) {
    logger.error({ err, msgId }, 'TTS failed — sending text fallback to admin');
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text:
        `📝 *DRAFT ANSWER (Text Question) — AWAITING APPROVAL*\n\n` +
        `*Pilgrim asked:* "${rawText}"\n\n` +
        `*Suggested answer:*\n${draft.text}\n\n` +
        `✅ Reply *thik hai* or *approve* to send.\n` +
        `❌ Reply *nahi* or *reject* to discard.\n` +
        `🎤 Or record your own voice — it will be forwarded directly.`,
    });
    return;
  }

  // ── 9. Send TTS audio to admin group with approval prompt ───────────────────
  const tierLabel =
    draft.type === 'DIRECT'
      ? '✅ HIGH CONFIDENCE'
      : '⚠️ MEDIUM CONFIDENCE';

  const approvalCaption =
    `💬 *TEXT Q — ${tierLabel}*\n` +
    `*Q:* "${rawText}"\n\n` +
    `Reply *thik hai* to send, *nahi* to reject, or record your own voice answer.`;

  const sentMsg = await sock.sendMessage(env.ADMIN_GROUP_JID, {
    audio: ttsBuffer,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: false,
    caption: approvalCaption,
  });

  // Update cache with real admin message ID
  const adminMsgId = sentMsg?.key.id;
  if (adminMsgId) {
    const existing = pendingDrafts.get(draftCacheKey);
    if (existing) {
      pendingDrafts.delete(draftCacheKey);
      pendingDrafts.set(adminMsgId, existing);
      logger.info({ adminMsgId }, 'Text draft cache updated with admin message ID');
    }
  }
}
