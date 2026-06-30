#!/usr/bin/env node
/**
 * Fatawa Multilingual Re-Ingest Script
 *
 * STRATEGY:
 *   For each record, Gemini generates:
 *     1. Roman Urdu transliteration of the Urdu transcript
 *     2. English translation of the Urdu transcript
 *     3. 3–5 Roman Urdu / Hinglish question variants a user might ask
 *   
 *   The embedding is created from the COMBINED multilingual text:
 *     [question] + [roman_urdu_transliteration] + [english_translation] + [question_variants]
 *
 *   This makes the vector space multilingual — a user asking
 *   "Ehram me khushbu laga sakte hai?" (Roman Urdu) will correctly match
 *   the Urdu-script fatawa answer about Ihram fragrance restrictions.
 *
 * Run:
 *   node --env-file=.env scripts/reingest-multilingual.mjs
 *
 * Options (env vars):
 *   REINGEST_LIMIT=50       Process only N records (for testing)
 *   REINGEST_FORCE=true     Re-embed even if record already has multilingualText
 *   REINGEST_SKIP_UPLOAD=true  Skip GCS audio upload (already done)
 */

import { Firestore } from '@google-cloud/firestore';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

// ─── Config ──────────────────────────────────────────────────────────────────
const PROJECT_ID      = process.env.FIREBASE_PROJECT_ID;
const SA_PATH         = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? './firebase-service-account.json';
const GEMINI_KEY      = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_MODEL    = 'gemini-2.5-flash';
const GEMINI_BASE     = 'https://generativelanguage.googleapis.com/v1beta';
const LIMIT           = process.env.REINGEST_LIMIT ? parseInt(process.env.REINGEST_LIMIT) : Infinity;
const FORCE           = process.env.REINGEST_FORCE === 'true';
const BATCH_DELAY_MS  = 800; // ms between Gemini calls to respect rate limits

if (!PROJECT_ID || !GEMINI_KEY) {
  console.error('❌  FIREBASE_PROJECT_ID and GEMINI_API_KEY must be set in .env');
  process.exit(1);
}

// ─── Firestore client ─────────────────────────────────────────────────────────
const sa = JSON.parse(readFileSync(resolve(ROOT, SA_PATH), 'utf-8'));
const db = new Firestore({
  projectId: PROJECT_ID,
  credentials: { client_email: sa.client_email, private_key: sa.private_key },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Call Gemini generative model */
async function callGemini(prompt, maxTokens = 500) {
  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.2,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini generate error ${res.status}: ${err.slice(0,200)}`);
  }
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

/** Call Gemini embedding model */
async function embedText(text) {
  const url = `${GEMINI_BASE}/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text: text.trim().slice(0, 3000) }] },
      outputDimensionality: 768,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini embed error ${res.status}: ${err.slice(0,200)}`);
  }
  const json = await res.json();
  return json.embedding.values;
}

/**
 * Generate multilingual augmentation for a single record.
 * Uses Gemini Flash to produce:
 *   - Roman Urdu transliteration of the Urdu transcript
 *   - English translation of the Urdu transcript  
 *   - 4 Roman Urdu question variants a user might type in WhatsApp
 */
async function generateMultilingualAugmentation(record) {
  const question   = record.question    || '';
  const transcript = record.answerTranscript || record.answerText || '';
  const topic      = record.topic       || 'Hajj/Umrah';

  if (!transcript || transcript.length < 15) {
    // No Urdu transcript — still generate question variants from the question itself
    const prompt = `You are a Hajj/Umrah fatawa assistant. A pilgrim asked:
"${question}"

Topic: ${topic}

Generate 4 different ways a Pakistani/South Asian Muslim might ask this same question in WhatsApp.
Use a mix of: Roman Urdu (transliterated), Hinglish (Hindi+English mix), and simple English.
Keep each variant SHORT (under 20 words). Be natural, informal.

Return ONLY the 4 variants, one per line, no numbering or labels.`;

    const variants = await callGemini(prompt, 300);
    return {
      romanUrduTranscript: '',
      englishTranslation: '',
      questionVariants: variants,
    };
  }

  const prompt = `You are a multilingual Hajj/Umrah fatawa assistant.

Sheikh's answer in Urdu (script): "${transcript.slice(0, 600)}"

Original question: "${question}"
Topic: ${topic}

Do THREE things in your response, clearly separated by "---":

PART 1 — Roman Urdu transliteration of the Urdu transcript above (transliterate Urdu words into Roman/Latin script as Pakistani WhatsApp users write):

---

PART 2 — English translation/summary of the Sheikh's answer (2-3 sentences, clear and simple):

---

PART 3 — 4 different ways a Pakistani/South Asian Muslim might ask this exact question in WhatsApp (mix of Roman Urdu, Hinglish, English — informal, short):

