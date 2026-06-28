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

const pendingDrafts = new Map<string, PendingDraft>();

// Auto-expire pending drafts after 24 hours (in ms)
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function cleanExpiredDrafts(): void {
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

  logger.info({ msgId, senderJid }, 'Received audio message from public group');

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
    const result = await transcribeAudio(audioBuffer, 'audio.ogg', 'ur');
    transcription = result.text;
    logger.info({ transcription, msgId }, 'Audio transcribed');
  } catch (err) {
    logger.error({ err, msgId }, 'Whisper transcription failed');
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text: `⚠️ *Transcription Failed*\nMessage ID: ${msgId}\nThe system could not transcribe this voice note. Please review manually.`,
    });
    return;
  }

  if (!transcription || transcription.trim().length < 3) {
    logger.warn({ msgId }, 'Empty or too-short transcription — skipping');
    return;
  }

  // ── 3–7. Embed → Match → Score → Draft (with graceful fallback) ─────────────
  let draft: Awaited<ReturnType<typeof generateDraft>>;
  let scoring: ReturnType<typeof computeCompositeScore>;

  try {
    // ── 3. Generate embedding ────────────────────────────────────────────────
    const embedding = await embedText(transcription);

    // ── 4. Query Firestore for similar historical answers ────────────────────
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
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
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
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text:
        `🚩 *FLAG FOR MANUAL REVIEW*\n\n` +
        `*Original Question (Transcribed):*\n"${transcription}"\n\n` +
        `*Composite Score:* ${scoring.compositeScore.toFixed(3)} (below 0.60 threshold)\n` +
        `*Top Match Similarity:* ${(scoring.topMatch?.similarity ?? 0).toFixed(3)}\n\n` +
        `_This question could not be matched confidently to any historical answer. Shaikh's direct response is required._`,
    });
    return;
  }


  // ── 8. Convert draft text → TTS audio ────────────────────────────────────
  let ttsBuffer: Buffer;
  try {
    ttsBuffer = await textToSpeech(draft.text);
    logger.debug({ bytes: ttsBuffer.length }, 'TTS audio generated');
  } catch (err) {
    logger.error({ err, msgId }, 'TTS conversion failed — sending text fallback to admin');
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text: `⚠️ *TTS Failed* — Please approve the text draft below:\n\n${draft.text}`,
    });
    return;
  }

  // ── 9. Send to admin group with approval prompt ───────────────────────────
  const tierLabel =
    draft.type === 'DIRECT'
      ? '✅ HIGH CONFIDENCE (≥ 0.85) — Based on exact historical wording'
      : '⚠️ MEDIUM CONFIDENCE (0.60–0.84) — Likely match, needs verification';

  const approvalCaption =
    `🎙️ *FATWA DRAFT — AWAITING SHAIKH APPROVAL*\n\n` +
    `*Pilgrim's Question:*\n"${transcription}"\n\n` +
    `*Confidence Tier:* ${tierLabel}\n` +
    `*Composite Score:* ${scoring.compositeScore.toFixed(3)}\n` +
    `*Category:* ${scoring.topMatch?.category ?? 'Unknown'}\n\n` +
    `📣 *Shaikh — please reply with a voice note to approve or reject this draft.*\n` +
    `Approval keywords: *Approve / Haan / Sahi hai / Bilkul / Theek hai*`;

  // Send the TTS audio as a standard audio (not PTT) so Shaikh can listen before deciding
  const sentMsg = await sock.sendMessage(env.ADMIN_GROUP_JID, {
    audio: ttsBuffer,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: false,
    caption: approvalCaption,
  });

  // ── 10. Cache the pending draft ───────────────────────────────────────────
  const adminMsgId = sentMsg?.key.id;
  if (adminMsgId) {
    pendingDrafts.set(adminMsgId, {
      draftText: draft.text,
      draftType: draft.type,
      compositeScore: draft.compositeScore,
      originalQuestion: transcription,
      userJid: senderJid,
      publicGroupJid,
      publicMsgId: msg.key.id ?? undefined,
      timestamp: Date.now(),
    });
    logger.info({ adminMsgId, userJid: senderJid }, 'Draft cached — awaiting Shaikh approval');
  }
}
