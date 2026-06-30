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

export interface GroupSettings {
  publicGroupJid: string | null;
  adminGroupJid: string | null;
  updatedAt?: Date;
}

// In-memory cache — updated when saved from UI
let _cache: GroupSettings = {
  publicGroupJid: env.PUBLIC_GROUP_JID || null,
  adminGroupJid: env.ADMIN_GROUP_JID || null,
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
      const data = doc.data() as GroupSettings;
      _cache = {
        publicGroupJid: data.publicGroupJid || env.PUBLIC_GROUP_JID || null,
        adminGroupJid: data.adminGroupJid || env.ADMIN_GROUP_JID || null,
      };
      logger.info({ publicGroupJid: _cache.publicGroupJid, adminGroupJid: _cache.adminGroupJid }, 'Group settings loaded from Firestore');
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
  _cache = { ..._cache, ...settings };
  try {
    const db = getDb();
    await db.collection(SETTINGS_COLLECTION).doc(GROUPS_DOC).set({
      publicGroupJid: _cache.publicGroupJid,
      adminGroupJid: _cache.adminGroupJid,
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
