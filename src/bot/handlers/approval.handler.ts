import {
  WASocket,
  WAMessage,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { transcribeAudio } from '../../services/whisper.service';
import { textToSpeech } from '../../services/tts.service';
import {
  getPendingDraft,
  deletePendingDraft,
} from './audio.handler';
import { env } from '../../config/env';
import logger from '../../config/logger';

// ─── Approval Keyword Detection ───────────────────────────────────────────────

/**
 * Keywords in Urdu, Hinglish, and English that indicate the Shaikh has
 * approved the drafted answer. Case-insensitive matching.
 */
const APPROVAL_KEYWORDS = [
  // English
  'approve',
  'approved',
  'yes',
  'correct',
  'right',
  'send it',
  'send',
  'go ahead',
  // Urdu / Hinglish
  'haan',                // Yes (Urdu/Hindi)
  'han',                 // Common alternate spelling
  'sahi hai',            // That is correct
  'sahi he',
  'sahih hai',
  'theek hai',           // It is fine
  'theek he',
  'thik hai',
  'bilkul',              // Absolutely
  'bilkul sahi',
  'bilkul theek',
  'ja sakta hai',        // It can be sent
  'bhej do',             // Send it
  'bhejen',
  'munasib hai',         // It is appropriate
];

/**
 * Keywords that indicate rejection.
 */
const REJECTION_KEYWORDS = [
  'nahi',
  'na',
  'no',
  'reject',
  'galat',               // Wrong
  'ghalat',
  'theek nahi',          // Not correct
  'wapas lo',            // Take it back
  'mat bhejo',           // Don't send
  'rok lo',              // Stop it
];

function detectApproval(text: string): 'approved' | 'rejected' | 'unclear' {
  const normalized = text.toLowerCase().trim();

  // Check rejection first (more specific)
  for (const kw of REJECTION_KEYWORDS) {
    if (normalized.includes(kw)) return 'rejected';
  }
  for (const kw of APPROVAL_KEYWORDS) {
    if (normalized.includes(kw)) return 'approved';
  }
  return 'unclear';
}

// ─── Approval Handler ─────────────────────────────────────────────────────────

/**
 * Handles incoming audio/PTT messages from the admin group (Shaikh's replies).
 *
 * Flow:
 *  1. Transcribe Shaikh's voice reply with Whisper
 *  2. Detect approval/rejection keywords
 *  3. If approved: find the corresponding cached draft, TTS-convert, dispatch to public group as PTT
 *  4. If rejected: notify admin that the draft was rejected
 *  5. If unclear: notify admin that the system couldn't understand the reply
 *
 * The system identifies which draft to dispatch by looking at the message's
 * `quoted` context (the admin message that was originally sent).
 */
export async function handleApprovalMessage(
  sock: WASocket,
  msg: WAMessage,
): Promise<void> {
  const msgId = msg.key.id ?? 'unknown';
  logger.info({ msgId }, 'Received potential approval message from admin group');

  // ── 1. Download Shaikh's audio ────────────────────────────────────────────
  let audioBuffer: Buffer;
  try {
    audioBuffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: logger as never, reuploadRequest: sock.updateMediaMessage },
    )) as Buffer;
  } catch (err) {
    logger.error({ err, msgId }, 'Failed to download approval audio');
    return;
  }

  // ── 2. Transcribe with Whisper ────────────────────────────────────────────
  let transcription: string;
  try {
    const result = await transcribeAudio(audioBuffer, 'approval.ogg', 'ur');
    transcription = result.text;
    logger.info({ transcription, msgId }, 'Shaikh approval transcribed');
  } catch (err) {
    logger.error({ err, msgId }, 'Whisper failed to transcribe approval message');
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text: '⚠️ Could not transcribe Shaikh\'s voice reply. Please resend or type the approval.',
    });
    return;
  }

  // ── 3. Detect approval intent ─────────────────────────────────────────────
  const intent = detectApproval(transcription);
  logger.info({ intent, transcription, msgId }, 'Approval intent detected');

  // ── 4. Find the referenced pending draft ──────────────────────────────────
  // The Shaikh's reply may quote the original admin group message.
  // We search the pending draft cache by the quoted message ID.
  const quotedMsgId: string | undefined =
    msg.message?.extendedTextMessage?.contextInfo?.stanzaId ??
    msg.message?.audioMessage?.contextInfo?.stanzaId ??
    undefined;

  let pendingDraft = quotedMsgId ? getPendingDraft(quotedMsgId) : undefined;

  // Fallback: find the most recent pending draft if no quoted context
  if (!pendingDraft) {
    logger.warn(
      { msgId, quotedMsgId },
      'No quoted context on approval — will attempt to match most recent pending draft',
    );
    // This is a best-effort fallback — in practice the Shaikh should quote-reply
    // We don't auto-dispatch without a confirmed match to prevent wrong deliveries
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text:
        `⚠️ *Cannot match approval to a specific draft.*\n\n` +
        `Transcribed: _"${transcription}"_\n\n` +
        `Please *quote-reply* to the specific draft audio message you are approving.`,
    });
    return;
  }

  if (intent === 'approved') {
    // ── 5a. Dispatch approved answer as PTT to public group ──────────────────
    logger.info(
      {
        quotedMsgId,
        publicGroupJid: pendingDraft.publicGroupJid,
        userJid: pendingDraft.userJid,
      },
      'Shaikh approved — dispatching answer to public group',
    );

    try {
      // Re-generate TTS (the cached draft text is the source of truth)
      const ttsBuffer = await textToSpeech(pendingDraft.draftText);

      // Build context for quoted reply (reply to original user message)
      const quoteContext = pendingDraft.publicMsgId
        ? {
            quoted: {
              key: {
                remoteJid: pendingDraft.publicGroupJid,
                id: pendingDraft.publicMsgId,
                participant: pendingDraft.userJid,
              },
              message: { conversation: pendingDraft.originalQuestion },
            },
          }
        : {};

      // Send as native PTT voice note
      await sock.sendMessage(
        pendingDraft.publicGroupJid,
        {
          audio: ttsBuffer,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true, // Push-to-talk — displayed as voice note in WhatsApp
        },
        quoteContext,
      );

      // Confirm dispatch to admin
      await sock.sendMessage(env.ADMIN_GROUP_JID, {
        text:
          `✅ *Answer dispatched to public group*\n\n` +
          `*Original Question:* "${pendingDraft.originalQuestion}"\n` +
          `*Confidence Score:* ${pendingDraft.compositeScore.toFixed(3)}\n` +
          `*Answer Type:* ${pendingDraft.draftType}\n\n` +
          `_Shaikh's approval: "${transcription}"_`,
      });

      deletePendingDraft(quotedMsgId!);
      logger.info({ quotedMsgId }, 'Draft delivered and removed from cache');
    } catch (err) {
      logger.error({ err, quotedMsgId }, 'Failed to dispatch approved answer');
      await sock.sendMessage(env.ADMIN_GROUP_JID, {
        text: `❌ *Dispatch failed.* Please retry or send manually.\nError: ${String(err)}`,
      });
    }
  } else if (intent === 'rejected') {
    // ── 5b. Handle rejection ──────────────────────────────────────────────────
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text:
        `🚫 *Draft Rejected*\n\n` +
        `*Transcribed reply:* "${transcription}"\n` +
        `*Question:* "${pendingDraft.originalQuestion}"\n\n` +
        `The draft has been discarded. Please address the question manually if needed.`,
    });
    deletePendingDraft(quotedMsgId!);
    logger.info({ quotedMsgId }, 'Draft rejected and removed from cache');
  } else {
    // ── 5c. Unclear — ask for clarification ───────────────────────────────────
    await sock.sendMessage(env.ADMIN_GROUP_JID, {
      text:
        `🤔 *Unclear Response*\n\n` +
        `Transcribed: _"${transcription}"_\n\n` +
        `The system could not determine approval or rejection from this reply.\n` +
        `Please reply with: *Approve / Haan / Sahi hai* (to approve) or *Reject / Nahi / Galat* (to reject).`,
    });
  }
}
