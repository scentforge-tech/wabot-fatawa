/**
 * Upload all WhatsApp auth files to Firestore.
 * Run this once locally after linking WhatsApp, then Cloud Run reads from Firestore.
 *
 * Usage:  node --env-file=.env scripts/upload-auth-to-firestore.mjs
 */
import { initializeApp } from 'firebase-admin/app';
import { cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUTH_DIR = path.join(ROOT, 'auth_info_baileys');
const SA_PATH = path.join(ROOT, 'firebase-service-account.json');
const COLLECTION = '_wabot_auth';

// Initialize Firebase Admin with SA key
const saJson = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();

// Read all auth files
const files = fs.readdirSync(AUTH_DIR).filter(f =>
  fs.statSync(path.join(AUTH_DIR, f)).isFile()
);

console.log(`Found ${files.length} auth files in ${AUTH_DIR}`);

// Upload in batches of 400 (Firestore batch limit 500)
const BATCH_SIZE = 400;
let total = 0;

for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = db.batch();
  const chunk = files.slice(i, i + BATCH_SIZE);
  
  for (const file of chunk) {
    const content = fs.readFileSync(path.join(AUTH_DIR, file)).toString('base64');
    batch.set(db.collection(COLLECTION).doc(file), {
      content,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  
  await batch.commit();
  total += chunk.length;
  console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} done: ${total}/${files.length} files uploaded`);
}

console.log(`\n✅ All ${total} auth files uploaded to Firestore collection "${COLLECTION}"`);
console.log('Cloud Run will now restore from Firestore on every startup.');
process.exit(0);
