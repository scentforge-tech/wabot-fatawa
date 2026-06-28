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
import { handleApprovalMessage } from './handlers/approval.handler';

// ─── State ────────────────────────────────────────────────────────────────────

let sock: WASocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 60_000;

// ─── JID Discovery Mode ──────────────────────────────────────────────────────
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

    // Display QR code visually in the terminal
    if (qr) {
      console.log('\n\n');
      console.log('━'.repeat(60));
      console.log('  📱  SCAN THIS QR CODE WITH WHATSAPP');
      console.log('  WhatsApp → ⋮ Menu → Linked Devices → Link a Device');
      console.log('━'.repeat(60));
      qrcode.generate(qr, { small: true });
      console.log('━'.repeat(60));
      console.log('  QR expires in ~60s — a new one will appear automatically');
      console.log('━'.repeat(60));
      console.log('\n');
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      logger.info('✅  WhatsApp connected successfully!');

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
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid ?? '';
      const isGroup = remoteJid.endsWith('@g.us');

      // ── JID Discovery: log every group message with the JID ─────────────
      if (DISCOVERY_MODE && isGroup) {
        // Get group name if available
        const pushName = msg.pushName ?? 'unknown';
        console.log('\n' + '═'.repeat(60));
        console.log('  🔍  GROUP MESSAGE DETECTED');
        console.log(`  JID      : ${remoteJid}`);
        console.log(`  From     : ${pushName}`);
        console.log(`  Msg Type : ${Object.keys(msg.message)[0]}`);
        console.log('  ─── Add this to your .env ───');
        console.log(`  ADMIN_GROUP_JID=${remoteJid}   ← if this is the admin group`);
        console.log(`  PUBLIC_GROUP_JID=${remoteJid}  ← if this is the public group`);
        console.log('═'.repeat(60) + '\n');
        logger.info({ jid: remoteJid, from: pushName }, '🔍 JID discovered — copy to .env');
        continue; // Don't process messages in discovery mode
      }

      // ── Normal operation ─────────────────────────────────────────────────
      const isPublicGroup = remoteJid === env.PUBLIC_GROUP_JID;
      const isAdminGroup  = remoteJid === env.ADMIN_GROUP_JID;
      const msgType = Object.keys(msg.message)[0];
      const isAudio = msgType === 'audioMessage' || msgType === 'pttMessage';

      if (isPublicGroup && isAudio) {
        await handleAudioMessage(sock!, msg).catch((err) =>
          logger.error({ err, msgId: msg.key.id }, 'Audio handler error'),
        );
      } else if (isAdminGroup && isAudio) {
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
