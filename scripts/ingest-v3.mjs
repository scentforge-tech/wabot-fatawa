#!/usr/bin/env node
/**
 * Fatawa V3 Full Reingest
 *
 * Uses training_data_v3.json which contains:
 *   - authentic_ruling  : verified Islamic ruling (from internet cross-reference)
 *   - ruling_key_points : bullet points of key rulings
 *   - combined_search_text : pre-expanded multilingual search text
 *   - q_expanded        : expanded question with synonyms
 *   - a_transcript_processed : cleaned Urdu transcript
 *
 * Embedding strategy (layered multilingual vector):
 *   1. q_expanded          (all question synonyms/variants)
 *   2. combined_search_text (pre-built multilingual search text)
 *   3. authentic_ruling     (verified Islamic ruling in English)
 *   4. ruling_key_points    (key points as flat text)
 *   5. Gemini-generated:
 *      a. Roman Urdu transliteration of transcript
 *      b. English summary
 *      c. 4 WhatsApp question variants (Roman Urdu / Hinglish / English)
 *   6. Enhanced keywords (topic + ruling keywords + NLP extracted)
 *
 * Confidence scoring:
 *   - accuracy_label weight  (Hadith/Quran > Clear > Unclear)
 *   - authentic_ruling match (if present → higher base confidence)
 *   - ruling_key_points count (more points = more specific = higher confidence)
 *
 * Run:
 *   node --env-file=.env scripts/ingest-v3.mjs
 *
 * Options:
 *   INGEST_LIMIT=20         Test with N records
 *   INGEST_FORCE=true       Re-embed existing records
 *   INGEST_SKIP_AUDIO=true  Skip GCS audio upload
 */

import { Firestore } from '@google-cloud/firestore';
import { Storage }   from '@google-cloud/storage';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const OUTPUT    = join(ROOT, 'output');

const PROJECT_ID      = process.env.FIREBASE_PROJECT_ID;
const SA_PATH         = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? './firebase-service-account.json';
const GEMINI_KEY      = process.env.GEMINI_API_KEY;
const BUCKET_NAME     = process.env.GCS_BUCKET_NAME ?? 'wabot-fatawa-audio';
const EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_MODEL    = 'gemini-2.5-flash';
const GEMINI_BASE     = 'https://generativelanguage.googleapis.com/v1beta';
const LIMIT           = process.env.INGEST_LIMIT ? parseInt(process.env.INGEST_LIMIT) : Infinity;
const FORCE           = process.env.INGEST_FORCE === 'true';
const SKIP_AUDIO      = process.env.INGEST_SKIP_AUDIO === 'true';
const BATCH_DELAY     = 700; // ms between API calls

if (!PROJECT_ID || !GEMINI_KEY) {
  console.error('❌  FIREBASE_PROJECT_ID and GEMINI_API_KEY must be set in .env');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(resolve(ROOT, SA_PATH), 'utf-8'));
