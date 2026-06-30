import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import {
  searchFatawa,
  savePendingQuestion,
  savePendingAdminMsgId,
  generateQuestionId,
} from '../../services/fatawa-kb.service';
import { getGroupSettings } from '../../services/settings.service';
import { env } from '../../config/env';
import logger from '../../config/logger';

// ─── Text Message Handler — Fatawa Semantic Search ───────────────────────────
//
// DESIGN: Each step has its own try/catch.
// The WhatsApp notification to admin ALWAYS fires, even if Firestore fails.
// This makes the flow bulletproof.
//
// ─────────────────────────────────────────────────────────────────────────────

const HIGH_CONFIDENCE = 0.72;
const MED_CONFIDENCE  = 0.55;

export async function handleTextMessage(
  sock: WASocket,
  msg: WAMessage,
): Promise<void> {
  const msgId          = msg.key.id ?? 'unknown';
  const senderJid      = msg.key.participant ?? msg.key.remoteJid ?? '';
  const publicGroupJid = msg.key.remoteJid ?? '';

  // ── Extract text ────────────────────────────────────────────────────────────
  const rawText =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    '';

  if (!rawText || rawText.trim().length < 5) return;

  // Skip very short non-question content (emoji, greetings < 8 chars)
  const textOnly = rawText.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  if (textOnly.length < 8) {
    logger.debug({ msgId, rawText }, 'Text too short after stripping — skipping');
    return;
  }

  const senderName = msg.pushName ?? senderJid.split('@')[0];

  // ── Get admin JID from live settings ────────────────────────────────────────
  const settings = getGroupSettings();
  const adminGroupJid = settings.adminGroupJid || env.ADMIN_GROUP_JID || '';

  logger.info(
    { msgId, senderJid, rawText, adminGroupJid: adminGroupJid.slice(0,20), publicGroupJid },
    '💬 Text question received — routing to admin',
  );

  if (!adminGroupJid) {
    logger.error({ msgId }, '❌ No admin group JID configured — open dashboard Setup tab and save groups');
    return;
  }

  // ── Step 1: Semantic search (best-effort, failures are non-fatal) ───────────
  let topMatch: Awaited<ReturnType<typeof searchFatawa>>[0] | undefined;
  try {
    logger.info({ msgId }, '🔍 Searching fatawa KB…');
    const matches = await searchFatawa(rawText, { topN: 1, threshold: MED_CONFIDENCE });
    topMatch = matches[0];
    logger.info({ msgId, score: topMatch?.score, file: topMatch?.record?.audioFileName }, '🔍 Search complete');
  } catch (err) {
    logger.error({ err, msgId }, '⚠️  Fatawa KB search failed — continuing with no-match flow');
    topMatch = undefined;
  }

  // ── Step 2: Build the admin notification text ───────────────────────────────
  const qId = generateQuestionId();

  let adminNotice: string;
  let audioFileName = '';
  let confidence    = 0;
  let transcript    = '';

  if (topMatch && topMatch.score >= HIGH_CONFIDENCE && topMatch.record.audioFileName) {
    const rec = topMatch.record;
    audioFileName = rec.audioFileName;
    confidence    = topMatch.score;
    transcript    = (rec.answerTranscript || rec.answerText || '').slice(0, 200);
    const pct     = Math.round(confidence * 100);

    adminNotice =
      `🎤 *FATAWA MATCH FOUND* (${pct}%)\n\n` +
      `*❓ Question:*\n"${rawText}"\n` +
      `👤 _${senderName}_\n\n` +
      `*🎙️ Suggested Audio:* \`${audioFileName}\`\n` +
      `*📂 Topic:* ${rec.topic || 'General'}\n\n` +
      `*📝 Transcript:*\n${transcript}${transcript.length >= 200 ? '…' : ''}\n\n` +
      `✅ Reply *thik hai* → send this audio to pilgrim\n` +
      `❌ Reply *nahi* → skip\n` +
      `🆔 _ref: ${qId}_`;

  } else if (topMatch && topMatch.score >= MED_CONFIDENCE && topMatch.record.audioFileName) {
    const rec = topMatch.record;
    audioFileName = rec.audioFileName;
    confidence    = topMatch.score;
    transcript    = (rec.answerTranscript || rec.answerText || '').slice(0, 150);
    const pct     = Math.round(confidence * 100);

    adminNotice =
      `⚠️ *POSSIBLE MATCH (${pct}% confidence)*\n\n` +
      `*❓ Question:*\n"${rawText}"\n` +
      `👤 _${senderName}_\n\n` +
      `*🎙️ Closest audio:* \`${audioFileName}\`\n\n` +
      `*📝 Preview:*\n${transcript}${transcript.length >= 150 ? '…' : ''}\n\n` +
      `✅ *thik hai* → send this audio\n` +
      `🎤 Or record your own voice answer\n` +
      `❌ *nahi* → discard\n` +
      `🆔 _ref: ${qId}_`;

  } else {
    adminNotice =
      `🆕 *NEW QUESTION — NO MATCH*\n\n` +
      `*❓ Question:*\n"${rawText}"\n` +
      `👤 _${senderName}_\n\n` +
      `_No historical fatwa audio found._\n\n` +
      `🎤 Please record a voice answer — it will be forwarded automatically.\n` +
      `🆔 _ref: ${qId}_`;
  }

  // ── Step 3: Save to Firestore (non-fatal — notification still goes through) ─
  try {
    await savePendingQuestion({
      questionId:             qId,
      publicGroupJid,
      quotedMessageId:        msgId,
      senderJid,
      senderName,
      questionText:           rawText,
      suggestedAudioFile:     audioFileName ? `gs://${env.GCS_BUCKET_NAME}/${audioFileName}` : '',
      suggestedAudioFileName: audioFileName,
      suggestedTranscript:    transcript,
      confidence,
      status:                 'pending',
    });
    logger.info({ qId }, '✅ Pending question saved to Firestore');
  } catch (err) {
    logger.error({ err, qId }, '⚠️  Failed to save pending question to Firestore — continuing');
  }

  // ── Step 4: Send WhatsApp notification to admin group (must always succeed) ─
  try {
    logger.info({ adminGroupJid, qId }, '📤 Sending notification to admin group…');
    const sentMsg    = await sock.sendMessage(adminGroupJid, { text: adminNotice });
    const adminMsgId = sentMsg?.key.id;
    logger.info({ qId, adminMsgId, adminGroupJid }, '✅ Admin notification sent!');

    if (adminMsgId) {
      try {
        await savePendingAdminMsgId(qId, adminMsgId);
      } catch (e) {
        logger.warn({ e }, 'Could not save admin msg ID to Firestore');
      }
    }
  } catch (err) {
    logger.error({ err, adminGroupJid, qId }, '❌ CRITICAL: Failed to send WhatsApp notification to admin group');
  }
}