Return exactly this format with "---" as separator. Keep it concise.`;

  const response = await callGemini(prompt, 600);
  
  const parts = response.split('---').map(p => p.trim());
  
  return {
    romanUrduTranscript: parts[0] || '',
    englishTranslation:  parts[1] || '',
    questionVariants:    parts[2] || '',
  };
}

/**
 * Build the combined multilingual text for embedding.
 * This is what gets embedded — covers all possible query languages.
 */
function buildMultilingualEmbedText(record, augmentation) {
  const parts = [
    // Original question (may be in any language already)
    record.question || '',
    // Topic keywords
    `Topic: ${record.topic || 'Hajj Umrah'}`,
    // Roman Urdu transliteration of transcript (matches Roman Urdu queries)
    augmentation.romanUrduTranscript || '',
    // English translation (matches English queries)
    augmentation.englishTranslation  || '',
    // Question variants in multiple languages (boosts recall)
    augmentation.questionVariants    || '',
    // Original Urdu transcript (matches Urdu script queries)
    (record.answerTranscript || record.answerText || '').slice(0, 400),
  ].filter(Boolean);

  return parts.join('\n').trim();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌐 Fatawa Multilingual Re-Ingest\n');
  console.log(`   Strategy: Generate Roman Urdu + English + Question variants per record`);
  console.log(`   Embedding: Combined multilingual text (all languages in one vector)`);
  console.log(`   Model: ${GEMINI_MODEL} (augmentation) + ${EMBEDDING_MODEL} (embedding)`);
  if (LIMIT < Infinity) console.log(`   Limit: ${LIMIT} records (set REINGEST_LIMIT=all to process all)`);
  if (FORCE) console.log(`   Force mode: re-embedding even existing multilingual records`);
  console.log('');

  // Load all existing KB records
  console.log('📦 Loading _fatawa_kb from Firestore...');
  const snap = await db.collection('_fatawa_kb').get();
  const docs = snap.docs;
  console.log(`   ${docs.length} records loaded\n`);

  // Filter: skip already-multilingual unless FORCE mode
  const toProcess = FORCE
    ? docs
    : docs.filter(d => !d.data().multilingualText);
  
  const limited = toProcess.slice(0, LIMIT);
  console.log(`📝 ${toProcess.length} records need multilingual augmentation`);
  console.log(`🚀 Processing ${limited.length} records now...\n`);

  let done = 0, failed = 0;
  const total = limited.length;

  for (let i = 0; i < limited.length; i++) {
    const doc = limited[i];
    const rec = doc.data();
    const docId = doc.id;

    process.stdout.write(`[${i + 1}/${total}] ${docId} (${rec.topic || '?'}) ... `);

    try {
      // Step 1: Generate multilingual augmentation
      await sleep(BATCH_DELAY_MS);
      const augmentation = await generateMultilingualAugmentation(rec);

      // Step 2: Build combined multilingual embedding text
      const multilingualText = buildMultilingualEmbedText(rec, augmentation);

      // Step 3: Generate new embedding from multilingual text
      await sleep(300);
      const embedding = await embedText(multilingualText);

      // Step 4: Update Firestore record with new embedding + augmentation
      await db.collection('_fatawa_kb').doc(docId).update({
        embedding,
        multilingualText:        multilingualText.slice(0, 2000), // store for debugging
        romanUrduTranscript:     augmentation.romanUrduTranscript.slice(0, 500),
        englishTranslation:      augmentation.englishTranslation.slice(0, 500),
        questionVariants:        augmentation.questionVariants.slice(0, 500),
        reingested:              true,
        reingestedAt:            new Date().toISOString(),
      });

      done++;
      process.stdout.write(`✅ (${embedding.length} dims)\n`);

    } catch (err) {
      failed++;
      process.stdout.write(`❌ ${err.message.slice(0, 80)}\n`);
      // Brief pause on error to avoid hammering the API
      await sleep(2000);
    }
  }

  const skipped = toProcess.length - limited.length;
  console.log(`
╔══════════════════════════════════════════════╗
║      MULTILINGUAL RE-INGEST COMPLETE         ║
╠══════════════════════════════════════════════╣
║  Total KB records:           ${String(docs.length).padEnd(15)}║
║  ✅ Re-embedded:             ${String(done).padEnd(15)}║
║  ❌ Failed:                  ${String(failed).padEnd(15)}║
║  ⏭️  Skipped (already done): ${String(docs.length - toProcess.length).padEnd(15)}║
║  ⏭️  Hit REINGEST_LIMIT:     ${String(skipped).padEnd(15)}║
╚══════════════════════════════════════════════╝

Embedding strategy: multilingual (Urdu + Roman Urdu + English + variants)
Firestore:  _fatawa_kb (${PROJECT_ID})
`);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
