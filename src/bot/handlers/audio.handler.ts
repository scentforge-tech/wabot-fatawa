import {
  WASocket,
  WAMessage,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { transcribeAudio } from '../../services/whisper.service';
import { embedText } from '../../services/embeddings.service';
import { matchFataawa } from '../../services/firestore.service';
import { computeCompositeScore } from '../scoring';
import { generateDraft } from '../draft';
import { textToSpeech } from '../../services/tts.service';
import { translateToEnglish } from '../../services/gemini.service';
import { getGroupSettings } from '../../services/settings.service';
import { searchFatawa } from '../../services/fatawa-kb.service';
import { handleKbQuestion, MED_CONFIDENCE } from './text.handler';
import { env } from '../../config/env';
import logger from '../../config/logger';

// ─── Pending Draft Cache ──────────────────────────────────────────────────────

/**
 * Stores pending drafted answers keyed by the admin group message ID
 * that was sent to the Shaikh for approval.
 */
export interface PendingDraft {
  draftText: string;
  draftType: 'DIRECT' | 'LIKELY_MATCH';
  compositeScore: number;
  originalQuestion: string;
  userJid: string;
  publicGroupJid: string;
  publicMsgId?: string;  // For quoted-reply context
  timestamp: number;
}

export const pendingDrafts = new Map<string, PendingDraft>();

// Auto-expire pending drafts after 24 hours (in ms)
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export function cleanExpiredDrafts(): void {
  const now = Date.now();
  for (const [key, draft] of pendingDrafts) {
    if (now - draft.timestamp > DRAFT_TTL_MS) {
      pendingDrafts.delete(key);
    }
  }
}

export function getPendingDraft(adminMsgId: string): PendingDraft | undefined {
  return pendingDrafts.get(adminMsgId);
}

export function deletePendingDraft(adminMsgId: string): void {
  pendingDrafts.delete(adminMsgId);
}

export function getMostRecentPendingDraft(): typeof pendingDrafts extends Map<string, infer V> ? V | undefined : never {
  if (pendingDrafts.size === 0) return undefined;
  // Return the most recently added draft (last entry in insertion-order Map)
  let last: ReturnType<typeof getMostRecentPendingDraft>;
  for (const val of pendingDrafts.values()) last = val as any;
  return last;
}

// ─── Audio Handler ────────────────────────────────────────────────────────────

/**
 * Handles incoming audio/PTT messages from the public group.
 *
 * Pipeline:
 *   Download → Whisper transcription → Embed → Supabase similarity search
 *   → Composite scoring → Gemini draft (gated) → TTS → Admin group submission
 */
export async function handleAudioMessage(
  sock: WASocket,
  msg: WAMessage,
): Promise<void> {
  cleanExpiredDrafts();

  const msgId = msg.key.id ?? 'unknown';
  const senderJid = msg.key.participant ?? msg.key.remoteJid ?? '';
  const publicGroupJid = msg.key.remoteJid ?? '';

  // Resolve routing from live dashboard settings (env vars are blank in prod).
  const settings = getGroupSettings();
  const adminJid = settings.adminGroupJid || env.ADMIN_GROUP_JID || '';
  const replyMode = settings.replyMode ?? 'approval';
  const autoThreshold = settings.autoReplyThreshold ?? 0.72;

  logger.info({ msgId, senderJid }, 'Received audio message from public group');

  if (!adminJid) {
    logger.error({ msgId }, '❌ No admin group configured — open dashboard Setup tab and save groups');
    return;
  }

  // ── 1. Download audio ─────────────────────────────────────────────────────
  let audioBuffer: Buffer;
  try {
    audioBuffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: logger as never, reuploadRequest: sock.updateMediaMessage },
    )) as Buffer;
    logger.debug({ bytes: audioBuffer.length }, 'Audio downloaded');
  } catch (err) {
    logger.error({ err, msgId }, 'Failed to download audio message');
    return;
  }

  // ── 2. Transcribe via Whisper ─────────────────────────────────────────────
  let transcription: string;
  try {
    // 'auto' — let Gemini detect language naturally; translate to English later for search
    const result = await transcribeAudio(audioBuffer, 'audio.ogg', 'auto');
    transcription = result.text;
    logger.info({ transcription, msgId }, 'Audio transcribed');
  } catch (err) {
    logger.error({ err, msgId }, 'Whisper transcription failed');
    await sock.sendMessage(adminJid, {
      text: `⚠️ *Transcription Failed*\nMessage ID: ${msgId}\nThe system could not transcribe this voice note. Please review manually.`,
    });
    return;
  }

  if (!transcription || transcription.trim().length < 3) {
    logger.warn({ msgId }, 'Empty or too-short transcription — skipping');
    return;
  }

  // ── 2.5. Try the SAME fatawa KB used for typed questions first ────────────
  // If the pilgrim's voice question matches an existing Sheikh recording,
  // treat it exactly like a typed question (real audio + citations + normal
  // approval flow) instead of synthesizing a brand-new AI voice answer below.
  try {
    const searchTextForKb = await translateToEnglish(transcription);
    const kbMatches = await searchFatawa(searchTextForKb, { topN: 1, threshold: MED_CONFIDENCE });
    const kbTopMatch = kbMatches[0];
    if (kbTopMatch && kbTopMatch.record.audioFileName) {
      logger.info(
        { msgId, score: kbTopMatch.score, file: kbTopMatch.record.audioFileName },
        '🎯 Voice question matched existing KB audio — using it instead of synthetic draft',
      );
      await handleKbQuestion(sock, msg, {
        displayText: transcription,
        searchText: searchTextForKb,
        senderJid,
        senderName: msg.pushName ?? senderJid.split('@')[0],
        publicGroupJid,
        adminGroupJid: adminJid,
        settings,
        preSearched: kbTopMatch,
      });
      return;
    }
    logger.info({ msgId }, 'No existing KB audio match for voice question — falling back to draft pipeline');
  } catch (err) {
    logger.warn({ err, msgId }, 'KB pre-check for voice question failed — falling back to draft pipeline');
  }

  // ── 3–7. Embed → Match → Score → Draft (with graceful fallback) ─────────────
  let draft: Awaited<ReturnType<typeof generateDraft>>;
  let scoring: ReturnType<typeof computeCompositeScore>;

  try {
    // ── 3. Translate to English for vector search ─────────────────────────────
    // Pilgrim asks in Urdu/Hindi → translate for matching English fatawa in DB
    // Original Urdu transcription is kept for display to Shaikh and draft generation
    const searchText = await translateToEnglish(transcription);
    logger.info({ searchText, msgId }, 'Search text ready');

    // ── 4. Generate embedding ────────────────────────────────────────────────
    const embedding = await embedText(searchText);

    // ── 5. Query Firestore for similar historical answers ────────────────────
    const matches = await matchFataawa(embedding);
    logger.info({ matchCount: matches.length, msgId }, 'Database matches retrieved');

    // ── 5. Compute composite score ───────────────────────────────────────────
    scoring = computeCompositeScore(matches);
    logger.info(
      { compositeScore: scoring.compositeScore.toFixed(3), tier: scoring.tier },
      'Composite score computed',
    );

    // ── 6. Generate draft ────────────────────────────────────────────────────
    draft = await generateDraft(transcription, scoring);

  } catch (err) {
    // Firestore not set up yet, or embedding failed — send transcript to admin for manual review
    logger.warn({ err, msgId }, 'Pipeline error (embedding/DB) — falling back to manual review');
    await sock.sendMessage(adminJid, {
      text:
        `🎤 *NEW PILGRIM QUESTION*\n\n` +
        `"${transcription}"\n\n` +
        `_Record your voice answer in this group — it will be automatically forwarded to the pilgrim._`,
    });
    return;
  }

  // ── 7. Route based on draft type ──────────────────────────────────────────
  if (draft.type === 'FLAG_FOR_MANUAL_REVIEW') {
    logger.info({ msgId }, 'Sending FLAG_FOR_MANUAL_REVIEW to admin group');
    await sock.sendMessage(adminJid, {
      text:
        `🚩 *FLAG FOR MANUAL REVIEW*\n\n` +
        `*Original Question (Transcribed):*\n"${transcription}"\n\n` +
        `*Composite Score:* ${scoring.compositeScore.toFixed(3)} (below 0.60 threshold)\n` +
        `*Top Match Similarity:* ${(scoring.topMatch?.similarity ?? 0).toFixed(3)}\n\n` +
        `_This question could not be matched confidently to any historical answer. Shaikh's direct response is required._`,
    });
    return;
  }


  // ── 8. Cache the pending draft FIRST (before TTS) ────────────────────────
  // Store draft now so text-approval still works if TTS fails
  const draftCacheKey = `draft_${msgId}`;
  pendingDrafts.set(draftCacheKey, {
    draftText: draft.text,
    draftType: draft.type,
    compositeScore: draft.compositeScore,
    originalQuestion: transcription,
    userJid: senderJid,
    publicGroupJid,
    publicMsgId: msg.key.id ?? undefined,
    timestamp: Date.now(),
  });
  logger.info({ draftCacheKey }, 'Draft cached');

  // ── 9. Convert draft text → TTS audio ────────────────────────────────────
  let ttsBuffer: Buffer;
  try {
    ttsBuffer = await textToSpeech(draft.text);
    logger.debug({ bytes: ttsBuffer.length }, 'TTS audio generated');
  } catch (err) {
    logger.error({ err, msgId }, 'TTS conversion failed — sending text fallback to admin');
    // Send draft as text — Shaikh can approve by replying 'thik hai' / 'approve'
    await sock.sendMessage(adminJid, {
      text:
        `📝 *DRAFT ANSWER — AWAITING APPROVAL*\n\n` +
        `*Pilgrim asked:* "${transcription}"\n\n` +
        `*Suggested answer:*\n${draft.text}\n\n` +
        `✅ Reply *thik hai* or *approve* to send this to the public group.\n` +
        `❌ Reply *nahi* or *reject* to discard.\n` +
        `🎤 Or record a voice answer — it will be forwarded directly.`,
    });
    return;
  }

  // ── 9.5 Auto-reply (if configured) ───────────────────────────────────────
  // In 'auto'/'hybrid' modes, a high-confidence (DIRECT) draft above the
  // threshold is sent straight to the pilgrim instead of the Sheikh.
  if (
    replyMode !== 'approval' &&
    draft.type === 'DIRECT' &&
    draft.compositeScore >= autoThreshold
  ) {
    try {
      await sock.sendMessage(
        publicGroupJid,
        { audio: ttsBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true },
        { quoted: msg },
      );
      pendingDrafts.delete(draftCacheKey);
      logger.info({ msgId, score: draft.compositeScore, mode: replyMode }, '🤖 Auto-replied audio to user');

      if (replyMode === 'hybrid') {
        await sock.sendMessage(adminJid, {
          text:
            `🤖 *AUTO-REPLIED* (voice, ${(draft.compositeScore * 100).toFixed(0)}%)\n\n` +
            `*Q:* "${transcription}"\n\n` +
            `_Answer sent automatically — no action needed._`,
        });
      }
      return; // done — skip admin approval
    } catch (err) {
      logger.error({ err, msgId }, 'Audio auto-reply failed — falling back to admin approval');
      // fall through to normal approval flow below
    }
  }

  // ── 10. Send TTS audio to admin group with approval prompt ────────────────
  const tierLabel =
    draft.type === 'DIRECT'
      ? '✅ HIGH CONFIDENCE'
      : '⚠️ MEDIUM CONFIDENCE';

  const approvalCaption =
    `🎙️ *DRAFT — ${tierLabel}*\n` +
    `*Q:* "${transcription}"\n\n` +
    `Reply *thik hai* to send, *nahi* to reject, or record your own voice answer.`;

  const sentMsg = await sock.sendMessage(adminJid, {
    audio: ttsBuffer,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: false,
    caption: approvalCaption,
  });

  // Update cache with real admin message ID if available
  const adminMsgId = sentMsg?.key.id;
  if (adminMsgId) {
    const existing = pendingDrafts.get(draftCacheKey);
    if (existing) {
      pendingDrafts.delete(draftCacheKey);
      pendingDrafts.set(adminMsgId, existing);
      logger.info({ adminMsgId }, 'Draft cache updated with admin message ID');
    }
  }
}
