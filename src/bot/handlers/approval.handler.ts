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
  selfTrainFromAnswer,
  PendingQuestion,
} from '../../services/fatawa-kb.service';
import { getGroupSettings } from '../../services/settings.service';
import { transcribeAudio } from '../../services/whisper.service';
import { env } from '../../config/env';
import logger from '../../config/logger';

// ─── Intent Detection ─────────────────────────────────────────────────────────
//
// COMMANDS (Sheikh sends in admin group):
//   Y / yes / thik hai / ha → APPROVE: send suggested audio to public group
//   N / no / nahi / galat   → REJECT: discard suggestion, ask Sheikh to record
//   A / rec / record        → ACKNOWLEDGE: waiting for Sheikh's voice note now
//   (any other text)        → SEND TEXT: send that text as answer to public group
//   (voice note)            → FORWARD: forward voice to public group, quoting question
//
// ─────────────────────────────────────────────────────────────────────────────

const Y_PATTERNS = /^(y|yes|ha|haan|han|ok|okay|ji|thik hai?|theek hai?|sahi|sahi hai|bilkul|acha|achha|send|bhej|bhejen|bhejdo|approve|approved|صحیح|ٹھیک|ہاں|جی|بھیج|بالکل|اچھا)$/i;
const N_PATTERNS = /^(n|no|nahi|na|nahi|reject|galat|ghalat|rok|mat bhejo|نہیں|غلط|مت)$/i;
const A_PATTERNS = /^(a|rec|record|ab bolun|main bolun|awaiting|wait|aata hun)$/i;

type Intent = 'approve' | 'reject' | 'await_voice' | 'send_text';

function detectIntent(text: string): Intent {
  const t = text.trim();
  const single = t.replace(/[.!?،۔]/g, '').trim();
  if (Y_PATTERNS.test(single)) return 'approve';
  if (N_PATTERNS.test(single)) return 'reject';
  if (A_PATTERNS.test(single)) return 'await_voice';
  return 'send_text';
}

// ─── State: waiting for Sheikh's voice after 'A' ──────────────────────────────
// Maps adminGroupJid → questionId being awaited
const _awaitingVoice = new Map<string, string>();

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function handleApprovalMessage(
  sock: WASocket,
  msg: WAMessage,
): Promise<void> {
  const msgId   = msg.key.id ?? 'unknown';
  const msgType = msg.message ? Object.keys(msg.message)[0] : 'unknown';

  const { adminGroupJid: aJid, publicGroupJid: pJid } = getGroupSettings();
  const adminJid  = aJid  || env.ADMIN_GROUP_JID || '';
  const publicJid = pJid  || env.PUBLIC_GROUP_JID || '';

  logger.info({ msgId, msgType }, '📨 Admin group message');

  const isAudio =
    msgType === 'audioMessage' ||
    msgType === 'pttMessage' ||
    (msgType === 'documentMessage' &&
      (msg.message?.documentMessage?.mimetype ?? '').startsWith('audio/'));

  // ── CASE A: Voice note from Sheikh ────────────────────────────────────────
  if (isAudio) {
    let audioBuffer: Buffer;
    try {
      audioBuffer = (await downloadMediaMessage(
        msg, 'buffer', {},
        { logger: logger as never, reuploadRequest: sock.updateMediaMessage },
      )) as Buffer;
    } catch (err) {
      logger.error({ err, msgId }, 'Failed to download admin voice note');
      await safeSend(sock, adminJid, { text: '⚠️ Failed to download voice note. Please resend.' });
      return;
    }

    if (!audioBuffer || audioBuffer.length < 100) return;

    // Find pending question (prefer quoted, else most recent)
    const pending = await findPendingForMsg(msg);
    const targetPublicJid = pending?.publicGroupJid || publicJid;

    // Forward voice to public group, quoting the original question
    await forwardVoiceToPublic(sock, audioBuffer, msg, msgId, pending, adminJid, targetPublicJid);
    return;
  }

  // ── CASE B: Text message from Sheikh ──────────────────────────────────────
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    '';

  if (!text) return;

  const intent = detectIntent(text);
  logger.info({ text, intent, msgId }, '🔎 Admin intent detected');

  // Find the pending question this message refers to
  const pending = await findPendingForMsg(msg);
  const targetPublicJid = pending?.publicGroupJid || publicJid;

  switch (intent) {
    // ── Y: APPROVE — send the suggested audio from KB ───────────────────────
    case 'approve':
      await dispatchSuggestedAudio(sock, msg, pending, adminJid, targetPublicJid);
      break;

    // ── N: REJECT — discard, ask for voice ──────────────────────────────────
    case 'reject':
      await handleReject(sock, pending, adminJid);
      break;

    // ── A: ACKNOWLEDGE — Sheikh will send voice next ─────────────────────────
    case 'await_voice':
      if (pending) {
        _awaitingVoice.set(adminJid, pending.questionId);
        await safeSend(sock, adminJid, {
          text:
            `🎙️ *Ready — send your voice note now.*\n\n` +
            `*Q:* "${pending.questionText}"\n` +
            `👤 _${pending.senderName ?? 'pilgrim'}_\n\n` +
            `Your voice will be forwarded to the pilgrim's group automatically.`,
        });
      } else {
        await safeSend(sock, adminJid, {
          text: `🎙️ Ready — send your voice note. It will be forwarded to the public group.`,
        });
      }
      break;

    // ── Any other text: send AS the text answer to public group ──────────────
    case 'send_text':
      await sendTextAnswerToPublic(sock, text, pending, adminJid, targetPublicJid);
      break;
  }
}

