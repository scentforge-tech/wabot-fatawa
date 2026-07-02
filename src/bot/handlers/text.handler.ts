import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import {
  searchFatawa,
  savePendingQuestion,
  savePendingAdminMsgId,
  generateQuestionId,
  downloadAudioFile,
  formatReferencesForWhatsApp,
  FatawaMatch,
} from '../../services/fatawa-kb.service';
import { getGroupSettings, GroupSettings } from '../../services/settings.service';
import { classifyFollowUp } from '../../services/gemini.service';
import { env } from '../../config/env';
import logger from '../../config/logger';

// ─── Text Message Handler — Fatawa Semantic Search ───────────────────────────
//
// DESIGN: Each step has its own try/catch.
// The WhatsApp notification to admin ALWAYS fires, even if Firestore fails.
// This makes the flow bulletproof.
//
// handleKbQuestion() below is shared with audio.handler.ts — a transcribed
// voice question that matches an existing KB record goes through the exact
// same notice/auto-reply/approval flow as a typed question, so pilgrims get
// the Sheikh's real recorded audio either way instead of a synthetic one.
// ─────────────────────────────────────────────────────────────────────────────

export const HIGH_CONFIDENCE = 0.72;
export const MED_CONFIDENCE  = 0.55;

// ─── Conversation continuity ────────────────────────────────────────────────
// Per-sender short-term memory so a burst of messages ("Ihram mein..." then
// "...khushbu lagana kaisa hai?") is recognized as ONE question, not two.
interface RecentQuestion {
  combinedText: string;
  lastQuestionId: string;
  timestamp: number;
}
const _recentQuestions = new Map<string, RecentQuestion>();
const CONTINUATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function cleanRecentQuestions(): void {
  const now = Date.now();
  for (const [k, v] of _recentQuestions) {
    if (now - v.timestamp > CONTINUATION_WINDOW_MS) _recentQuestions.delete(k);
  }
}

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

  await handleKbQuestion(sock, msg, {
    displayText: rawText,
    searchText: rawText,
    senderJid,
    senderName,
    publicGroupJid,
    adminGroupJid,
    settings,
  });
}

export interface KbQuestionContext {
  displayText: string;  // shown to the Sheikh as "Question:" — original wording
  searchText: string;   // text actually searched against the KB (may be translated)
  senderJid: string;
  senderName: string;
  publicGroupJid: string;
  adminGroupJid: string;
  settings: GroupSettings;
  preSearched?: FatawaMatch; // pass when the caller already ran searchFatawa, to avoid a duplicate call
}

/**
 * Search the KB and run the full notice/auto-reply/approval flow for a
 * question — regardless of whether it originally arrived as typed text or a
 * transcribed voice note. Shared by text.handler.ts and audio.handler.ts.
 */
