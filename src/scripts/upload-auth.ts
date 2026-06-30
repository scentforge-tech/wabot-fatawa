/**
 * One-time script: Upload local auth_info_baileys/ to GCS
 * Run ONCE after successful local QR scan:
 *   node dist/scripts/upload-auth.js
 */
import 'dotenv/config';
import { uploadAllAuthToGCS } from '../bot/auth-gcs';
import { env } from '../config/env';
import logger from '../config/logger';

const bucket = process.env.GCS_AUTH_BUCKET;
if (!bucket) {
  logger.error('GCS_AUTH_BUCKET not set in .env — aborting');
  process.exit(1);
}

logger.info({ bucket, authDir: env.AUTH_DIR }, 'Uploading auth to GCS...');

uploadAllAuthToGCS(env.AUTH_DIR)
  .then(() => {
    logger.info('✅ Auth uploaded to GCS successfully!');
    logger.info('You can now deploy to Cloud Run — it will download auth automatically on startup.');
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'Upload failed');
    process.exit(1);
  });
