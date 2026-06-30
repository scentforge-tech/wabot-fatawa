// Upload only essential WhatsApp auth files to GCS (not sender-keys which are huge)
import { Storage } from '@google-cloud/storage';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUCKET = process.env.GCS_AUTH_BUCKET || 'masjidmap-5yvj5-wabot-auth';
const AUTH_DIR = path.join(ROOT, 'auth_info_baileys');
const PREFIX = 'auth/';
const SA_PATH = path.join(ROOT, 'firebase-service-account.json');

const storage = new Storage({
  projectId: 'masjidmap-5yvj5',
  keyFilename: fs.existsSync(SA_PATH) ? SA_PATH : undefined,
});

const bucket = storage.bucket(BUCKET);

// Only upload essential files (not sender-key session files which grow huge)
const ESSENTIAL_PATTERNS = [
  /^creds\.json$/,
  /^app-state-sync/,
  /^pre-key-\d+\.json$/,
  /^session-\d+\.0\.json$/,
  /^sender-key.*\.json$/,
];

const files = fs.readdirSync(AUTH_DIR).filter(f => {
  if (!fs.statSync(path.join(AUTH_DIR, f)).isFile()) return false;
  return ESSENTIAL_PATTERNS.some(p => p.test(f));
});

console.log(`Uploading ${files.length} essential auth files...`);

// Upload in parallel batches of 5
async function uploadBatch(batch) {
  await Promise.all(batch.map(async (file) => {
    try {
      await bucket.upload(path.join(AUTH_DIR, file), { destination: PREFIX + file });
      process.stdout.write('.');
    } catch (e) {
      console.warn(`\nFailed ${file}: ${e.message}`);
    }
  }));
}

const BATCH_SIZE = 5;
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  await uploadBatch(files.slice(i, i + BATCH_SIZE));
}

console.log(`\n✅ Uploaded ${files.length} auth files to gs://${BUCKET}/${PREFIX}`);
