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
  'approve', 'approved', 'yes', 'correct', 'right', 'send it', 'send', 'go ahead',
  'haan', 'han', 'sahi hai', 'sahi he', 'sahih hai',
  'theek hai', 'theek he', 'thik hai', 'thik he', 'tik hai',
  'bilkul', 'bilkul sahi', 'bilkul theek',
  'ja sakta hai', 'bhej do', 'bhejen', 'munasib hai', 'ok', 'okay',
];

const REJECTION_KEYWORDS = [
  'nahi', 'na', 'no', 'reject', 'galat', 'ghalat',
  'theek nahi', 'wapas lo', 'mat bhejo', 'rok lo',
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
      // Shaikh said "thik hai" / "approve" → send draft to public
      await dispatchDraft(sock, msg, transcription);
    } else if (intent === 'rejected') {
      // Shaikh said "nahi" / "reject" → discard draft
      await rejectDraft(sock, msg, transcription);
    } else {
      // Substantive answer — forward Shaikh's voice directly to public
      logger.info({ msgId }, 'Substantive answer — forwarding voice to public group');
      await forwardVoiceToPublic(sock, audioBuffer, msgId);
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
