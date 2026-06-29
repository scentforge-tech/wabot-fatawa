import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import * as fs from 'fs';
import * as qrcode from 'qrcode-terminal';
import { env } from '../config/env';
import logger from '../config/logger';
import { handleAudioMessage } from './handlers/audio.handler';
import { handleTextMessage } from './handlers/text.handler';
import { handleApprovalMessage } from './handlers/approval.handler';

// ─── State ────────────────────────────────────────────────────────────────────

let sock: WASocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 60_000;

// Callbacks so index.ts can serve QR and connection state over HTTP
let _qrCallback: ((qr: string) => void) | null = null;
let _connectionCallback: ((connected: boolean) => void) | null = null;

export function setQrCallback(cb: (qr: string) => void): void { _qrCallback = cb; }
export function setConnectionCallback(cb: (connected: boolean) => void): void { _connectionCallback = cb; }

/**
 * Request a pairing code for phone-number-based linking.
 * Call AFTER startBot() — the socket must be initialised.
 * Returns the 8-character code the user types in WhatsApp.
 */
export async function requestPairingCodeForPhone(phoneNumber: string): Promise<string> {
  if (!sock) throw new Error('Bot socket not initialised — call startBot() first');
  // Baileys expects the number in E.164 format without + or spaces, e.g. "923001234567"
  const cleaned = phoneNumber.replace(/[^0-9]/g, '');
  const code = await sock.requestPairingCode(cleaned);
  return code;
}

// When ADMIN_GROUP_JID or PUBLIC_GROUP_JID are not set, the bot logs every
// incoming group JID so you can identify your groups. Post any message in each
// group and watch the logs — the JID will be printed clearly.

const DISCOVERY_MODE = !env.ADMIN_GROUP_JID || !env.PUBLIC_GROUP_JID;

// ─── Global Exception Handlers ───────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception — bot will continue running');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection — bot will continue running');
});

// ─── Connection ───────────────────────────────────────────────────────────────

function reconnectDelay(): number {
  return Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
}

/**
 * Bootstrap the Baileys WebSocket connection and register all event handlers.
 * Calls itself recursively on disconnect for auto-reconnect with backoff.
 */
export async function startBot(): Promise<void> {
  // Ensure required directories exist
  for (const dir of [env.AUTH_DIR, env.TMP_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(env.AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  logger.info({ version, isLatest }, 'Baileys version loaded');

  if (DISCOVERY_MODE) {
    logger.warn(
      '🔍  JID DISCOVERY MODE ACTIVE — ADMIN_GROUP_JID or PUBLIC_GROUP_JID not set.\n' +
      '    Post any message in your groups and the JID will be printed below.\n' +
      '    Then add them to your .env file and restart.',
    );
  }

  // Suppress Baileys internal verbose logs
  const baileysLogger = pino({ level: 'silent' });

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    logger: baileysLogger,
    printQRInTerminal: false,    // We handle QR ourselves (deprecated option)
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  // ── Credentials persistence ──────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Connection state management ──────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Fire QR callback → served as scannable image at http://localhost:8080
    if (qr) {
      if (_qrCallback) _qrCallback(qr);
      // Also print ascii fallback in terminal
      console.log('\n📱  Open http://localhost:8080 in your browser to scan the QR code\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      if (_connectionCallback) _connectionCallback(true);
      logger.info('✅  WhatsApp connected! Browser page at http://localhost:8080 will update.');

      if (DISCOVERY_MODE) {
        logger.info(
          '🔍  Connected! Now send a message in each of your WhatsApp groups.\n' +
          '    The group JID will appear in the logs below.',
        );
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn({ statusCode, shouldReconnect, reconnectAttempts }, 'WhatsApp connection closed');

      if (shouldReconnect) {
        const delay = reconnectDelay();
        reconnectAttempts++;
        logger.info({ delayMs: delay }, `Reconnecting in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        await startBot();
      } else {
        logger.error('❌  Logged out from WhatsApp — delete auth_info_baileys/ folder and restart');
        process.exit(1);
      }
    }
  });

  // ── Message handling ─────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    logger.debug({ type, count: messages.length }, 'messages.upsert fired');

    if (type !== 'notify') return; // 'append' = history sync, skip

    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid ?? '';
      const msgType   = msg.message ? Object.keys(msg.message)[0] : 'none';
      const fromMe    = msg.key.fromMe ?? false;

      // Log EVERY incoming event so we can debug routing
      logger.info({ remoteJid, msgType, fromMe, msgId: msg.key.id }, '📨 Incoming message');

      if (!msg.message) { logger.debug({ msgId: msg.key.id }, 'Skip: no message body'); continue; }
      if (fromMe)       { logger.debug({ msgId: msg.key.id }, 'Skip: bot sent this'); continue; }

      const isGroup = remoteJid.endsWith('@g.us');

      // ── JID Discovery ─────────────────────────────────────────────────────
      if (DISCOVERY_MODE && isGroup) {
        const pushName = msg.pushName ?? 'unknown';
        console.log('\n' + '═'.repeat(60));
        console.log('  🔍  GROUP MESSAGE DETECTED');
        console.log(`  JID      : ${remoteJid}`);
        console.log(`  From     : ${pushName}`);
        console.log(`  Msg Type : ${msgType}`);
        console.log('  ─── Add this to your .env ───');
        console.log(`  ADMIN_GROUP_JID=${remoteJid}   ← if this is the admin group`);
        console.log(`  PUBLIC_GROUP_JID=${remoteJid}  ← if this is the public group`);
        console.log('═'.repeat(60) + '\n');
        logger.info({ jid: remoteJid, from: pushName }, '🔍 JID discovered — copy to .env');
        continue;
      }

      // ── Normal operation ──────────────────────────────────────────────────
      const isPublicGroup = remoteJid === env.PUBLIC_GROUP_JID;
      const isAdminGroup  = remoteJid === env.ADMIN_GROUP_JID;

      // Catch all audio variants WhatsApp uses
      const isAudio =
        msgType === 'audioMessage' ||
        msgType === 'pttMessage'   ||
        (msgType === 'documentMessage' &&
          (msg.message?.documentMessage?.mimetype ?? '').startsWith('audio/'));

      const isText = msgType === 'conversation' || msgType === 'extendedTextMessage';

      logger.info({ isPublicGroup, isAdminGroup, isAudio, isText, msgType, remoteJid }, '🔎 Routing decision');

      if (isPublicGroup && isAudio) {
        logger.info({ msgId: msg.key.id }, '🎤 → Audio handler');
        await handleAudioMessage(sock!, msg).catch((err) =>
          logger.error({ err, msgId: msg.key.id }, 'Audio handler error'),
        );
      } else if (isPublicGroup && isText) {
        logger.info({ msgId: msg.key.id }, '💬 → Text handler');
        await handleTextMessage(sock!, msg).catch((err) =>
          logger.error({ err, msgId: msg.key.id }, 'Text handler error'),
        );
      } else if (isAdminGroup && (isAudio || msgType === 'conversation' || msgType === 'extendedTextMessage')) {
        // Handle BOTH voice notes (forward to public) AND text approvals (thik hai / nahi)
        logger.info({ msgId: msg.key.id, msgType }, '✅ → Approval handler');
        await handleApprovalMessage(sock!, msg).catch((err) =>
          logger.error({ err, msgId: msg.key.id }, 'Approval handler error'),
        );
      } else {
        logger.debug({ isPublicGroup, isAdminGroup, isAudio, isText, msgType, remoteJid }, 'No handler matched');
      }
    }
  });
}

export function getSocket(): WASocket | null {
  return sock;
}
