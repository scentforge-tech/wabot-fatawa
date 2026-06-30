import {
  WASocket,
  WAMessage,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import {
  getPendingByAdminMsgId,
  getMostRecentPending,
  updatePendingStatus,
  downloadAudioFile,
} from '../../services/fatawa-kb.service';
import { transcribeAudio } from '../../services/whisper.service';
import { getGroupSettings } from '../../services/settings.service';
import { env } from '../../config/env';
import logger from '../../config/logger';

// ─── Keyword Detection ────────────────────────────────────────────────────────

const APPROVAL_KEYWORDS = [
  'approve', 'approved', 'yes', 'correct', 'right', 'send it', 'send', 'go ahead',
  'haan', 'han', 'sahi hai', 'sahi he', 'sahih hai',
  'theek hai', 'theek he', 'thik hai', 'thik he', 'tik hai',
  'bilkul', 'bilkul sahi', 'bilkul theek',
  'ja sakta hai', 'bhej do', 'bhejen', 'munasib hai', 'ok', 'okay', 'achha', 'acha',
  '\u0679\u06BE\u06CC\u06A9 \u06C1\u06D2',   // ٹھیک ہے
  '\u0679\u06BE\u06CC\u06A9',               // ٹھیک
  '\u06C1\u0627\u06BA',                    // ہاں
  '\u062C\u06CC \u06C1\u0627\u06BA',       // جی ہاں
  '\u0628\u06BE\u06CC\u062C \u062F\u0648',  // بھیج دو
  '\u0628\u06BE\u06CC\u062C\u0648',        // بھیجو
  '\u0635\u062D\u06CC\u062D \u06C1\u06D2',  // صحیح ہے
  '\u0628\u0627\u0644\u06A9\u0644',        // بالکل
  '\u0627\u0686\u06BE\u0627',              // اچھا
  '\u062C\u06CC',                          // جی
  '\u0920\u0940\u0915 \u0939\u0948',       // ठीक है
  '\u0920\u0940\u0915',                    // ठीक
  '\u0939\u093E\u0901',                    // हाँ
  '\u092D\u0947\u091C\u094B',              // भेजो
];

const REJECTION_KEYWORDS = [
  'nahi', 'na', 'no', 'reject', 'galat', 'ghalat',
  'theek nahi', 'wapas lo', 'mat bhejo', 'rok lo',
  '\u0646\u06C1\u06CC\u06BA',              // نہیں
  '\u063A\u0644\u0637',                    // غلط
  '\u0679\u06BE\u06CC\u06A9 \u0646\u06C1\u06CC\u06BA',  // ٹھیک نہیں
  '\u0645\u062A \u0628\u06BE\u06CC\u062C\u0648', // مت بھیجو
  '\u0928\u0939\u0940\u0902',              // नहीं
  '\u0917\u0932\u0924',                    // गलत
];

function detectIntent(text: string): 'approved' | 'rejected' | 'unclear' {
  const n = text.toLowerCase().trim();
  for (const kw of REJECTION_KEYWORDS) if (n.includes(kw)) return 'rejected';
  for (const kw of APPROVAL_KEYWORDS)  if (n.includes(kw)) return 'approved';
  return 'unclear';
}

// ─── Approval Handler ─────────────────────────────────────────────────────────
//
// When admin sends a message in the admin group:
//
// CASE A — Voice note (Shaikh's own answer):
//   • Transcribe to detect intent
//   • If "thik hai" → dispatch PENDING audio from GCS to public group
//   • If new substantive answer → forward that voice directly to public group
//
// CASE B — Text message:
//   • Detect "thik hai" / "nahi"
//   • Act on the most-recently-forwarded pending question
//
// On approval: quote the user's original message when sending to public group
//
// ─────────────────────────────────────────────────────────────────────────────

export async function handleApprovalMessage(
  sock: WASocket,
  msg: WAMessage,
): Promise<void> {
  const msgId   = msg.key.id ?? 'unknown';
  const msgType = msg.message ? Object.keys(msg.message)[0] : 'unknown';
  logger.info({ msgId, msgType }, 'Message from admin group');

  const isAudio =
    msgType === 'audioMessage' ||
    msgType === 'pttMessage' ||
    (msgType === 'documentMessage' &&
      (msg.message?.documentMessage?.mimetype ?? '').startsWith('audio/'));

  // Get live JIDs from settings (set from dashboard, stored in Firestore)
  const { adminGroupJid } = getGroupSettings();
  const adminJid = adminGroupJid || env.ADMIN_GROUP_JID;

  // ── CASE A: Voice note ────────────────────────────────────────────────────
  if (isAudio) {
    let audioBuffer: Buffer;
    try {
      audioBuffer = (await downloadMediaMessage(
        msg, 'buffer', {},
        { logger: logger as never, reuploadRequest: sock.updateMediaMessage },
      )) as Buffer;
    } catch (err) {
      logger.error({ err, msgId }, 'Failed to download admin voice note');
      await sock.sendMessage(adminJid || env.ADMIN_GROUP_JID, { text: '⚠️ Failed to download voice note. Please resend.' });
      return;
    }

    if (!audioBuffer || audioBuffer.length < 100) return;

    // Transcribe to detect intent
    let transcription = '';
    try {
      const result = await transcribeAudio(audioBuffer, 'admin.ogg', 'ur');
      transcription = result.text;
      logger.info({ transcription, msgId }, 'Admin voice transcribed');
    } catch (err) {
      logger.warn({ err }, 'Transcription failed — forwarding voice directly');
      await forwardVoiceToPublic(sock, audioBuffer, msg, msgId);
      return;
    }

    const intent = detectIntent(transcription);

    if (intent === 'approved') {
      await dispatchPendingAudio(sock, msg, transcription);
    } else if (intent === 'rejected') {
      await rejectPending(sock, msg, transcription);
    } else {
      // Shaikh recorded a new substantive answer — forward it directly
      logger.info({ msgId, transcription }, 'New voice answer from Shaikh — forwarding directly');
      await forwardVoiceToPublic(sock, audioBuffer, msg, msgId);
    }
    return;
  }

  // ── CASE B: Text message ──────────────────────────────────────────────────
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    '';

  if (!text) return;

  logger.info({ text, msgId }, 'Text message from admin group');
  const intent = detectIntent(text);

  if (intent === 'approved') {
    await dispatchPendingAudio(sock, msg, text);
  } else if (intent === 'rejected') {
    await rejectPending(sock, msg, text);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findPendingForMsg(msg: WAMessage) {
  // Try quoted message first
  const quotedId =
    msg.message?.extendedTextMessage?.contextInfo?.stanzaId ??
    msg.message?.audioMessage?.contextInfo?.stanzaId ??
    undefined;

  if (quotedId) {
    const byQuote = await getPendingByAdminMsgId(quotedId);
    if (byQuote) return byQuote;
  }

  // Fall back to most recent pending
  return getMostRecentPending();
}

/**
 * Send the matched Sheikh audio file (from GCS) to the public group,
 * quoting the user's original message.
 */
async function dispatchPendingAudio(
  sock: WASocket,
  msg: WAMessage,
  approvalText: string,
): Promise<void> {
  const { adminGroupJid: aJid, publicGroupJid: pJid } = getGroupSettings();
  const adminJid = aJid || env.ADMIN_GROUP_JID;

  const pending = await findPendingForMsg(msg);

  if (!pending) {
    await sock.sendMessage(adminJid, {
      text:
        `✅ Approval received but no pending question found.\n\n` +
        `_To send an answer: record a voice note — it will be forwarded automatically._`,
    });
    return;
  }

  const publicGroupJid = pending.publicGroupJid || pJid || env.PUBLIC_GROUP_JID;

  // If there's a suggested audio file → download from GCS and send
  if (pending.suggestedAudioFileName) {
    let audioBuffer: Buffer;
    try {
      audioBuffer = await downloadAudioFile(pending.suggestedAudioFileName);
    } catch (err) {
      logger.error({ err, file: pending.suggestedAudioFileName }, 'GCS download failed');
      await sock.sendMessage(adminJid, {
        text: `❌ Failed to download audio file \`${pending.suggestedAudioFileName}\` from GCS.\n\nError: ${String(err)}`,
      });
      return;
    }

    try {
      // Send Sheikh audio quoting the user's original message
      await sock.sendMessage(
        publicGroupJid,
        {
          audio: audioBuffer,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,  // voice note style
        },
        {
          quoted: {
            key: {
              remoteJid: publicGroupJid,
              id:        pending.quotedMessageId,
              fromMe:    false,
              participant: pending.senderJid,
            },
            message: {
              conversation: pending.questionText,
            },
          },
        },
      );

      await updatePendingStatus(pending.questionId, 'approved');
      await sock.sendMessage(env.ADMIN_GROUP_JID, {
        text:
          `✅ *Audio answer sent to public group*\n\n` +
          `*Q:* "${pending.questionText}"\n` +
          `*File:* \`${pending.suggestedAudioFileName}\`\n` +
          `*Approved:* "${approvalText}"`,
      });
      logger.info(
        { questionId: pending.questionId, file: pending.suggestedAudioFileName },
        '✅ Sheikh audio dispatched to public group',
      );
    } catch (err) {
      logger.error({ err }, 'Failed to send audio to public group');
      await sock.sendMessage(env.ADMIN_GROUP_JID, {
        text: `❌ Failed to send audio to public group: ${String(err)}`,
      });
    }
    return;
  }

  // No audio file (manual-only question) — inform admin
  await sock.sendMessage(env.ADMIN_GROUP_JID, {
    text:
      `✅ Approval noted for:\n"${pending.questionText}"\n\n` +
      `⚠️ No audio file was found for this question. Please record a voice note to answer.`,
  });
}

async function rejectPending(
  sock: WASocket,
  msg: WAMessage,
  _rejectionText: string,
): Promise<void> {
  const pending = await findPendingForMsg(msg);

  if (pending) {
    await updatePendingStatus(pending.questionId, 'rejected');
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text:
        `🚫 *Suggestion rejected.*\n` +
        `*Q:* "${pending.questionText}"\n` +
        `🎤 Please record your own voice answer — it will be forwarded automatically.`,
    });
  } else {
    await sock.sendMessage(env.ADMIN_GROUP_JID, { text: '🚫 No pending question to reject.' });
  }
}

async function forwardVoiceToPublic(
  sock: WASocket,
  audioBuffer: Buffer,
  msg: WAMessage,
  _msgId: string,
): Promise<void> {
  // Find the pending question so we can quote the user
  const pending = await findPendingForMsg(msg);
  const publicGroupJid = pending?.publicGroupJid ?? env.PUBLIC_GROUP_JID;

  const sendOptions = pending
    ? {
        quoted: {
          key: {
            remoteJid: publicGroupJid,
            id:        pending.quotedMessageId,
            fromMe:    false,
            participant: pending.senderJid,
          },
          message: { conversation: pending.questionText },
        },
      }
    : undefined;

  try {
    await sock.sendMessage(
      publicGroupJid,
      { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true },
      sendOptions,
    );

    if (pending) {
      await updatePendingStatus(pending.questionId, 'approved');
    }

    logger.info({ _msgId }, '🎤 Admin voice forwarded to public group');
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text: '✅ *Voice answer forwarded to public group.*',
    });
  } catch (err) {
    logger.error({ err }, 'Failed to forward admin voice');
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text: `❌ Forward failed: ${String(err)}`,
    });
  }
}
