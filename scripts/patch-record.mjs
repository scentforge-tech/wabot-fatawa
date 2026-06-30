#!/usr/bin/env node
// Patch a single failed Firestore KB record with a fresh multilingual embedding
// Usage: node --env-file=.env scripts/patch-record.mjs huda_2022

import { Firestore } from '@google-cloud/firestore';
import { readFileSync, } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const KEY  = process.env.GEMINI_API_KEY;
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const sa = JSON.parse(readFileSync(resolve(ROOT, process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? './firebase-service-account.json'), 'utf-8'));
const db = new Firestore({ projectId: process.env.FIREBASE_PROJECT_ID, credentials: { client_email: sa.client_email, private_key: sa.private_key } });

async function gen(prompt) {
  const r = await fetch(`${BASE}/models/gemini-2.5-flash:generateContent?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 500, temperature: 0.2 } })
  });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

async function embed(text) {
  const r = await fetch(`${BASE}/models/gemini-embedding-001:embedContent?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text: text.trim().slice(0, 3000) }] }, outputDimensionality: 768 })
  });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.embedding.values;
}

const docId = process.argv[2];
if (!docId) { console.error('Usage: node patch-record.mjs <docId>'); process.exit(1); }

console.log(`\n🔧 Patching record: ${docId}\n`);
const snap = await db.collection('_fatawa_kb').doc(docId).get();
if (!snap.exists) { console.error('❌ Record not found'); process.exit(1); }

const rec = snap.data();
console.log('Question:', rec.question?.slice(0, 80));
console.log('Topic:', rec.topic);
console.log('Transcript:', (rec.answerTranscript || '').slice(0, 60));

const prompt = `Sheikh's Urdu answer: "${(rec.answerTranscript || rec.answerText || '').slice(0, 400)}"
Question: "${rec.question}"
Topic: ${rec.topic}

Do THREE things separated by ---:
PART 1 — Roman Urdu transliteration of the Urdu answer:
---
PART 2 — English translation/summary (2-3 sentences):
---
PART 3 — 4 question variants in Roman Urdu/Hinglish/English:`;

console.log('\n🤖 Generating multilingual augmentation...');
const resp = await gen(prompt);
const parts = resp.split('---').map(p => p.trim());

const combined = [rec.question, `Topic: ${rec.topic}`, parts[0] || '', parts[1] || '', parts[2] || '', (rec.answerTranscript || '').slice(0, 400)].filter(Boolean).join('\n');

console.log('\n🧠 Generating embedding...');
const embedding = await embed(combined);

await db.collection('_fatawa_kb').doc(docId).update({
  embedding,
  multilingualText: combined.slice(0, 2000),
  romanUrduTranscript: (parts[0] || '').slice(0, 500),
  englishTranslation: (parts[1] || '').slice(0, 500),
  questionVariants: (parts[2] || '').slice(0, 500),
  reingested: true,
  reingestedAt: new Date().toISOString(),
});

console.log(`✅ ${docId} patched successfully (${embedding.length} dims)\n`);
