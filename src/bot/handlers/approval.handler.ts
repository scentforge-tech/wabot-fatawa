import {
  WASocket,
  WAMessage,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { env } from '../../config/env';
import logger from '../../config/logger';

// ─── Approval Handler ─────────────────────────────────────────────────────────
//
// Flow (simple):
//  1. Shaikh (Shakeel / Fareed) records a voice note in Islamic Bot (admin group)
//  2. Bot downloads Shaikh's voice note
//  3. Bot forwards it directly to Test Bot Public as a PTT voice note
//  4. Bot confirms to Islamic Bot that it was forwarded
//
// Shaikh should quote-reply to the specific question notification so the pilgrim
// answer is contextualised. If no quote context, the voice is still forwarded.
// ──────────────────────────────────────────────────────────────────────────────

export async function handleApprovalMessage(
  sock: WASocket,
  msg: WAMessage,
): Promise<void> {
  const msgId = msg.key.id ?? 'unknown';
  logger.info({ msgId }, 'Received voice note from Islamic Bot — forwarding to public group');

  // ── 1. Download Shaikh's voice note ──────────────────────────────────────
  let audioBuffer: Buffer;
  try {
    audioBuffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: logger as never, reuploadRequest: sock.updateMediaMessage },
    )) as Buffer;
  } catch (err) {
    logger.error({ err, msgId }, 'Failed to download Shaikh voice note');
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text: '⚠️ Failed to download voice note. Please try resending.',
    });
    return;
  }

  if (!audioBuffer || audioBuffer.length < 100) {
    logger.warn({ msgId, size: audioBuffer?.length }, 'Voice note too small — skipping');
    return;
  }

  // ── 2. Forward Shaikh's voice directly to public group ───────────────────
  try {
    await sock.sendMessage(
      env.PUBLIC_GROUP_JID,
      {
        audio: audioBuffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,   // Shows as voice note (push-to-talk) in WhatsApp
      },
    );

    logger.info({ msgId }, 'Shaikh voice note forwarded to public group');

    // ── 3. Confirm to Islamic Bot ────────────────────────────────────────────
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text: '✅ *Forwarded to Test Bot Public group.*',
    });

  } catch (err) {
    logger.error({ err, msgId }, 'Failed to forward Shaikh voice note to public group');
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text: `❌ Failed to forward to public group. Error: ${String(err)}`,
    });
  }
}
