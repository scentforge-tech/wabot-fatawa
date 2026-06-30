#!/usr/bin/env node
/**
 * Fatawa Dataset Ingest Script
 *
 * Reads OUTPUT/training_data.json + OUTPUT/transcripts/ + OUTPUT/media/
 * Sanitizes records → stores in Firestore _fatawa_kb + uploads audio to GCS
 *
 * Run once:
 *   node --env-file=.env scripts/ingest-dataset.mjs
 *
 * Prerequisites:
 *   - FIREBASE_PROJECT_ID in .env
 *   - FIREBASE_SERVICE_ACCOUNT_PATH in .env
 *   - GEMINI_API_KEY in .env
 *   - GCS_BUCKET_NAME in .env (default: wabot-fatawa-audio)
 */

import { Firestore } from '@google-cloud/firestore';
import { Storage }   from '@google-cloud/storage';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const OUTPUT    = join(ROOT, 'OUTPUT');

// ─── Config from env ─────────────────────────────────────────────────────────
const PROJECT_ID   = process.env.FIREBASE_PROJECT_ID;
const SA_PATH      = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? './firebase-service-account.json';
const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const BUCKET_NAME  = process.env.GCS_BUCKET_NAME ?? 'wabot-fatawa-audio';
const BATCH_DELAY  = 1200;  // ms between Gemini embedding calls (rate limit)

if (!PROJECT_ID || !GEMINI_KEY) {
  console.error('❌  FIREBASE_PROJECT_ID and GEMINI_API_KEY must be set in .env');
  process.exit(1);
}

// ─── Clients ──────────────────────────────────────────────────────────────────
const sa = JSON.parse(readFileSync(resolve(ROOT, SA_PATH), 'utf-8'));

const db = new Firestore({
  projectId: PROJECT_ID,
  credentials: { client_email: sa.client_email, private_key: sa.private_key },
});

const storage = new Storage({
  projectId: PROJECT_ID,
  credentials: { client_email: sa.client_email, private_key: sa.private_key },
});

const genai = new GoogleGenerativeAI(GEMINI_KEY);
const embeddingModel = genai.getGenerativeModel({ model: 'text-embedding-004' });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function embedText(text) {
  const result = await embeddingModel.embedContent(text.slice(0, 2000));
  return result.embedding.values;
}

/** Read transcript file (from OUTPUT/transcripts/) for an audio file */
function readTranscript(audioFileName) {
  const baseName = audioFileName.replace(/\.(opus|mp3|ogg|m4a)$/i, '');
  const txtPath  = join(OUTPUT, 'transcripts', `${baseName}.txt`);
  if (!existsSync(txtPath)) return '';
  return readFileSync(txtPath, 'utf-8').trim();
}

/** Sanitize: return false if this record should be skipped */
function shouldSkip(record) {
  // Must have a question
  if (!record.q_text || record.q_text.trim().length < 10) return true;
  // Must have an answer (audio or text)
  if (!record.has_answer) return true;
  // Audio answer: must have an audio file name
  if (record.reply_mode === 'audio' && !record.a_audio_file) return true;
  // Text answer: must have a_text
  if (record.reply_mode === 'text' && (!record.a_text || record.a_text.trim().length < 10)) return true;
  return false;
}