const db = new Firestore({ projectId: PROJECT_ID, credentials: { client_email: sa.client_email, private_key: sa.private_key } });
const storage = new Storage({ projectId: PROJECT_ID, credentials: { client_email: sa.client_email, private_key: sa.private_key } });

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callGemini(prompt, maxTokens = 600) {
  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.15 } }),
  });
  if (!res.ok) throw new Error(`Gemini generate ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

async function getEmbedding(text) {
  const url = `${GEMINI_BASE}/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: `models/${EMBEDDING_MODEL}`, content: { parts: [{ text: text.trim().slice(0, 3000) }] }, outputDimensionality: 768 }),
  });
  if (!res.ok) throw new Error(`Gemini embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.embedding.values;
}

function readTranscript(audioFileName) {
  if (!audioFileName) return '';
  const base = audioFileName.replace(/\.(opus|mp3|ogg|m4a)$/i, '');
  const p = join(OUTPUT, 'transcripts', `${base}.txt`);
  return existsSync(p) ? readFileSync(p, 'utf-8').trim() : '';
}

/** Compute a base confidence score from accuracy_label and data quality */
function computeBaseConfidence(rec) {
  let score = 0.5; // default

  // Accuracy label weighting
  const label = (rec.accuracy_label || '').toLowerCase();
  if (label.includes('hadith') || label.includes('quran')) score = 0.92;
  else if (label.includes('clear') && label.includes('yes')) score = 0.88;
  else if (label.includes('clear')) score = 0.85;
  else if (label.includes('answered')) score = 0.80;
  else if (label.includes('unclear')) score = 0.65;
  else if (label.includes('not answered') || label.includes('unanswered')) score = 0.40;

  // Boost if we have verified Islamic ruling (from internet cross-reference)
  if (rec.authentic_ruling && rec.authentic_ruling.length > 20) score = Math.min(score + 0.04, 0.97);

  // Boost if we have key points (more specific = more reliable)
  if (Array.isArray(rec.ruling_key_points) && rec.ruling_key_points.length >= 3) score = Math.min(score + 0.02, 0.97);
  else if (typeof rec.ruling_key_points === 'string' && rec.ruling_key_points.length > 30) score = Math.min(score + 0.02, 0.97);

  // Boost for audio answer (Sheikh recorded = more authoritative than text)
  if (rec.a_audio_file) score = Math.min(score + 0.03, 0.97);

  return Math.round(score * 100) / 100;
}

/** Extract rich keyword set from all fields */
function extractKeywords(rec, augmentation) {
  const sources = [
    rec.q_text || '',
    rec.topic || '',
    rec.authentic_ruling || '',
    typeof rec.ruling_key_points === 'string' ? rec.ruling_key_points : (rec.ruling_key_points || []).join(' '),
    augmentation?.englishTranslation || '',
    augmentation?.romanUrduTranscript || '',
  ].join(' ');

  const words = sources
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  return [...new Set(words)].slice(0, 35);
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'that', 'this', 'with', 'from', 'they',
  'have', 'been', 'will', 'also', 'more', 'when', 'can', 'not', 'but',
  'aur', 'hai', 'hain', 'kya', 'koi', 'bhi', 'mein', 'main', 'hum',
  'yeh', 'woh', 'kaise', 'kyun', 'kab', 'kaun', 'kahan', 'kis',
]);

/** Build the multilingual embedding text from all sources */
function buildEmbedText(rec, augmentation, transcript) {
  const keyPoints = Array.isArray(rec.ruling_key_points)
    ? rec.ruling_key_points.join('. ')
    : (rec.ruling_key_points || '');

  return [
    // Question (all its forms)
    rec.q_expanded || rec.q_text || '',
    rec.combined_search_text || '',

    // Islamic ruling (verified, English — helps English queries)
    rec.authentic_ruling ? `Islamic ruling: ${rec.authentic_ruling}` : '',
    keyPoints ? `Key points: ${keyPoints.slice(0, 300)}` : '',

    // Topic anchor
    `Topic: ${rec.topic || 'Hajj Umrah'}`,

    // AI-generated multilingual augmentation
    augmentation?.romanUrduTranscript ? `Roman Urdu: ${augmentation.romanUrduTranscript}` : '',
    augmentation?.englishTranslation  ? `English: ${augmentation.englishTranslation}` : '',
    augmentation?.questionVariants    ? `Variants: ${augmentation.questionVariants}` : '',

    // Urdu transcript (processed > raw)
    rec.a_transcript_processed || transcript || (rec.a_transcript || '').slice(0, 400),
  ].filter(Boolean).join('\n').trim();
}

/** Generate Roman Urdu + English + question variants via Gemini */
async function generateAugmentation(rec, transcript) {
  const hasTranscript = transcript && transcript.length > 15;
  const keyPoints = Array.isArray(rec.ruling_key_points)
    ? rec.ruling_key_points.slice(0, 5).join('; ')
    : (rec.ruling_key_points || '').slice(0, 200);

  const prompt = `You are a Hajj/Umrah fatawa specialist. 

Question: "${(rec.q_text || '').slice(0, 150)}"
Topic: ${rec.topic || 'Hajj'}
${hasTranscript ? `Sheikh's Urdu answer: "${transcript.slice(0, 400)}"` : ''}
${rec.authentic_ruling ? `Islamic ruling: ${rec.authentic_ruling.slice(0, 200)}` : ''}
${keyPoints ? `Key points: ${keyPoints}` : ''}

Do THREE things, separated by ---:

PART 1 — Roman Urdu transliteration of the Sheikh's answer (Latin script, as Pakistani WhatsApp users write):

---

PART 2 — English answer summary (2-3 clear sentences for the pilgrim):

---

PART 3 — 5 ways a Pakistani/South Asian pilgrim might ask this in WhatsApp (Roman Urdu, Hinglish, English — informal, 1 per line):

Keep it concise and accurate.`;

  try {
    const resp = await callGemini(prompt, 700);
    const parts = resp.split('---').map(p => p.trim());
    return {
      romanUrduTranscript: parts[0] || '',
      englishTranslation:  parts[1] || '',
      questionVariants:    parts[2] || '',
    };
  } catch (err) {
    console.error('    ⚠️  Augmentation failed:', err.message.slice(0, 60));
    return { romanUrduTranscript: '', englishTranslation: '', questionVariants: '' };
  }
}

async function uploadAudio(bucket, audioFileName) {
  if (!audioFileName || SKIP_AUDIO) return false;
  const localPath = join(OUTPUT, 'media', audioFileName);
  if (!existsSync(localPath)) return false;
  const file = bucket.file(audioFileName);
  const [exists] = await file.exists();
  if (exists) return true;
  await bucket.upload(localPath, { destination: audioFileName, metadata: { contentType: 'audio/ogg; codecs=opus' } });
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 Fatawa V3 Full Reingest\n');
  console.log('   Data: training_data_v3.json');
  console.log('   Embedding: q_expanded + combined_search_text + authentic_ruling + key_points + AI augmentation');
  console.log('   Model:', GEMINI_MODEL, '+', EMBEDDING_MODEL);
  if (LIMIT < Infinity) console.log('   Limit:', LIMIT, 'records');
  if (FORCE) console.log('   Force: re-embedding existing records');
  console.log('');

  // Load v3 data
  const v3Path = join(OUTPUT, 'training_data_v3.json');
  if (!existsSync(v3Path)) { console.error('❌ training_data_v3.json not found in output/'); process.exit(1); }
  const rawData = JSON.parse(readFileSync(v3Path, 'utf-8'));
  console.log(`📂 Loaded ${rawData.length} records from training_data_v3.json`);

  // Filter valid: must have question + has answer
  const valid = rawData.filter(r =>
    r.q_text && r.q_text.trim().length >= 10 &&
    r.has_answer &&
    (r.a_audio_file || (r.a_text && r.a_text.length >= 5) || (r.a_transcript && r.a_transcript.length >= 5)),
  );
  console.log(`✅ ${valid.length} valid records (${rawData.length - valid.length} skipped)\n`);

  // Load existing KB to check what already has v3 embeddings
  console.log('🔍 Checking existing _fatawa_kb records...');
  const existingSnap = await db.collection('_fatawa_kb').get();
  const existingMap = new Map(existingSnap.docs.map(d => [d.id, d.data()]));
  console.log(`   ${existingMap.size} existing records in Firestore\n`);

  // GCS bucket
  const bucket = storage.bucket(BUCKET_NAME);
  const [bucketExists] = await bucket.exists();
  if (!bucketExists) {
    console.log('📦 Creating GCS bucket:', BUCKET_NAME);
    await storage.createBucket(BUCKET_NAME, { location: 'US', storageClass: 'STANDARD' });
  }

  const toProcess = valid
    .filter(r => FORCE || !existingMap.has(r.id) || !existingMap.get(r.id)?.v3ingested)
    .slice(0, LIMIT);

  console.log(`📝 ${toProcess.length} records to process (${valid.length - toProcess.length} already at v3)\n`);

  let done = 0, failed = 0, audioUploaded = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const rec = toProcess[i];
    const docId = rec.id ?? `huda_${1000 + i}`;
    const existing = existingMap.get(docId);

    process.stdout.write(`[${i + 1}/${toProcess.length}] ${docId} (${rec.topic || '?'}) ... `);

    try {
      // Step 1: Get transcript (file > v3 field > old field)
      const transcript = readTranscript(rec.a_audio_file) || rec.a_transcript_processed || rec.a_transcript || '';

      // Step 2: Upload audio to GCS
      if (rec.a_audio_file && !SKIP_AUDIO) {
        const uploaded = await uploadAudio(bucket, rec.a_audio_file);
        if (uploaded) audioUploaded++;
      }

      // Step 3: Generate AI augmentation (Roman Urdu + English + variants)
      await sleep(BATCH_DELAY);
      const augmentation = await generateAugmentation(rec, transcript);

      // Step 4: Build multilingual embed text (all sources combined)
      const embedTextStr = buildEmbedText(rec, augmentation, transcript);

      // Step 5: Compute base confidence from accuracy_label + data quality
      const baseConfidence = computeBaseConfidence(rec);

      // Step 6: Embed
      await sleep(300);
      const embedding = await getEmbedding(embedTextStr);

      // Step 7: Extract rich keywords
      const keywords = extractKeywords(rec, augmentation);

      // Step 8: Build key points as flat string
      const keyPointsStr = Array.isArray(rec.ruling_key_points)
        ? rec.ruling_key_points.join('\n')
        : (rec.ruling_key_points || '');

      // Step 9: Write to Firestore
      const fsRecord = {
        id:                     docId,
        question:               rec.q_text || '',
        questionExpanded:       rec.q_expanded || '',
        questionLang:           rec.q_language || 'unknown',
        topic:                  rec.topic || 'General',
        answerText:             rec.a_text || '',
        answerTranscript:       transcript,
        answerTranscriptProcessed: rec.a_transcript_processed || '',
        audioFile:              rec.a_audio_file ? `gs://${BUCKET_NAME}/${rec.a_audio_file}` : '',
        audioFileName:          rec.a_audio_file || '',
        confidence:             baseConfidence,
        accuracyLabel:          rec.accuracy_label || '',
        accuracyNote:           rec.accuracy_note || '',
        replyMode:              rec.reply_mode ?? (rec.a_audio_file ? 'audio' : 'text'),
        // Islamic ruling (verified from internet cross-reference)
        authenticRuling:        rec.authentic_ruling || '',
        rulingKeyPoints:        keyPointsStr,
        // Multilingual augmentation
        romanUrduTranscript:    augmentation.romanUrduTranscript.slice(0, 500),
        englishTranslation:     augmentation.englishTranslation.slice(0, 500),
        questionVariants:       augmentation.questionVariants.slice(0, 500),
        combinedSearchText:     rec.combined_search_text || '',
        // Rich keywords
        keywords,
        // Embedding
        embedding,
        multilingualText:       embedTextStr.slice(0, 2000),
        // Metadata
        v3ingested:             true,
        v3ingestedAt:           new Date().toISOString(),
      };

      await db.collection('_fatawa_kb').doc(docId).set(fsRecord, { merge: true });
      done++;
      process.stdout.write(`✅ conf:${baseConfidence} keys:${keywords.length}\n`);

    } catch (err) {
      failed++;
      process.stdout.write(`❌ ${err.message.slice(0, 80)}\n`);
      await sleep(2000);
    }
  }

  console.log(`
╔════════════════════════════════════════════════╗
║         V3 REINGEST COMPLETE                   ║
╠════════════════════════════════════════════════╣
║  Total v3 records:           ${String(rawData.length).padEnd(17)}║
║  Valid (has answer):         ${String(valid.length).padEnd(17)}║
║  ✅ Re-embedded (v3):        ${String(done).padEnd(17)}║
║  ❌ Failed:                  ${String(failed).padEnd(17)}║
║  🎵 Audio uploaded to GCS:   ${String(audioUploaded).padEnd(17)}║
║  ⏭️  Already at v3:          ${String(valid.length - toProcess.length).padEnd(17)}║
╚════════════════════════════════════════════════╝

Embedding includes: expanded question + combined search text + 
  authentic Islamic ruling + key points + Roman Urdu + English + variants
Firestore: _fatawa_kb (${PROJECT_ID})
GCS: gs://${BUCKET_NAME}
`);
}

main().catch(err => { console.error('\n❌ Fatal:', err); process.exit(1); });
