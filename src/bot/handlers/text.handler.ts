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
// Flow:
//   1. User asks in any language (Urdu / Roman Urdu / English)
//   2. Gemini embedding → semantic search over _fatawa_kb
//   3. High confidence (≥0.72)  → send audio preview + transcript to admin group
//      Low confidence / no match → send question to admin group for manual reply
//   4. Admin says "thik hai" (or quotes the message) → approval.handler.ts
//      sends the matched Sheikh audio file to public group, quoting user's message
//
// ─────────────────────────────────────────────────────────────────────────────

const HIGH_CONFIDENCE = 0.72;

export async function handleTextMessage(
  sock: WASocket,
  msg: WAMessage,
): Promise<void> {
  const msgId        = msg.key.id ?? 'unknown';
  const senderJid    = msg.key.participant ?? msg.key.remoteJid ?? '';
  const publicGroupJid = msg.key.remoteJid ?? '';

  // Extract text
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

  // Get live group settings (stored in Firestore, set from dashboard)
  const settings = getGroupSettings();
  const adminGroupJid = settings.adminGroupJid || env.ADMIN_GROUP_JID;

  if (!adminGroupJid) {
    logger.error({ msgId }, 'No admin group configured — cannot forward question. Set it in the dashboard.');
    return;
  }

  logger.info({ msgId, senderJid, rawText }, '💬 Text question received from public group');

  // ── 1. Semantic search in fatawa KB ─────────────────────────────────────────
  let matches: Awaited<ReturnType<typeof searchFatawa>> = [];
  try {
    matches = await searchFatawa(rawText, { topN: 3, threshold: 0.50 });
  } catch (err) {
    logger.error({ err, msgId }, 'Fatawa search failed — falling back to manual');
    matches = [];
  }

  const topMatch = matches[0];

  // ── 2a. HIGH CONFIDENCE — suggest specific audio answer ─────────────────────
  if (topMatch && topMatch.score >= HIGH_CONFIDENCE && topMatch.record.audioFileName) {
    const rec   = topMatch.record;
    const score = topMatch.score;
    const qId   = generateQuestionId();

    const confidencePct = Math.round(score * 100);
    const transcriptPreview = (rec.answerTranscript || rec.answerText || '').slice(0, 200);

    // Save pending state in Firestore
    await savePendingQuestion({
      questionId:           qId,
      publicGroupJid,
      quotedMessageId:      msgId,
      senderJid,
      senderName,
      questionText:         rawText,
      suggestedAudioFile:   `gs://${env.GCS_BUCKET_NAME}/${rec.audioFileName}`,
      suggestedAudioFileName: rec.audioFileName,
      suggestedTranscript:  rec.answerTranscript || rec.answerText || '',
      confidence:           score,
      status:               'pending',
    });

    // Notify admin group
    const adminNotice =
      `🎤 *FATAWA MATCH FOUND*\n\n` +
      `*❓ Question (public group):*\n"${rawText}"\n` +
      `👤 _${senderName}_\n\n` +
      `*🎙️ Suggested Audio:* \`${rec.audioFileName}\`\n` +
      `*📊 Confidence:* ${confidencePct}%\n` +
      `*📂 Topic:* ${rec.topic || 'General'}\n\n` +
      `*📝 Transcript preview:*\n${transcriptPreview}${transcriptPreview.length >= 200 ? '…' : ''}\n\n` +
      `✅ Reply *thik hai* to send this audio to the pilgrim\n` +
      `❌ Reply *nahi* to skip (you can then send your own voice)\n` +
      `🆔 _ref: ${qId}_`;

    const sentMsg = await sock.sendMessage(adminGroupJid, { text: adminNotice });
    const adminMsgId = sentMsg?.key.id;
    if (adminMsgId) {
      await savePendingAdminMsgId(qId, adminMsgId);
    }

    logger.info(
      { qId, audioFile: rec.audioFileName, confidence: confidencePct, adminMsgId },
      '✅ High-confidence match sent to admin group for approval',
    );
    return;
  }

  // ── 2b. MEDIUM CONFIDENCE — mention best match but ask Shaikh ───────────────
  if (topMatch && topMatch.score >= 0.55 && topMatch.record.audioFileName) {
    const rec   = topMatch.record;
    const qId   = generateQuestionId();
    const confidencePct = Math.round(topMatch.score * 100);
    const transcriptPreview = (rec.answerTranscript || rec.answerText || '').slice(0, 150);

    await savePendingQuestion({
      questionId:           qId,
      publicGroupJid,
      quotedMessageId:      msgId,
      senderJid,
      senderName,
      questionText:         rawText,
      suggestedAudioFile:   `gs://${env.GCS_BUCKET_NAME}/${rec.audioFileName}`,
      suggestedAudioFileName: rec.audioFileName,
      suggestedTranscript:  rec.answerTranscript || rec.answerText || '',
      confidence:           topMatch.score,
      status:               'pending',
    });

    const adminNotice =
      `⚠️ *POSSIBLE MATCH (${confidencePct}% confidence)*\n\n` +
      `*❓ Question:*\n"${rawText}"\n` +
      `👤 _${senderName}_\n\n` +
      `*🎙️ Closest audio:* \`${rec.audioFileName}\`\n` +
      `*📂 Topic:* ${rec.topic || 'General'}\n\n` +
      `*📝 Preview:*\n${transcriptPreview}${transcriptPreview.length >= 150 ? '…' : ''}\n\n` +
      `✅ *thik hai* → send this audio to pilgrim\n` +
      `🎤 Or record your own voice answer\n` +
      `❌ *nahi* → discard\n` +
      `🆔 _ref: ${qId}_`;

    const sentMsg = await sock.sendMessage(adminGroupJid, { text: adminNotice });
    const adminMsgId = sentMsg?.key.id;
    if (adminMsgId) await savePendingAdminMsgId(qId, adminMsgId);

    logger.info(
      { qId, audioFile: rec.audioFileName, confidence: confidencePct },
      '⚠️ Medium-confidence match sent to admin for review',
    );
    return;
  }

  // ── 2c. NO MATCH — ask Shaikh to answer manually ────────────────────────────
  const qId = generateQuestionId();
  await savePendingQuestion({
    questionId:             qId,
    publicGroupJid,
    quotedMessageId:        msgId,
    senderJid,
    senderName,
    questionText:           rawText,
    suggestedAudioFile:     '',
    suggestedAudioFileName: '',
    suggestedTranscript:    '',
    confidence:             0,
    status:                 'pending',
  });

  const adminNotice =
    `🆕 *NEW QUESTION — NO MATCH IN DATABASE*\n\n` +
    `*❓ Question:*\n"${rawText}"\n` +
    `👤 _${senderName}_\n\n` +
    `_No historical audio fatwa found for this question._\n\n` +
    `🎤 Please record a voice answer — it will be forwarded to the pilgrim automatically.\n` +
    `📝 Or reply with a text answer.\n` +
    `🆔 _ref: ${qId}_`;

  const sentMsg = await sock.sendMessage(adminGroupJid, { text: adminNotice });
  const adminMsgId = sentMsg?.key.id;
  if (adminMsgId) await savePendingAdminMsgId(qId, adminMsgId);

  logger.info({ qId, msgId }, '🆕 No match — question forwarded to admin for manual answer');
}