export async function handleKbQuestion(
  sock: WASocket,
  msg: WAMessage,
  ctx: KbQuestionContext,
): Promise<void> {
  const msgId = msg.key.id ?? 'unknown';
  const { displayText, senderJid, senderName, publicGroupJid, adminGroupJid, settings } = ctx;
  let searchText = ctx.searchText;

  // ── Step 0: Conversation continuity — is this a follow-up to their last message? ──
  cleanRecentQuestions();
  let followUpNote = '';
  if (!ctx.preSearched) {
    const prior = _recentQuestions.get(senderJid);
    if (prior) {
      try {
        const isFollowUp = await classifyFollowUp(prior.combinedText, displayText);
        if (isFollowUp) {
          searchText = `${prior.combinedText}\n${searchText}`.slice(0, 2000);
          followUpNote = `\n\n_🔗 Follow-up to this user's previous message (ref: ${prior.lastQuestionId})_`;
          logger.info({ senderJid, priorQId: prior.lastQuestionId }, '🔗 Treating as follow-up — combining context for search');
        }
      } catch (err) {
        logger.warn({ err, senderJid }, 'Follow-up classification errored — treating as new question');
      }
    }
  }

  // ── Step 1: Semantic search (best-effort, failures are non-fatal) ───────────
  let topMatch: FatawaMatch | undefined = ctx.preSearched;
  if (!topMatch) {
    try {
      logger.info({ msgId }, '🔍 Searching fatawa KB…');
      const matches = await searchFatawa(searchText, { topN: 1, threshold: MED_CONFIDENCE });
      topMatch = matches[0];
      logger.info({ msgId, score: topMatch?.score, file: topMatch?.record?.audioFileName }, '🔍 Search complete');
    } catch (err) {
      logger.error({ err, msgId }, '⚠️  Fatawa KB search failed — continuing with no-match flow');
      topMatch = undefined;
    }
  }

  const rawText = displayText;

  // ── Step 2: Build the admin notification text ───────────────────────────────
  const qId = generateQuestionId();
  _recentQuestions.set(senderJid, { combinedText: searchText, lastQuestionId: qId, timestamp: Date.now() });

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
    const refs    = formatReferencesForWhatsApp(rec.authenticReferences);

    adminNotice =
      `🎤 *HIGH CONFIDENCE MATCH* (${pct}%)${label}\n\n` +
      `*❓ Question:*\n"${rawText}"\n` +
      `👤 _${senderName}_\n\n` +
      `*🎙️ Suggested Audio:* \`${audioFileName}\`\n` +
      `*📂 Topic:* ${rec.topic || 'General'}` +
      ruling +
      english +
      refs + `\n\n` +
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
    const refs    = formatReferencesForWhatsApp(rec.authenticReferences, 1);

    adminNotice =
      `⚠️ *POSSIBLE MATCH* (${pct}% confidence)\n\n` +
      `*❓ Question:*\n"${rawText}"\n` +
      `👤 _${senderName}_\n\n` +
      `*🎙️ Closest audio:* \`${audioFileName}\`\n` +
      `*📂 Topic:* ${rec.topic || 'General'}` +
      ruling +
      english +
      refs + `\n\n` +
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

  if (followUpNote) adminNotice += followUpNote;

  // ── Step 2.5: Auto-reply (if configured) ────────────────────────────────────
  // In 'auto'/'hybrid' modes, deliver a confident answer straight to the user
  // instead of routing it through Sheikh approval. Low-confidence questions
  // always fall through to the admin flow below.
  const replyMode = settings.replyMode ?? 'approval';
  const autoThreshold = settings.autoReplyThreshold ?? 0.72;
  if (
    replyMode !== 'approval' &&
    topMatch &&
    topMatch.score >= autoThreshold
  ) {
    const delivered = await autoReplyToUser(sock, msg, topMatch, publicGroupJid);
    if (delivered) {
      const pct = Math.round(topMatch.score * 100);
      logger.info({ msgId, score: topMatch.score, mode: replyMode }, '🤖 Auto-replied to user');

      // Record it as an approved/answered question (non-fatal)
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
          status:                 'approved',
        });
      } catch (err) {
        logger.warn({ err, qId }, 'Could not record auto-replied question');
      }

      // 'hybrid' → copy the Sheikh so nothing is answered silently
      if (replyMode === 'hybrid' && adminGroupJid) {
        try {
          await sock.sendMessage(adminGroupJid, {
            text:
              `🤖 *AUTO-REPLIED* (${pct}% match)\n\n` +
              `*❓ Question:*\n"${rawText}"\n` +
              `👤 _${senderName}_\n\n` +
              (audioFileName
                ? `*🎙️ Sent audio:* \`${audioFileName}\`\n`
                : `*📝 Sent text answer from KB*\n`) +
              `_No action needed — sent automatically._`,
          });
        } catch (err) {
          logger.warn({ err, qId }, 'Hybrid FYI to admin failed (non-fatal)');
        }
      }
      return; // done — skip the approval flow
    }
    // Not delivered (e.g. audio download failed) → fall through to admin approval
    logger.warn({ msgId }, 'Auto-reply could not be delivered — falling back to admin approval');
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

/**
 * Deliver a KB answer straight to the user (public group or DM), quoting their question.
 * Prefers the Sheikh's recorded audio; falls back to a text answer built from the record.
 * Returns true when something was actually sent.
 */
async function autoReplyToUser(
  sock: WASocket,
  msg: WAMessage,
  match: FatawaMatch,
  targetJid: string,
): Promise<boolean> {
  const rec = match.record;

  // 1) Preferred: forward the Sheikh's recorded audio fatwa
  if (rec.audioFileName) {
    try {
      const audioBuffer = await downloadAudioFile(rec.audioFileName);
      await sock.sendMessage(
        targetJid,
        { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true },
        { quoted: msg },
      );
      return true;
    } catch (err) {
      logger.error({ err, file: rec.audioFileName }, 'Auto-reply audio download/send failed');
      // fall through to text answer
    }
  }

  // 2) Fallback: build a text answer from the record
  const textAnswer = buildTextAnswer(rec);
  if (textAnswer) {
    try {
      await sock.sendMessage(targetJid, { text: textAnswer }, { quoted: msg });
      return true;
    } catch (err) {
      logger.error({ err }, 'Auto-reply text send failed');
    }
  }

  return false;
}

/** Compose a readable text answer from a KB record's available fields. */
function buildTextAnswer(rec: FatawaMatch['record']): string {
  const parts: string[] = [];
  if (rec.answerText && rec.answerText.trim()) {
    parts.push(rec.answerText.trim());
  } else if (rec.authenticRuling && rec.authenticRuling.trim()) {
    parts.push(`⚖️ ${rec.authenticRuling.trim()}`);
    if (rec.rulingKeyPoints && rec.rulingKeyPoints.trim()) {
      parts.push(rec.rulingKeyPoints.trim());
    }
  } else if (rec.englishTranslation && rec.englishTranslation.trim()) {
    parts.push(rec.englishTranslation.trim());
  }
  const refs = formatReferencesForWhatsApp(rec.authenticReferences, 1);
  if (refs) parts.push(refs.trim());
  return parts.join('\n\n');
}
