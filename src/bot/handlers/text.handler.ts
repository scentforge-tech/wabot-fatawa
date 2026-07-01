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
    transcript    = (rec.answerTranscriptProcessed || rec.answerTranscript || rec.answerText || '').slice(0, 180);
    const pct     = Math.round(confidence * 100);
    const ruling  = rec.authenticRuling ? `\n*⚖️ Islamic Ruling:*\n${rec.authenticRuling.slice(0, 200)}` : '';
    const english = rec.englishTranslation ? `\n*🌐 Summary:*\n${rec.englishTranslation.slice(0, 200)}` : '';
    const label   = rec.accuracyLabel ? ` _(${rec.accuracyLabel})_` : '';

    adminNotice =
      `🎤 *HIGH CONFIDENCE MATCH* (${pct}%)${label}\n\n` +
      `*❓ Question:*\n"${rawText}"\n` +
      `👤 _${senderName}_\n\n` +
      `*🎙️ Suggested Audio:* \`${audioFileName}\`\n` +
      `*📂 Topic:* ${rec.topic || 'General'}` +
      ruling +
      english + `\n\n` +
      `*📝 Urdu Transcript:*\n${transcript}${transcript.length >= 180 ? '…' : ''}\n\n` +
      `Send *Y* → forward this audio ✅\n` +
      `Send *N* → reject ❌\n` +
      `Send *A* → record your own 🎤\n` +
      `Send any text → send as text answer 📝\n` +
      `🆔 _ref: ${qId}_`;

  } else if (topMatch && topMatch.score >= MED_CONFIDENCE && topMatch.record.audioFileName) {
    const rec = topMatch.record;
    audioFileName = rec.audioFileName;
    confidence    = topMatch.score;
    transcript    = (rec.answerTranscriptProcessed || rec.answerTranscript || rec.answerText || '').slice(0, 150);
    const pct     = Math.round(confidence * 100);
    const ruling  = rec.authenticRuling ? `\n*⚖️ Ruling:* ${rec.authenticRuling.slice(0, 150)}` : '';
    const english = rec.englishTranslation ? `\n*🌐 Summary:* ${rec.englishTranslation.slice(0, 150)}` : '';

    adminNotice =
      `⚠️ *POSSIBLE MATCH* (${pct}% confidence)\n\n` +
      `*❓ Question:*\n"${rawText}"\n` +
      `👤 _${senderName}_\n\n` +
      `*🎙️ Closest audio:* \`${audioFileName}\`\n` +
      `*📂 Topic:* ${rec.topic || 'General'}` +
      ruling +
      english + `\n\n` +
      `*📝 Preview:*\n${transcript}${transcript.length >= 150 ? '…' : ''}\n\n` +
      `*Y* → send | *N* → reject | *A* → record | text → send as text\n` +
      `🆔 _ref: ${qId}_`;

  } else {
    adminNotice =
      `🆕 *NEW QUESTION — NO KB MATCH*\n\n` +
      `*❓ Question:*\n"${rawText}"\n` +
      `👤 _${senderName}_\n\n` +
      `_No historical fatwa audio found in the database._\n\n` +
      `*A* → record voice answer 🎤\n` +
      `Send any text → send as text reply 📝\n` +
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
