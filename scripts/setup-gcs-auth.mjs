// One-time: create GCS bucket and upload auth files
// Run: node --env-file=.env scripts/setup-gcs-auth.mjs
import { Storage } from '@google-cloud/storage';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BUCKET    = process.env.GCS_AUTH_BUCKET || 'masjidmap-5yvj5-wabot-auth';
const AUTH_DIR  = path.join(ROOT, 'auth_info_baileys');
const PREFIX    = 'auth/';
const SA_PATH   = path.join(ROOT, 'firebase-service-account.json');

const storage = new Storage({
  projectId: 'masjidmap-5yvj5',
  keyFilename: fs.existsSync(SA_PATH) ? SA_PATH : undefined,
});

const bucket = storage.bucket(BUCKET);

// Create bucket if it doesn't exist
const [exists] = await bucket.exists().catch(() => [false]);
if (!exists) {
  await storage.createBucket(BUCKET, { location: 'us-central1' });
  console.log('✅ Bucket created:', BUCKET);
} else {
  console.log('ℹ️  Bucket already exists:', BUCKET);
}

// Upload all auth files
const files = fs.readdirSync(AUTH_DIR).filter(
  f => fs.statSync(path.join(AUTH_DIR, f)).isFile()
);

if (files.length === 0) {
  console.error('❌ No auth files found in', AUTH_DIR);
  process.exit(1);
}

for (const file of files) {
  await bucket.upload(path.join(AUTH_DIR, file), { destination: PREFIX + file });
  process.stdout.write('  Uploaded: ' + file + '\n');
}

console.log(`\n✅ Uploaded ${files.length} auth files to gs://${BUCKET}/${PREFIX}`);
console.log('Deploy to Cloud Run — it will auto-restore from GCS on startup!');
