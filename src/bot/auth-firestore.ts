/**
 * Firestore Auth Sync
 * ─────────────────────────────────────────────────────────────────────────────
 * Stores WhatsApp auth credentials in Firestore so Cloud Run can restore them
 * on every startup without needing GCS IAM grants or Docker layer tricks.
 *
 * Collection: _wabot_auth/{filename}  →  { content: "<base64>" }
 *
 * Works everywhere:
 *  - Local dev:   Firebase SA key file (FIREBASE_SERVICE_ACCOUNT_PATH)
 *  - Cloud Run:   ADC → Compute Engine SA → has Firestore via project Editor role
 */
import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../config/logger';
import { env } from '../config/env';

const COLLECTION = '_wabot_auth';

function getDb() {
  if (getApps().length === 0) {
    // Self-initialize Firebase — same logic as firestore.service.ts
    const saPath = env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (saPath && fs.existsSync(path.resolve(saPath))) {
      const sa = JSON.parse(fs.readFileSync(path.resolve(saPath), 'utf8'));
      initializeApp({
        credential: cert(sa as Parameters<typeof cert>[0]),
        projectId: env.FIREBASE_PROJECT_ID,
      });
    } else {
      // Cloud Run: use ADC (Compute Engine SA has Firestore access via Editor role)
      initializeApp({
        credential: applicationDefault(),
        projectId: env.FIREBASE_PROJECT_ID,
      });
    }
  }
  return getFirestore();
}

/**
 * Download all auth files from Firestore into authDir.
 * Returns true if any files were restored.
 */
export async function downloadAuthFromFirestore(authDir: string): Promise<boolean> {
  const db = getDb();
  if (!db) {
    logger.warn('Firebase not initialized yet — skipping Firestore auth restore');
    return false;
  }

  try {
    const snapshot = await db.collection(COLLECTION).get();
    if (snapshot.empty) {
      logger.info('Firestore _wabot_auth collection empty — fresh start (will show QR)');
      return false;
    }

    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    let count = 0;
    for (const doc of snapshot.docs) {
      const data = doc.data() as { content?: string };
      if (!data.content) continue;
      const filePath = path.join(authDir, doc.id);
      fs.writeFileSync(filePath, Buffer.from(data.content, 'base64'));
      count++;
    }

    logger.info({ count }, '✅ Auth restored from Firestore');
    return count > 0;
  } catch (err) {
    logger.error({ err }, 'Failed to download auth from Firestore (non-fatal)');
    return false;
  }
}

/**
 * Upload a single auth file to Firestore.
 * Called from creds.update so credentials stay current across restarts.
 */
export async function uploadFileToFirestore(localFilePath: string, fileName: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    if (!fs.existsSync(localFilePath)) return;
    const content = fs.readFileSync(localFilePath).toString('base64');
    await db.collection(COLLECTION).doc(fileName).set({
      content,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.warn({ err, fileName }, 'Failed to upload auth file to Firestore (non-fatal)');
  }
}

/**
 * Delete all auth documents from Firestore.
 * Call before /reset-auth so Cloud Run doesn't restore old session on restart.
 */
export async function clearFirestoreAuth(): Promise<void> {
  const db = getDb();
  if (!db) return;

  const BATCH_SIZE = 400;
  let deleted = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snapshot = await db.collection(COLLECTION).limit(BATCH_SIZE).get();
    if (snapshot.empty) break;

    const batch = db.batch();
    for (const doc of snapshot.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snapshot.docs.length;
  }

  logger.info({ deleted }, '🗑️  Firestore auth cleared');
}
