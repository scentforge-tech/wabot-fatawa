import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import * as qrcode from 'qrcode-terminal';
import { env } from '../config/env';
import logger from '../config/logger';
import { handleAudioMessage } from './handlers/audio.handler';
import { handleTextMessage } from './handlers/text.handler';
import { handleApprovalMessage } from './handlers/approval.handler';
import { downloadAuthFromFirestore, uploadFileToFirestore } from './auth-firestore';

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
 * Call AFTER startBot() — waits for the WebSocket to be stable first.
 * Returns the 8-character code the user types in WhatsApp.
 */
export async function requestPairingCodeForPhone(phoneNumber: string): Promise<string> {
  if (!sock) throw new Error('Bot not started yet — wait a few seconds and try again');

  // Validate: digits only, at least 10 characters (e.g. 923001234567)
  const cleaned = phoneNumber.replace(/[^0-9]/g, '');
  if (cleaned.length < 10) {
    throw new Error('Invalid phone number — include country code with no + or spaces, e.g. 923001234567');
  }

  // If already authenticated, pairing code is not needed
  if (sock.authState.creds.registered) {
    throw new Error('Device is already linked — no pairing code needed');
  }

  // Wait for the WebSocket to be open (with 20s timeout)
  const timeoutMs = 20_000;
  await Promise.race([
    sock.waitForSocketOpen(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out waiting for WhatsApp connection — try again in a moment')), timeoutMs),
    ),
  ]);

  // Small stabilisation delay — ensures the WS handshake is fully settled
  await new Promise((r) => setTimeout(r, 2000));

  // Re-check socket wasn't replaced during the delay (e.g. by resetAuthAndRestart)
  if (!sock) throw new Error('Bot restarted unexpectedly — please try again');

  // Attempt with one retry on transient errors
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const code = await sock.requestPairingCode(cleaned);
      logger.info({ cleaned, attempt }, 'Pairing code issued successfully');
      return code;
    } catch (err) {
      logger.warn({ err, attempt }, 'requestPairingCode failed');
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Failed to get pairing code after retries');
}

/**
 * Wipe saved credentials and restart the bot with a clean session.
 * Use when a wrong pairing code was entered or auth is in a bad state.
 */
export async function resetAuthAndRestart(): Promise<void> {
  logger.warn('🔄 Resetting auth — wiping auth_info_baileys/ and restarting...');

  // Close current socket cleanly
  if (sock) {
    try { sock.end(undefined); } catch { /* ignore */ }
    sock = null;
  }

  // Delete all files inside auth_info_baileys/ but keep the directory
  if (fs.existsSync(env.AUTH_DIR)) {
    for (const file of fs.readdirSync(env.AUTH_DIR)) {
      fs.rmSync(`${env.AUTH_DIR}/${file}`, { recursive: true, force: true });
    }
  }

  reconnectAttempts = 0;
  logger.info('🔄 Auth cleared — restarting bot connection...');
  await startBot();
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

  // Restore auth from Firestore if the local directory is empty (Cloud Run restarts)
  const hasLocalAuth = fs.existsSync(env.AUTH_DIR) &&
    fs.readdirSync(env.AUTH_DIR).length > 0;
  if (!hasLocalAuth) {
    logger.info('No local auth found — attempting Firestore restore...');
    await downloadAuthFromFirestore(env.AUTH_DIR);
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
    // Use Baileys' standard Ubuntu/Chrome browser fingerprint
    // — custom identifiers cause WhatsApp to reject the connection
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  // ── Credentials persistence — save locally AND sync to Firestore ───────────
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    // Sync changed files to Firestore so Cloud Run survives restarts
    try {
      const files = fs.readdirSync(env.AUTH_DIR).filter((f) =>
        fs.statSync(path.join(env.AUTH_DIR, f)).isFile(),
      );
      await Promise.all(files.map((f) =>
        uploadFileToFirestore(path.join(env.AUTH_DIR, f), f),
      ));
    } catch (e) {
      logger.warn({ e }, 'Firestore creds sync error (non-fatal)');
    }
  });

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
