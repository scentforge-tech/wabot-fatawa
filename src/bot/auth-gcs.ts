/**
 * GCS Auth Sync
 * ─────────────────────────────────────────────────────────────────────────────
 * Downloads WhatsApp auth credentials from GCS on startup and uploads them
 * whenever they change. This lets Cloud Run survive restarts without re-scanning
 * the QR code — the credentials are always stored in GCS.
 *
 * Required env: GCS_AUTH_BUCKET  (e.g. "masjidmap-5yvj5-wabot-auth")
 * Optional env: GCS_AUTH_PREFIX  (default: "auth/")
 */
import { Storage } from '@google-cloud/storage';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../config/logger';

const GCS_BUCKET  = process.env.GCS_AUTH_BUCKET ?? '';
const GCS_PREFIX  = process.env.GCS_AUTH_PREFIX ?? 'auth/';

// Return null if GCS is not configured — auth is local-only
function getStorage(): Storage | null {
  if (!GCS_BUCKET) return null;

  // On Cloud Run: ADC uses the attached service account automatically.
  // Locally / as fallback: use the Firebase service account key file
  // which is already used by the rest of the app.
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ?? process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ?? undefined;

  return new Storage({ keyFilename: keyFile });
}

/**
 * Download all auth files from GCS into `authDir`.
 * Returns true if any files were restored, false if bucket is empty or GCS
 * is not configured.
 */
export async function downloadAuthFromGCS(authDir: string): Promise<boolean> {
  const storage = getStorage();
  if (!storage) {
    logger.info('GCS_AUTH_BUCKET not set — skipping GCS auth restore');
    return false;
  }

  try {
    const bucket = storage.bucket(GCS_BUCKET);
    const [files] = await bucket.getFiles({ prefix: GCS_PREFIX });
    if (files.length === 0) {
      logger.info({ bucket: GCS_BUCKET }, 'GCS auth bucket empty — fresh start');
      return false;
    }

    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    await Promise.all(files.map(async (file) => {
      const fileName  = file.name.slice(GCS_PREFIX.length); // strip prefix
      if (!fileName) return;                                  // skip the "folder" object
      const localPath = path.join(authDir, fileName);
      await file.download({ destination: localPath });
    }));

    logger.info({ bucket: GCS_BUCKET, count: files.length }, '✅ Auth restored from GCS');
    return true;
  } catch (err) {
    logger.error({ err }, 'Failed to download auth from GCS — starting fresh');
    return false;
  }
}

/**
 * Upload a single auth file to GCS.
 * Called from creds.update so credentials are persisted immediately.
 */
export async function uploadFileToGCS(localFilePath: string, fileName: string): Promise<void> {
  // Skip silently when GCS is not configured (local dev)
  if (!GCS_BUCKET) return;

  const storage = getStorage();
  if (!storage) return;

  try {
    await storage.bucket(GCS_BUCKET).upload(localFilePath, {
      destination: GCS_PREFIX + fileName,
    });
    logger.debug({ fileName }, 'Auth file synced to GCS');
  } catch (err) {
    logger.warn({ err, fileName }, 'Failed to upload auth file to GCS');
  }
}

/**
 * Upload the entire authDir to GCS (one-time bulk upload).
 * Useful for bootstrapping from a local session.
 */
export async function uploadAllAuthToGCS(authDir: string): Promise<void> {
  const storage = getStorage();
  if (!storage) {
    logger.warn('GCS_AUTH_BUCKET not set — cannot upload auth');
    return;
  }

  try {
    const files = fs.readdirSync(authDir).filter((f) =>
      fs.statSync(path.join(authDir, f)).isFile(),
    );

    await Promise.all(files.map((file) =>
      storage.bucket(GCS_BUCKET).upload(path.join(authDir, file), {
        destination: GCS_PREFIX + file,
      }),
    ));

    logger.info({ bucket: GCS_BUCKET, count: files.length }, '✅ Auth uploaded to GCS');
  } catch (err) {
    logger.error({ err }, 'Failed to bulk-upload auth to GCS');
  }
}