// ─── Send suggested KB audio to public group ──────────────────────────────────

async function dispatchSuggestedAudio(
  sock: WASocket,
  _msg: WAMessage,
  pending: PendingQuestion | null,
  adminJid: string,
  publicGroupJid: string,
): Promise<void> {
  if (!pending) {
    await safeSend(sock, adminJid, {
      text:
        `✅ Approved — but no pending question found.\n\n` +
        `🎤 Record a voice note to answer manually.`,
    });
    return;
  }

  if (!pending.suggestedAudioFileName) {
    // No KB match — tell Sheikh to record voice
    await safeSend(sock, adminJid, {
      text:
        `✅ Noted — but no audio file exists for this question.\n\n` +
        `*Q:* "${pending.questionText}"\n\n` +
        `🎤 Please record a voice answer — it will be forwarded automatically.`,
    });
    return;
  }

  // Download audio from GCS
  let audioBuffer: Buffer;
  try {
    audioBuffer = await downloadAudioFile(pending.suggestedAudioFileName);
  } catch (err) {
    logger.error({ err, file: pending.suggestedAudioFileName }, 'GCS download failed');
    await safeSend(sock, adminJid, {
      text: `❌ Could not download audio file \`${pending.suggestedAudioFileName}\`\n\nError: ${String(err)}\n\n🎤 Please record your own voice answer.`,
    });
    return;
  }

  // Send to public group, quoting the pilgrim's original question
  try {
    await sock.sendMessage(
      publicGroupJid,
      {
        audio: audioBuffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
      },
      {
        quoted: buildQuoteRef(publicGroupJid, pending),
      },
    );

    await updatePendingStatus(pending.questionId, 'approved');

    await safeSend(sock, adminJid, {
      text:
        `✅ *Audio answer sent to public group*\n\n` +
        `*Q:* "${pending.questionText}"\n` +
        `*File:* \`${pending.suggestedAudioFileName}\``,
    });

    logger.info({ questionId: pending.questionId, file: pending.suggestedAudioFileName }, '✅ KB audio dispatched to public group');
  } catch (err) {
    logger.error({ err }, 'Failed to send audio to public group');
    await safeSend(sock, adminJid, { text: `❌ Failed to send audio to public group: ${String(err)}` });
  }
}

// ─── Handle rejection ─────────────────────────────────────────────────────────

async function handleReject(
  sock: WASocket,
  pending: PendingQuestion | null,
  adminJid: string,
): Promise<void> {
  if (pending) {
    await updatePendingStatus(pending.questionId, 'rejected');
    await safeSend(sock, adminJid, {
      text:
        `🚫 *Suggestion rejected.*\n\n` +
        `*Q:* "${pending.questionText}"\n\n` +
        `🎤 Send your own voice answer — it will go to the pilgrim automatically.\n` +
        `📝 Or type *A* then record your voice.\n` +
        `📝 Or send any text message to send a text reply.`,
    });
  } else {
    await safeSend(sock, adminJid, { text: '🚫 No pending question found to reject.' });
  }
}

// ─── Send text answer to public group ────────────────────────────────────────