/** Extract keywords from topic + question for fallback text search */
function extractKeywords(question, topic) {
  const words = (question + ' ' + (topic ?? ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
  return [...new Set(words)].slice(0, 20);
}

// ─── GCS Bucket Setup ─────────────────────────────────────────────────────────

async function ensureBucket() {
  const bucket = storage.bucket(BUCKET_NAME);
  const [exists] = await bucket.exists();
  if (!exists) {
    console.log(`📦 Creating GCS bucket: ${BUCKET_NAME}`);
    await storage.createBucket(BUCKET_NAME, {
      location: 'US',
      storageClass: 'STANDARD',
    });
    console.log(`✅ Bucket created: gs://${BUCKET_NAME}`);
  } else {
    console.log(`✅ GCS bucket exists: gs://${BUCKET_NAME}`);
  }
  return bucket;
}

async function uploadAudioToBucket(bucket, audioFileName) {
  const localPath = join(OUTPUT, 'media', audioFileName);
  if (!existsSync(localPath)) {
    return false;
  }
  const file = bucket.file(audioFileName);
  const [exists] = await file.exists();
  if (exists) {
    return true; // Already uploaded — skip
  }
  await bucket.upload(localPath, {
    destination: audioFileName,
    metadata: { contentType: 'audio/ogg; codecs=opus' },
  });
  return true;
}

// ─── Main Ingest ──────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 Starting Fatawa Dataset Ingest\n');

  // Load training data
  const dataPath = join(OUTPUT, 'training_data.json');
  if (!existsSync(dataPath)) {
    console.error(`❌ training_data.json not found at ${dataPath}`);
    process.exit(1);
  }
  const rawData = JSON.parse(readFileSync(dataPath, 'utf-8'));
  console.log(`📂 Loaded ${rawData.length} records from training_data.json`);

  // Filter to valid records
  const valid = rawData.filter(r => !shouldSkip(r));
  console.log(`✅ ${valid.length} valid records after sanitization (${rawData.length - valid.length} skipped)\n`);

  // Check which records already exist in Firestore to resume gracefully
  console.log('🔍 Checking existing Firestore records...');
  const existingSnap = await db.collection('_fatawa_kb').select('id').get();
  const existingIds  = new Set(existingSnap.docs.map(d => d.id));
  console.log(`   ${existingIds.size} records already in Firestore\n`);

  // Ensure GCS bucket
  const bucket = await ensureBucket();
  console.log('');

  let uploaded = 0, skipped = 0, failed = 0, alreadyExist = 0;

  for (let i = 0; i < valid.length; i++) {
    const rec  = valid[i];
    const docId = rec.id ?? `huda_${i + 1000}`;

    if (existingIds.has(docId)) {
      alreadyExist++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${valid.length}] ${docId} ... `);

    try {
      // Read transcript (prefer existing, else use a_transcript field)
      let transcript = '';
      if (rec.a_audio_file) {
        transcript = readTranscript(rec.a_audio_file) || rec.a_transcript || '';
      } else {
        transcript = rec.a_transcript || '';
      }

      // Skip audio records with junk transcripts (< 20 chars meaningful content)
      const transcriptChars = transcript.replace(/\s/g, '').length;
      if (rec.reply_mode === 'audio' && transcriptChars < 20) {
        process.stdout.write(`⏭️  transcript too short (${transcriptChars} chars)\n`);
        skipped++;
        continue;
      }

      // Upload audio to GCS
      let audioUploaded = false;
      const audioFileName = rec.a_audio_file ?? '';
      if (audioFileName) {
        audioUploaded = await uploadAudioToBucket(bucket, audioFileName);
        if (!audioUploaded) {
          process.stdout.write(`⚠️  audio file not found locally — text-only record\n`);
        }
      }

      // Build search text (combine question + transcript for richer embedding)
      const searchText =
        (rec.q_embed_text || rec.q_text || '') + ' ' +
        (transcript ? transcript.slice(0, 500) : (rec.a_text || '').slice(0, 500));

      // Generate Gemini embedding
      await sleep(BATCH_DELAY);
      const embedding = await embedText(searchText);

      // Build Firestore record
      const fsRecord = {
        id:               docId,
        question:         rec.q_text ?? '',
        questionLang:     rec.q_language ?? 'unknown',
        topic:            rec.topic ?? 'General',
        answerText:       rec.a_text ?? '',
        answerTranscript: transcript,
        audioFile:        audioFileName ? `gs://${BUCKET_NAME}/${audioFileName}` : '',
        audioFileName:    audioFileName,
        confidence:       rec.confidence ?? 0,
        replyMode:        rec.reply_mode ?? (audioFileName ? 'audio' : 'text'),
        keywords:         extractKeywords(rec.q_text ?? '', rec.topic ?? ''),
        embedding,
        ingestedAt:       new Date().toISOString(),
      };

      await db.collection('_fatawa_kb').doc(docId).set(fsRecord);
      uploaded++;
      process.stdout.write(`✅  (${Math.round(embedding.length)} dims)\n`);

    } catch (err) {
      failed++;
      process.stdout.write(`❌  ${err.message}\n`);
    }
  }

  console.log(`
╔══════════════════════════════════════════╗
║        INGEST COMPLETE                   ║
╠══════════════════════════════════════════╣
║  Total records in dataset: ${String(rawData.length).padEnd(13)}║
║  Valid after sanitization: ${String(valid.length).padEnd(13)}║
║  ✅ Newly ingested:        ${String(uploaded).padEnd(13)}║
║  ⏭️  Already existed:      ${String(alreadyExist).padEnd(13)}║
║  ⏭️  Skipped (junk):       ${String(skipped).padEnd(13)}║
║  ❌ Failed:                ${String(failed).padEnd(13)}║
╚══════════════════════════════════════════╝

GCS Bucket: gs://${BUCKET_NAME}
Firestore:  _fatawa_kb (${PROJECT_ID})
`);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
