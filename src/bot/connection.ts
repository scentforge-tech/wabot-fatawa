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
import { env } from '../config/env';
import logger from '../config/logger';
import { handleAudioMessage } from './handlers/audio.handler';
import { handleApprovalMessage } from './handlers/approval.handler';

// ─── State ────────────────────────────────────────────────────────────────────

let sock: WASocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 60_000; // 1 minute cap

// ─── Global Exception Handlers ───────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception — bot will continue running');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection — bot will continue running');
});

// ─── Connection ───────────────────────────────────────────────────────────────

/**
 * Compute exponential backoff delay for reconnection attempts.
 * Starts at 2s, doubles each attempt, caps at MAX_RECONNECT_DELAY_MS.
 */
function reconnectDelay(): number {
  return Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
}

/**
 * Bootstrap the Baileys WebSocket connection and register all event handlers.
 * Calls itself recursively on disconnect to implement auto-reconnect.
 */
export async function startBot(): Promise<void> {
  // Ensure auth directory exists
  if (!fs.existsSync(env.AUTH_DIR)) {
    fs.mkdirSync(env.AUTH_DIR, { recursive: true });
  }
  if (!fs.existsSync(env.TMP_DIR)) {
    fs.mkdirSync(env.TMP_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(env.AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  logger.info({ version, isLatest }, 'Baileys version loaded');

  // Suppress Baileys internal verbose logs in production
  const baileysLogger = pino({ level: 'silent' });

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    logger: baileysLogger,
    printQRInTerminal: true,    // QR code displayed in server console logs
    syncFullHistory: false,      // Don't pull all historical messages on connect
    markOnlineOnConnect: false,  // Don't expose the bot as "online"
    generateHighQualityLinkPreview: false,
  });

  // ── Credentials persistence ──────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Connection state management ──────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('📱  QR code generated — scan with WhatsApp on your phone');
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      logger.info('✅  WhatsApp connection established');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(
        { statusCode, shouldReconnect, reconnectAttempts },
        'WhatsApp connection closed',
      );

      if (shouldReconnect) {
        const delay = reconnectDelay();
        reconnectAttempts++;
        logger.info({ delayMs: delay }, `Reconnecting in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        await startBot();
      } else {
        logger.error('Logged out from WhatsApp — clear auth_info_baileys and restart');
        process.exit(1);
      }
    }
  });

  // ── Message handling ─────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return; // Ignore history sync messages

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid ?? '';
      const isPublicGroup = remoteJid === env.PUBLIC_GROUP_JID;
      const isAdminGroup = remoteJid === env.ADMIN_GROUP_JID;

      const msgType = Object.keys(msg.message)[0];
      const isAudio =
        msgType === 'audioMessage' || msgType === 'pttMessage';

      if (isPublicGroup && isAudio) {
        // Incoming pilgrim voice note in the public Q&A group
        await handleAudioMessage(sock!, msg).catch((err) =>
          logger.error({ err, msgId: msg.key.id }, 'Audio handler error'),
        );
      } else if (isAdminGroup && isAudio) {
        // Shaikh's approval voice reply in the admin group
        await handleApprovalMessage(sock!, msg).catch((err) =>
          logger.error({ err, msgId: msg.key.id }, 'Approval handler error'),
        );
      }
    }
  });
}

export function getSocket(): WASocket | null {
  return sock;
}