async function sendTextAnswerToPublic(
  sock: WASocket,
  answerText: string,
  pending: PendingQuestion | null,
  adminJid: string,
  publicGroupJid: string,
): Promise<void> {
  if (!publicGroupJid) {
    await safeSend(sock, adminJid, { text: '❌ Public group not configured. Set it in the dashboard.' });
    return;
  }

  try {
    const sendOptions = pending
      ? { quoted: buildQuoteRef(publicGroupJid, pending) }
      : undefined;

    await sock.sendMessage(
      publicGroupJid,
      { text: answerText },
      sendOptions,
    );

    if (pending) {
      await updatePendingStatus(pending.questionId, 'approved');
    }

    await safeSend(sock, adminJid, {
      text: `✅ *Text answer sent to public group.*${pending ? `\n\n*Q:* "${pending.questionText}"` : ''}`,
    });

    logger.info({ publicGroupJid, answerText: answerText.slice(0, 50) }, '📤 Text answer sent to public group');

    // Self-train: the Sheikh typed a brand-new answer — only worth folding back
    // into the KB when there wasn't already a good suggested match (otherwise
    // this is just a rephrase of an existing record, not new knowledge).
    if (pending && !pending.suggestedAudioFileName && pending.questionText) {
      selfTrainFromAnswer({ questionText: pending.questionText, answerText })
        .catch((err) => logger.warn({ err }, 'Self-train from text answer failed (non-fatal)'));
    }
  } catch (err) {
    logger.error({ err }, 'Failed to send text answer to public group');
    await safeSend(sock, adminJid, { text: `❌ Failed to send answer: ${String(err)}` });
  }
}

// ─── Forward Sheikh's voice note to public group ─────────────────────────────

async function forwardVoiceToPublic(
  sock: WASocket,
  audioBuffer: Buffer,
  _msg: WAMessage,
  _msgId: string,
  pending: PendingQuestion | null,
  adminJid: string,
  publicGroupJid: string,
): Promise<void> {
  if (!publicGroupJid) {
    await safeSend(sock, adminJid, { text: '❌ Public group not configured. Open dashboard Setup tab.' });
    return;
  }

  try {
    const sendOptions = pending
      ? { quoted: buildQuoteRef(publicGroupJid, pending) }
      : undefined;

    await sock.sendMessage(
      publicGroupJid,
      { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true },
      sendOptions,
    );

    if (pending) {
      await updatePendingStatus(pending.questionId, 'approved');
    }

    logger.info({ _msgId, publicGroupJid }, '🎤 Sheikh voice forwarded to public group');
    await safeSend(sock, adminJid, {
      text: pending
        ? `✅ *Voice answer forwarded to public group.*\n\n*Q:* "${pending.questionText}"`
        : `✅ *Voice forwarded to public group.*`,
    });

    // Self-train: a fresh Sheikh recording is only new knowledge when there
    // wasn't already a suggested KB match for this question.
    if (pending && !pending.suggestedAudioFileName && pending.questionText) {
      (async () => {
        let answerTranscript = '';
        try {
          const result = await transcribeAudio(audioBuffer, 'answer.ogg', 'auto');
          answerTranscript = result.text;
        } catch (err) {
          logger.warn({ err }, 'Could not transcribe Sheikh voice answer for self-training (continuing without transcript)');
        }
        await selfTrainFromAnswer({
          questionText: pending.questionText,
          answerAudioBuffer: audioBuffer,
          answerTranscript,
        });
      })().catch((err) => logger.warn({ err }, 'Self-train from voice answer failed (non-fatal)'));
    }
  } catch (err) {
    logger.error({ err }, 'Failed to forward admin voice');
    await safeSend(sock, adminJid, { text: `❌ Forward failed: ${String(err)}` });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function findPendingForMsg(msg: WAMessage): Promise<PendingQuestion | null> {
  // Try quoted message ID first (most accurate)
  const quotedId =
    msg.message?.extendedTextMessage?.contextInfo?.stanzaId ??
    msg.message?.audioMessage?.contextInfo?.stanzaId ??
    (msg.message as any)?.pttMessage?.contextInfo?.stanzaId ??
    undefined;

  if (quotedId) {
    const byQuote = await getPendingByAdminMsgId(quotedId);
    if (byQuote) return byQuote;
  }

  // Fall back to most recent pending
  return getMostRecentPending();
}

/** Build a quoted message reference to the pilgrim's original question */
function buildQuoteRef(publicGroupJid: string, pending: PendingQuestion) {
  return {
    key: {
      remoteJid:   publicGroupJid,
      id:          pending.quotedMessageId,
      fromMe:      false,
      participant: pending.senderJid,
    },
    message: {
      conversation: pending.questionText,
    },
  };
}

/** Safe sendMessage wrapper — logs but doesn't crash if sending fails */
async function safeSend(sock: WASocket, jid: string, content: object): Promise<void> {
  if (!jid) { logger.warn({ content }, 'safeSend: no JID — skipping'); return; }
  try {
    await sock.sendMessage(jid, content as Parameters<typeof sock.sendMessage>[1]);
  } catch (err) {
    logger.error({ err, jid }, 'safeSend failed');
  }
}
