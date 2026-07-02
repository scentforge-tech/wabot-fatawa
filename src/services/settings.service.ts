/**
 * Bot Settings Service
 * Stores/retrieves runtime settings (group JIDs etc.) in Firestore.
 * Replaces hardcoded env vars — user selects groups from the dashboard UI.
 */
import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../config/logger';
import { env } from '../config/env';

const SETTINGS_COLLECTION = '_wabot_settings';
const GROUPS_DOC = 'groups';

/**
 * How the bot delivers answers to a pilgrim's question:
 *   'approval' — every question is routed to the Sheikh for approval (safest, default)
 *   'auto'     — high-confidence matches (score ≥ autoReplyThreshold) are answered
 *                directly to the user; low-confidence questions still go to the Sheikh
 *   'hybrid'   — same routing as 'auto', but every auto-reply is ALSO copied to the
 *                admin group as an FYI so the Sheikh keeps oversight of what was sent
 */
export type ReplyMode = 'approval' | 'auto' | 'hybrid';

export interface GroupSettings {
  publicGroupJid: string | null;
  adminGroupJid: string | null;
  /** Reply delivery strategy — see ReplyMode. */
  replyMode: ReplyMode;
  /** Minimum KB match score (0..1) required to auto-reply in 'auto'/'hybrid' modes. */
  autoReplyThreshold: number;
  /** When true, questions sent to the bot in 1-on-1 chats (DMs) are also answered. */
  answerDMs: boolean;
  updatedAt?: Date;
}

// Defaults applied when a field is missing from Firestore (keeps old docs valid).
const REPLY_DEFAULTS = {
  replyMode: 'approval' as ReplyMode,
  autoReplyThreshold: 0.72,
  answerDMs: false,
};

// In-memory cache — updated when saved from UI
let _cache: GroupSettings = {
  publicGroupJid: env.PUBLIC_GROUP_JID || null,
  adminGroupJid: env.ADMIN_GROUP_JID || null,
  ...REPLY_DEFAULTS,
};

function getDb() {
  if (getApps().length === 0) {
    const saPath = env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (saPath && fs.existsSync(path.resolve(saPath))) {
      const sa = JSON.parse(fs.readFileSync(path.resolve(saPath), 'utf8'));
      initializeApp({ credential: cert(sa as Parameters<typeof cert>[0]), projectId: env.FIREBASE_PROJECT_ID });
    } else {
      initializeApp({ credential: applicationDefault(), projectId: env.FIREBASE_PROJECT_ID });
    }
  }
  return getFirestore();
}

/** Load group settings from Firestore. Falls back to env vars if not set. */
export async function loadGroupSettings(): Promise<GroupSettings> {
  try {
    const db = getDb();
    const doc = await db.collection(SETTINGS_COLLECTION).doc(GROUPS_DOC).get();
    if (doc.exists) {
      const data = doc.data() as Partial<GroupSettings>;
      _cache = {
        publicGroupJid: data.publicGroupJid || env.PUBLIC_GROUP_JID || null,
        adminGroupJid: data.adminGroupJid || env.ADMIN_GROUP_JID || null,
        replyMode: data.replyMode ?? REPLY_DEFAULTS.replyMode,
        autoReplyThreshold:
          typeof data.autoReplyThreshold === 'number'
            ? data.autoReplyThreshold
            : REPLY_DEFAULTS.autoReplyThreshold,
        answerDMs: data.answerDMs ?? REPLY_DEFAULTS.answerDMs,
      };
      logger.info(
        { publicGroupJid: _cache.publicGroupJid, adminGroupJid: _cache.adminGroupJid, replyMode: _cache.replyMode, autoReplyThreshold: _cache.autoReplyThreshold, answerDMs: _cache.answerDMs },
        'Group settings loaded from Firestore',
      );
    } else {
      logger.info('No group settings in Firestore — using env vars');
    }
  } catch (err) {
    logger.warn({ err }, 'Could not load group settings from Firestore — using defaults');
  }
  return _cache;
}

/** Save group settings to Firestore and update in-memory cache. */
export async function saveGroupSettings(settings: Partial<GroupSettings>): Promise<GroupSettings> {
  // Sanitize incoming values so the UI can't persist an invalid config.
  const clean: Partial<GroupSettings> = { ...settings };
  if (clean.replyMode && !['approval', 'auto', 'hybrid'].includes(clean.replyMode)) {
    delete clean.replyMode;
  }
  if (typeof clean.autoReplyThreshold === 'number') {
    clean.autoReplyThreshold = Math.min(1, Math.max(0, clean.autoReplyThreshold));
  } else {
    delete clean.autoReplyThreshold;
  }

  _cache = { ..._cache, ...clean };
  try {
    const db = getDb();
    await db.collection(SETTINGS_COLLECTION).doc(GROUPS_DOC).set({
      publicGroupJid: _cache.publicGroupJid,
      adminGroupJid: _cache.adminGroupJid,
      replyMode: _cache.replyMode,
      autoReplyThreshold: _cache.autoReplyThreshold,
      answerDMs: _cache.answerDMs,
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info({ settings: _cache }, 'Group settings saved to Firestore');
  } catch (err) {
    logger.warn({ err }, 'Could not save group settings to Firestore');
  }
  return _cache;
}

/** Get current in-memory group settings (no async needed). */
export function getGroupSettings(): GroupSettings {
  return _cache;
}
