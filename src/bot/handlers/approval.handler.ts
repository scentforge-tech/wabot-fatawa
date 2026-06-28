import {
  WASocket,
  WAMessage,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
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
  'nahi', 'na', 'no', 'reject', 'galat', 'ghalat', 'theek nahi', 'wapas lo', 'mat bhejo', 'rok lo',
];

function detectIntent(text: string): 'approved' | 'rejected' | 'unclear' {
  const n = text.toLowerCase().trim();
  for (const kw of REJECTION_KEYWORDS) if (n.includes(kw)) return 'rejected';
  for (const kw of APPROVAL_KEYWORDS) if (n.includes(kw)) return 'approved';
  return 'unclear';
}

// ─── Approval Handler ─────────────────────────────────────────────────────────

export async function handleApprovalMessage(
  sock: WASocket,
  msg: WAMessage,
): Promise<void> {
  const msgId = msg.key.id ?? 'unknown';
  const msgType = msg.message ? Object.keys(msg.message)[0] : 'unknown';
  logger.info({ msgId, msgType }, 'Received message from Islamic Bot');

  // ── CASE 1: Voice note → forward directly to public group ─────────────────
  const isAudio =
    msgType === 'audioMessage' ||
    msgType === 'pttMessage' ||
    (msgType === 'documentMessage' &&
      (msg.message?.documentMessage?.mimetype ?? '').startsWith('audio/'));

  if (isAudio) {
    logger.info({ msgId }, 'Shaikh voice note — forwarding to public group');
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

    try {
      await sock.sendMessage(env.PUBLIC_GROUP_JID, {
        audio: audioBuffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
      });
      logger.info({ msgId }, 'Shaikh voice forwarded to public group');
      await sock.sendMessage(env.ADMIN_GROUP_JID, { text: '✅ *Forwarded to Test Bot Public.*' });
    } catch (err) {
      logger.error({ err, msgId }, 'Failed to forward voice to public group');
      await sock.sendMessage(env.ADMIN_GROUP_JID, { text: `❌ Forward failed: ${String(err)}` });
    }
    return;
  }

  // ── CASE 2: Text message → check for approval/rejection keywords ───────────
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
  logger.info({ intent }, 'Intent detected');

  // Find pending draft — first try quoted context, then most recent
  const quotedMsgId =
    msg.message?.extendedTextMessage?.contextInfo?.stanzaId ?? undefined;

  const pendingDraft = quotedMsgId
    ? getPendingDraft(quotedMsgId)
    : getMostRecentPendingDraft();

  if (intent === 'approved') {
    if (!pendingDraft) {
      await sock.sendMessage(env.ADMIN_GROUP_JID, {
        text:
          `✅ Approval received but no pending draft found.\n\n` +
          `_To forward an answer, record a voice note in this group — it will be sent to the pilgrims automatically._`,
      });
      return;
    }

    // Send draft as TEXT to public group (TTS unavailable)
    try {
      await sock.sendMessage(env.PUBLIC_GROUP_JID, {
        text: pendingDraft.draftText,
      });
      await sock.sendMessage(env.ADMIN_GROUP_JID, {
        text: `✅ *Answer sent to Test Bot Public.*\n\n_Q: "${pendingDraft.originalQuestion}"_`,
      });
      if (quotedMsgId) deletePendingDraft(quotedMsgId);
      logger.info({ msgId }, 'Draft text dispatched to public group');
    } catch (err) {
      logger.error({ err }, 'Failed to send draft to public group');
      await sock.sendMessage(env.ADMIN_GROUP_JID, { text: `❌ Send failed: ${String(err)}` });
    }

  } else if (intent === 'rejected') {
    if (pendingDraft) {
      if (quotedMsgId) deletePendingDraft(quotedMsgId);
      await sock.sendMessage(env.ADMIN_GROUP_JID, {
        text: `🚫 *Draft discarded.*\n_Q: "${pendingDraft.originalQuestion}"_`,
      });
    } else {
      await sock.sendMessage(env.ADMIN_GROUP_JID, { text: '🚫 No pending draft to reject.' });
    }

  } else {
    // Unclear — don't do anything, let Shaikh type or record naturally
    logger.debug({ text }, 'Unclear text from admin — no action');
  }
}
