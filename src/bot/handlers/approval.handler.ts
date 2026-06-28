import {
  WASocket,
  WAMessage,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { transcribeAudio } from '../../services/whisper.service';
import {
  getPendingDraft,
  deletePendingDraft,
  getMostRecentPendingDraft,
} from './audio.handler';
import { env } from '../../config/env';
import logger from '../../config/logger';

// ─── Keyword Detection ────────────────────────────────────────────────────────

const APPROVAL_KEYWORDS = [
  // Romanized / English
  'approve', 'approved', 'yes', 'correct', 'right', 'send it', 'send', 'go ahead',
  'haan', 'han', 'sahi hai', 'sahi he', 'sahih hai',
  'theek hai', 'theek he', 'thik hai', 'thik he', 'tik hai',
  'bilkul', 'bilkul sahi', 'bilkul theek',
  'ja sakta hai', 'bhej do', 'bhejen', 'munasib hai', 'ok', 'okay', 'achha', 'acha',
  // Urdu script (Arabic)
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
  // Hindi script (Devanagari)
  '\u0920\u0940\u0915 \u0939\u0948',       // ठीक है
  '\u0920\u0940\u0915',                    // ठीक
  '\u0939\u093E\u0901',                    // हाँ
  '\u092D\u0947\u091C\u094B',              // भेजो
  '\u092D\u0947\u091C \u0926\u094B',       // भेज दो
  '\u0938\u0939\u0940 \u0939\u0948',       // सही है
  '\u092C\u093F\u0932\u0915\u0941\u0932',  // बिलकुल
  '\u0905\u091A\u094D\u091B\u093E',        // अच्छा
  '\u091C\u0940',                          // जी
];

const REJECTION_KEYWORDS = [
  // Romanized / English
  'nahi', 'na', 'no', 'reject', 'galat', 'ghalat',
  'theek nahi', 'wapas lo', 'mat bhejo', 'rok lo',
  // Urdu script
  '\u0646\u06C1\u06CC\u06BA',              // نہیں
  '\u063A\u0644\u0637',                    // غلط
  '\u0679\u06BE\u06CC\u06A9 \u0646\u06C1\u06CC\u06BA',  // ٹھیک نہیں
  '\u0645\u062A \u0628\u06BE\u06CC\u062C\u0648', // مت بھیجو
  // Hindi script
  '\u0928\u0939\u0940\u0902',              // नहीं
  '\u0917\u0932\u0924',                    // गलत
  '\u092E\u0924 \u092D\u0947\u091C\u094B', // मत भेजो
  '\u0920\u0940\u0915 \u0928\u0939\u0940', // ठीक नही
];

function detectIntent(text: string): 'approved' | 'rejected' | 'unclear' {
  const n = text.toLowerCase().trim();
  for (const kw of REJECTION_KEYWORDS) if (n.includes(kw)) return 'rejected';
  for (const kw of APPROVAL_KEYWORDS) if (n.includes(kw)) return 'approved';
  return 'unclear';
}

// ─── Approval Handler ─────────────────────────────────────────────────────────
//
// VOICE NOTE from Islamic Bot:
//   → Transcribe it first
//   → If it contains approval/rejection keywords (e.g. "thik hai", "nahi")
//       → Act on the pending draft (send/discard)
//   → If it's a substantive answer (not just approval keywords)
//       → Forward the voice directly to the public group
//
// TEXT MESSAGE from Islamic Bot:
//   → Detect approval/rejection keywords and act on pending draft
//
// ─────────────────────────────────────────────────────────────────────────────

export async function handleApprovalMessage(
  sock: WASocket,
  msg: WAMessage,
): Promise<void> {
  const msgId = msg.key.id ?? 'unknown';
  const msgType = msg.message ? Object.keys(msg.message)[0] : 'unknown';
  logger.info({ msgId, msgType }, 'Received message from Islamic Bot');

  const isAudio =
    msgType === 'audioMessage' ||
    msgType === 'pttMessage' ||
    (msgType === 'documentMessage' &&
      (msg.message?.documentMessage?.mimetype ?? '').startsWith('audio/'));

  // ── CASE 1: Voice note ────────────────────────────────────────────────────
  if (isAudio) {
    // Download audio first
    let audioBuffer: Buffer;
    try {
      audioBuffer = (await downloadMediaMessage(
        msg, 'buffer', {},
        { logger: logger as never, reuploadRequest: sock.updateMediaMessage },
      )) as Buffer;
    } catch (err) {
      logger.error({ err, msgId }, 'Failed to download Shaikh voice note');
      await sock.sendMessage(env.ADMIN_GROUP_JID, { text: '⚠️ Failed to download voice note. Please resend.' });
      return;
    }

    if (!audioBuffer || audioBuffer.length < 100) {
      logger.warn({ msgId, size: audioBuffer?.length }, 'Voice note too small — skipping');
      return;
    }

    // Transcribe to understand intent
    let transcription = '';
    try {
      const result = await transcribeAudio(audioBuffer, 'approval.ogg', 'ur');
      transcription = result.text;
      logger.info({ transcription, msgId }, 'Shaikh voice transcribed');
    } catch (err) {
      logger.warn({ err, msgId }, 'Could not transcribe Shaikh voice — forwarding as-is');
      // If transcription fails, just forward the audio directly
      await forwardVoiceToPublic(sock, audioBuffer, msgId);
      return;
    }

    const intent = detectIntent(transcription);
    logger.info({ intent, transcription }, 'Intent from Shaikh voice');

    if (intent === 'approved') {
      // Shaikh said 'thik hai' / 'approve' → send draft to public
      await dispatchDraft(sock, msg, transcription);
    } else if (intent === 'rejected') {
      // Shaikh said 'nahi' / 'reject' → discard draft
      await rejectDraft(sock, msg, transcription);
    } else {
      // Unclear — do NOT auto-forward. Prompt Shaikh to clarify.
      logger.info({ msgId, transcription }, 'Unclear intent — prompting Shaikh for clarification');
      await sock.sendMessage(env.ADMIN_GROUP_JID, {
        text:
          `🤔 *Unclear response detected*\n\n` +
          `_Transcribed: "${transcription}"_\n\n` +
          `✅ Type or say *thik hai* to send the AI draft to the public group.\n` +
          `🎤 Record your own answer — it will be forwarded directly.\n` +
          `❌ Say *nahi* to discard the draft.`,
      });
    }
    return;
  }

  // ── CASE 2: Text message ──────────────────────────────────────────────────
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    '';

  if (!text) {
    logger.debug({ msgId, msgType }, 'No text content — skipping');
    return;
  }

  logger.info({ text, msgId }, 'Text message from Islamic Bot');
  const intent = detectIntent(text);

  if (intent === 'approved') {
    await dispatchDraft(sock, msg, text);
  } else if (intent === 'rejected') {
    await rejectDraft(sock, msg, text);
  } else {
    logger.debug({ text }, 'Unclear text from admin — no action');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function forwardVoiceToPublic(
  sock: WASocket,
  audioBuffer: Buffer,
  msgId: string,
): Promise<void> {
  try {
    await sock.sendMessage(env.PUBLIC_GROUP_JID, {
      audio: audioBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
    });
    logger.info({ msgId }, 'Shaikh voice forwarded to public group');
    await sock.sendMessage(env.ADMIN_GROUP_JID, { text: '✅ *Voice answer forwarded to Test Bot Public.*' });
  } catch (err) {
    logger.error({ err, msgId }, 'Failed to forward voice');
    await sock.sendMessage(env.ADMIN_GROUP_JID, { text: `❌ Forward failed: ${String(err)}` });
  }
}

async function dispatchDraft(
  sock: WASocket,
  msg: WAMessage,
  transcription: string,
): Promise<void> {
  const msgId = msg.key.id ?? 'unknown';

  // Find pending draft — quoted context first, then most recent
  const quotedMsgId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId ??
    msg.message?.audioMessage?.contextInfo?.stanzaId ?? undefined;

  const pendingDraft = quotedMsgId
    ? getPendingDraft(quotedMsgId)
    : getMostRecentPendingDraft();

  if (!pendingDraft) {
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text:
        `✅ Approval received but no pending draft found.\n\n` +
        `_To forward an answer, record a voice note in this group — it will be sent to the pilgrims automatically._`,
    });
    return;
  }

  // Send draft as text to public group (TTS unavailable)
  try {
    await sock.sendMessage(env.PUBLIC_GROUP_JID, {
      text: pendingDraft.draftText,
    });
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text:
        `✅ *Answer sent to Test Bot Public.*\n\n` +
        `_Q: "${pendingDraft.originalQuestion}"_\n` +
        `_Shaikh approved: "${transcription}"_`,
    });
    if (quotedMsgId) deletePendingDraft(quotedMsgId);
    logger.info({ msgId }, 'Draft dispatched to public group after Shaikh approval');
  } catch (err) {
    logger.error({ err }, 'Failed to send draft to public group');
    await sock.sendMessage(env.ADMIN_GROUP_JID, { text: `❌ Send failed: ${String(err)}` });
  }
}

async function rejectDraft(
  sock: WASocket,
  msg: WAMessage,
  transcription: string,
): Promise<void> {
  const quotedMsgId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId ??
    msg.message?.audioMessage?.contextInfo?.stanzaId ?? undefined;

  const pendingDraft = quotedMsgId
    ? getPendingDraft(quotedMsgId)
    : getMostRecentPendingDraft();

  if (pendingDraft) {
    if (quotedMsgId) deletePendingDraft(quotedMsgId);
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text:
        `🚫 *Draft discarded.*\n` +
        `_Q: "${pendingDraft.originalQuestion}"_\n` +
        `_Shaikh: "${transcription}"_`,
    });
  } else {
    await sock.sendMessage(env.ADMIN_GROUP_JID, { text: '🚫 No pending draft to reject.' });
  }
}
